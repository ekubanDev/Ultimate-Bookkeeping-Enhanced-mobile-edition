from fastapi import FastAPI, APIRouter, HTTPException, Response, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import math

import json
from openai import AsyncOpenAI

from ai_chat_tools import compute_business_snapshot, snapshot_json_for_prompt
from firebase_auth import (
    ai_chat_auth_enforced,
    check_ai_chat_rate_limit,
    ensure_firebase_admin_app,
    verify_bearer_id_token,
)

try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    HAS_EMERGENT = True
except ImportError:
    HAS_EMERGENT = False
    LlmChat = None
    UserMessage = None


async def call_llm(api_key: str, system_message: str, prompt: str) -> str:
    """Call LLM via emergentintegrations if available, otherwise use OpenAI directly."""
    if HAS_EMERGENT:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"session-{uuid.uuid4()}",
            system_message=system_message
        ).with_model("openai", "gpt-5.2")
        return await chat.send_message(UserMessage(text=prompt))

    client = AsyncOpenAI(api_key=api_key)
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7,
        max_tokens=1000
    )
    return response.choices[0].message.content


def _sanitize_chat_datasets(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Any] = {}
    limits = {"products": 2000, "sales": 3500, "purchase_orders": 600}
    for key, lim in limits.items():
        v = raw.get(key)
        if isinstance(v, list):
            out[key] = v[:lim]
    return out


CHAT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_business_snapshot",
            "description": (
                "Returns factual aggregates from the user's loaded bookkeeping data: low stock, "
                "restock priorities (by recent revenue), top sellers in the last 90 days, slow movers, "
                "and last purchase-order receive dates per product. Call this before answering questions "
                "about inventory, restocking, or product performance."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    }
]


def _sanitize_chat_history(raw: Any) -> List[Dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, str]] = []
    for item in raw[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        if role not in ("user", "assistant"):
            continue
        content = item.get("content")
        if not isinstance(content, str):
            content = str(content) if content is not None else ""
        content = content.strip()
        if not content:
            continue
        out.append({"role": role, "content": content[:4000]})
    return out


async def _ai_chat_with_openai_tools(
    api_key: str,
    system_message: str,
    user_question: str,
    snapshot_json: str,
    history: Optional[List[Dict[str, str]]] = None,
) -> str:
    """One tool (get_business_snapshot) backed by precomputed client data; native OpenAI tool loop."""
    model = os.environ.get("AI_CHAT_MODEL", "gpt-4o")
    client = AsyncOpenAI(api_key=api_key)
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_message}]
    for turn in history or []:
        messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append(
        {
            "role": "user",
            "content": (
                f"{user_question}\n\n"
                "For factual questions about sales, inventory, restocking, or product performance, "
                "call get_business_snapshot first and base numeric claims only on that result."
            ),
        }
    )
    max_rounds = 4
    for _ in range(max_rounds):
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            tools=CHAT_TOOLS,
            tool_choice="auto",
            temperature=0.5,
            max_tokens=1800,
        )
        msg = response.choices[0].message
        if not msg.tool_calls:
            return (msg.content or "").strip() or "I could not generate a response."

        messages.append(
            {
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments or "{}"},
                    }
                    for tc in msg.tool_calls
                ],
            }
        )
        for tc in msg.tool_calls:
            if tc.function.name == "get_business_snapshot":
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": snapshot_json,
                    }
                )
            else:
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps({"error": "unknown_tool", "name": tc.function.name}),
                    }
                )

    return "The assistant took too many steps. Please try a simpler question."


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ.get("MONGO_URL")
db_name = os.environ.get("DB_NAME")

client = AsyncIOMotorClient(mongo_url) if mongo_url else None
db = client[db_name] if client and db_name else None

# Create the main app without a prefix
app = FastAPI(title="Ultimate Bookkeeping API", version="2.0")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Define Models
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

class AIInsightsRequest(BaseModel):
    sales_data: List[Dict[str, Any]]
    expenses_data: List[Dict[str, Any]]
    products_data: List[Dict[str, Any]]
    period: str = "month"
    analysis_type: str = "general"

class AIInsightsResponse(BaseModel):
    insights: str
    recommendations: List[str]
    alerts: List[str]
    forecast: Optional[Dict[str, Any]] = None

class ForecastRequest(BaseModel):
    historical_sales: List[Dict[str, Any]]
    forecast_days: int = 30

class AdvancedForecastRequest(BaseModel):
    historical_sales: List[Dict[str, Any]]
    products_data: List[Dict[str, Any]] = []
    forecast_days: int = 30
    include_product_forecast: bool = False

class StockAlertEmailRequest(BaseModel):
    products: List[Dict[str, Any]]
    recipient: str
    business_name: str = "Ultimate Bookkeeping"

class SendReportRequest(BaseModel):
    report_type: str  # "daily" or "weekly"
    data: Dict[str, Any]
    recipient: str
    business_name: str = "Ultimate Bookkeeping"

class TestEmailRequest(BaseModel):
    recipient: str

class EmailSettingsRequest(BaseModel):
    emailNotifications: bool = False
    dailyReports: bool = False
    notificationEmail: str = ""

class MetricsEventRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    event_name: str
    event_version: int = 1
    event_id: Optional[str] = None
    correlation_id: Optional[str] = None
    timestamp_client: Optional[str] = None
    timestamp_server: Optional[str] = None
    actor: Dict[str, Any] = Field(default_factory=dict)
    context: Dict[str, Any] = Field(default_factory=dict)
    payload: Dict[str, Any] = Field(default_factory=dict)

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Ultimate Bookkeeping API", "version": "2.0"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "app": "Ultimate Bookkeeping", "version": "2.0"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    _ = await db.status_checks.insert_one(doc)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    return status_checks

def _insights_sale_line_revenue(s: Dict[str, Any]) -> float:
    """Align with frontend enhanced-dashboard calculateRevenue (discount + tax)."""
    try:
        qty = float(s.get("quantity", 0) or 0)
        price = float(s.get("price", 0) or 0)
        disc = float(s.get("discount", 0) or 0)
        tax = float(s.get("tax", 0) or 0)
        subtotal = qty * price * (1.0 - disc / 100.0)
        return subtotal * (1.0 + tax / 100.0)
    except (TypeError, ValueError):
        t = s.get("total")
        if t is not None:
            try:
                return float(t)
            except (TypeError, ValueError):
                pass
        return 0.0


def _insights_compute_cogs(sales: List[Dict[str, Any]], products: List[Dict[str, Any]]) -> float:
    """Align with frontend enhanced-dashboard calculateCOGS (product cost × qty)."""
    by_name: Dict[str, float] = {}
    for p in products:
        n = (p.get("name") or "").strip()
        if not n:
            continue
        try:
            by_name[n] = float(p.get("cost", 0) or 0)
        except (TypeError, ValueError):
            by_name[n] = 0.0
    total = 0.0
    for s in sales:
        name = (s.get("product") or "").strip()
        cost = by_name.get(name)
        if cost is None:
            try:
                cost = float(s.get("cost", 0) or 0)
            except (TypeError, ValueError):
                cost = 0.0
        try:
            qty = float(s.get("quantity", 0) or 0)
        except (TypeError, ValueError):
            qty = 0.0
        total += qty * cost
    return total


@api_router.post("/ai/insights", response_model=AIInsightsResponse)
async def get_ai_insights(request: AIInsightsRequest):
    """Generate AI-powered business insights using GPT-5.2"""
    try:
        total_revenue = sum(_insights_sale_line_revenue(s) for s in request.sales_data)
        total_cogs = _insights_compute_cogs(request.sales_data, request.products_data)
        gross_profit = total_revenue - total_cogs
        total_products = len(request.products_data)
        low_stock_count = sum(1 for p in request.products_data if p.get('quantity', 0) <= p.get('minStock', 10))

        def _is_debt_payment(exp):
            exp_type = (exp.get('expenseType', '') or '').lower()
            cat = (exp.get('category', '') or '').lower()
            return exp_type == 'liability_payment' or cat in ('debt payment', 'loan repayment')

        operating_expenses = [e for e in request.expenses_data if not _is_debt_payment(e)]
        debt_payments = [e for e in request.expenses_data if _is_debt_payment(e)]

        total_expenses = sum(float(e.get('amount', 0) or 0) for e in operating_expenses)
        total_debt_payments = sum(float(e.get('amount', 0) or 0) for e in debt_payments)

        product_sales = {}
        for sale in request.sales_data:
            product = sale.get('product', 'Unknown')
            qty = sale.get('quantity', 0)
            product_sales[product] = product_sales.get(product, 0) + qty
        top_products = sorted(product_sales.items(), key=lambda x: x[1], reverse=True)[:5]

        expense_categories = {}
        for exp in operating_expenses:
            cat = exp.get('category', 'Other')
            expense_categories[cat] = expense_categories.get(cat, 0) + float(exp.get('amount', 0) or 0)

        net_profit = gross_profit - total_expenses
        gross_margin_pct = (gross_profit / total_revenue * 100) if total_revenue > 0 else 0
        net_margin_pct = (net_profit / total_revenue * 100) if total_revenue > 0 else 0

        api_key = os.environ.get('EMERGENT_LLM_KEY')

        if api_key:
            prompt = f"""Analyze this bookkeeping data and provide actionable insights. All monetary values are in Ghana Cedis (GHS). Always use the ₵ symbol, never $.

The rows below match the **same period** the dashboard sent (filter: {request.period}). Use only these numbers for any monetary claims.

FINANCIAL DEFINITIONS (must follow exactly):
- **Total Revenue** = recorded sales (after line discount/tax), not profit.
- **COGS** = cost of goods sold, estimated as quantity sold × product unit cost from inventory (same approach as the dashboard).
- **Gross Profit** = Total Revenue − COGS.
- **Operating Expenses** = recorded operating expenses only (debt repayments listed separately).
- **Net Profit** = Gross Profit − Operating Expenses. This is the true “bottom line” for this view — **not** the same as Total Revenue.
- **Gross margin %** = Gross Profit ÷ Total Revenue. **Net margin %** = Net Profit ÷ Total Revenue.

BUSINESS DATA SUMMARY ({request.period}):
- Total Revenue: ₵{total_revenue:,.2f}
- COGS (from inventory costs × units sold): ₵{total_cogs:,.2f}
- Gross Profit: ₵{gross_profit:,.2f}
- Gross margin: {gross_margin_pct:.1f}%
- Operating Expenses: ₵{total_expenses:,.2f}
- Net Profit (Gross Profit − Operating Expenses): ₵{net_profit:,.2f}
- Net margin on revenue: {net_margin_pct:.1f}%
- Debt/Liability Payments (not operating expense): ₵{total_debt_payments:,.2f}
- Total Products: {total_products}
- Low Stock Items: {low_stock_count}

TOP SELLING PRODUCTS (by units):
{chr(10).join([f"- {p[0]}: {p[1]} units" for p in top_products]) if top_products else "- No sales data"}

EXPENSE BREAKDOWN:
{chr(10).join([f"- {k}: ₵{v:,.2f}" for k, v in sorted(expense_categories.items(), key=lambda x: x[1], reverse=True)]) if expense_categories else "- No expense data"}

Analysis Type: {request.analysis_type}

Provide:
1. A brief executive summary (2-3 sentences): mention **Total Revenue**, **Gross Profit** or **COGS** if relevant, and **Net Profit** as distinct figures — never describe revenue as net profit.
2. 3-5 specific, actionable recommendations
3. Any urgent alerts or warnings
4. Revenue forecast trend (up/down/stable)

Format your response as JSON with keys: summary, recommendations (array), alerts (array), trend"""

            response = await call_llm(
                api_key=api_key,
                system_message=(
                    "You are a professional business analyst for retail and inventory. This business operates in Ghana; use ₵ (GHS) only, never $. "
                    "The payload uses dashboard-aligned math: net profit subtracts COGS (from product costs) and operating expenses. "
                    "Never equate Total Revenue with Net Profit."
                ),
                prompt=prompt,
            )

            try:
                json_start = response.find('{')
                json_end = response.rfind('}') + 1
                if json_start >= 0 and json_end > json_start:
                    parsed = json.loads(response[json_start:json_end])
                    return AIInsightsResponse(
                        insights=parsed.get('summary', response),
                        recommendations=parsed.get('recommendations', []),
                        alerts=parsed.get('alerts', []),
                        forecast={"trend": parsed.get('trend', 'stable')}
                    )
            except json.JSONDecodeError:
                pass

            return AIInsightsResponse(
                insights=response[:500],
                recommendations=["Review low stock items", "Analyze expense patterns", "Focus on top-selling products"],
                alerts=["Low stock alert" if low_stock_count > 0 else ""],
                forecast={"trend": "stable"}
            )

        # Fallback: rule-based insights when AI key is not set
        recommendations = []
        alerts = []

        if low_stock_count > 0:
            alerts.append(f"{low_stock_count} product(s) are at or below minimum stock levels")
        if total_revenue > 0 and gross_margin_pct < 20:
            alerts.append(f"Gross margin is low at {gross_margin_pct:.1f}% — review pricing or supplier costs")
            recommendations.append("Review product pricing and COGS to improve gross margin")
        if net_profit < 0:
            alerts.append("Business is operating at a net loss this period (after COGS and operating expenses)")
        if top_products:
            recommendations.append(f"Focus on top seller '{top_products[0][0]}' — consider increasing stock and promotions")
        if expense_categories:
            top_expense = max(expense_categories.items(), key=lambda x: x[1])
            recommendations.append(f"Largest expense category is '{top_expense[0]}' at ₵{top_expense[1]:,.2f} — look for savings")
        recommendations.append("Maintain consistent stock levels on high-demand items")
        recommendations.append("Track daily sales trends to identify seasonal patterns")

        trend = "up" if net_profit > 0 and net_margin_pct > 10 else "down" if net_profit < 0 else "stable"
        debt_note = f" Debt payments of ₵{total_debt_payments:,.2f} reduced liabilities (not counted as expense)." if total_debt_payments > 0 else ""
        summary = (
            f"Revenue ₵{total_revenue:,.2f}, COGS ₵{total_cogs:,.2f}, gross profit ₵{gross_profit:,.2f} ({gross_margin_pct:.1f}% gross margin). "
            f"After operating expenses ₵{total_expenses:,.2f}, net {'profit' if net_profit >= 0 else 'loss'} ₵{abs(net_profit):,.2f} ({net_margin_pct:.1f}% net margin).{debt_note} "
            f"{total_products} products; {low_stock_count} low-stock SKUs."
        )

        return AIInsightsResponse(
            insights=summary,
            recommendations=recommendations[:5],
            alerts=alerts if alerts else ["No urgent alerts"],
            forecast={"trend": trend}
        )

    except Exception as e:
        logger.error(f"AI insights error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate insights: {str(e)}")

@api_router.post("/ai/forecast")
async def get_sales_forecast(request: ForecastRequest):
    """Generate sales forecast using AI or rule-based fallback"""
    try:
        daily_totals = {}
        for sale in request.historical_sales:
            date = sale.get('date', '')[:10]
            total = sale.get('total', sale.get('quantity', 0) * sale.get('price', 0))
            daily_totals[date] = daily_totals.get(date, 0) + total

        sorted_sales = sorted(daily_totals.items())
        recent_avg = sum(v for _, v in sorted_sales[-7:]) / min(7, len(sorted_sales)) if sorted_sales else 0

        api_key = os.environ.get('EMERGENT_LLM_KEY')

        if api_key:
            prompt = f"""Based on this sales history, forecast the next {request.forecast_days} days. All monetary values are in Ghana Cedis (GHS). Always use the ₵ symbol for currency, never $.

DAILY SALES (last 30 entries):
{chr(10).join([f"{d}: ₵{v:,.2f}" for d, v in sorted_sales[-30:]])}

7-day average: ₵{recent_avg:,.2f}

Provide a JSON response with:
1. predicted_daily_average: number
2. trend: "up", "down", or "stable"
3. confidence: "high", "medium", or "low"
4. factors: array of factors affecting the forecast"""

            response = await call_llm(
                api_key=api_key,
                system_message="You are a sales forecasting expert. Provide data-driven predictions. This business operates in Ghana. Always use the Ghana Cedi symbol ₵ (GHS) for all monetary values, never $.",
                prompt=prompt
            )

            try:
                json_start = response.find('{')
                json_end = response.rfind('}') + 1
                if json_start >= 0 and json_end > json_start:
                    parsed = json.loads(response[json_start:json_end])
                    return {
                        "predicted_daily_average": parsed.get('predicted_daily_average', recent_avg),
                        "trend": parsed.get('trend', 'stable'),
                        "confidence": parsed.get('confidence', 'medium'),
                        "factors": parsed.get('factors', []),
                        "forecast_period": request.forecast_days
                    }
            except Exception:
                pass

        # Rule-based fallback
        older_avg = sum(v for _, v in sorted_sales[-14:-7]) / min(7, max(1, len(sorted_sales) - 7)) if len(sorted_sales) > 7 else recent_avg
        trend = "up" if recent_avg > older_avg * 1.05 else "down" if recent_avg < older_avg * 0.95 else "stable"
        confidence = "medium" if len(sorted_sales) >= 14 else "low" if len(sorted_sales) >= 3 else "low"
        factors = []
        if len(sorted_sales) < 7:
            factors.append("Limited historical data — forecast accuracy will improve over time")
        if trend == "up":
            factors.append("Recent sales show upward momentum")
        elif trend == "down":
            factors.append("Recent sales trending downward — monitor closely")
        else:
            factors.append("Sales are holding steady")

        return {
            "predicted_daily_average": round(recent_avg, 2),
            "trend": trend,
            "confidence": confidence,
            "factors": factors,
            "forecast_period": request.forecast_days
        }

    except Exception as e:
        logger.error(f"Forecast error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate forecast: {str(e)}")

def _linear_regression(xs: List[float], ys: List[float]):
    """Least-squares linear regression. Returns (slope, intercept)."""
    n = len(xs)
    if n < 2:
        return 0.0, (ys[0] if ys else 0.0)
    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xy = sum(x * y for x, y in zip(xs, ys))
    sum_x2 = sum(x * x for x in xs)
    denom = n * sum_x2 - sum_x * sum_x
    if abs(denom) < 1e-10:
        return 0.0, sum_y / n
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    return slope, intercept


def _detect_day_of_week_pattern(daily_data: Dict[str, float]) -> Dict[int, float]:
    """Returns multiplier per weekday (0=Mon .. 6=Sun) relative to overall average."""
    weekday_totals = defaultdict(list)
    for date_str, total in daily_data.items():
        try:
            dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
            weekday_totals[dt.weekday()].append(total)
        except ValueError:
            continue
    if not weekday_totals:
        return {}
    overall_avg = sum(sum(v) for v in weekday_totals.values()) / sum(len(v) for v in weekday_totals.values())
    if overall_avg < 1e-10:
        return {}
    pattern = {}
    for wd, vals in weekday_totals.items():
        day_avg = sum(vals) / len(vals)
        pattern[wd] = day_avg / overall_avg
    return pattern


def _compute_forecast_series(daily_data: Dict[str, float], forecast_days: int):
    """Generate day-by-day forecast with confidence intervals using linear regression + seasonal adjustment."""
    sorted_dates = sorted(daily_data.keys())
    if not sorted_dates:
        return [], "stable", "low", []

    values = [daily_data[d] for d in sorted_dates]
    xs = list(range(len(values)))
    slope, intercept = _linear_regression([float(x) for x in xs], values)

    residuals = [values[i] - (slope * i + intercept) for i in range(len(values))]
    std_dev = math.sqrt(sum(r * r for r in residuals) / max(1, len(residuals) - 2)) if len(residuals) > 2 else 0.0

    dow_pattern = _detect_day_of_week_pattern(daily_data)

    last_date_str = sorted_dates[-1]
    try:
        last_date = datetime.strptime(last_date_str[:10], "%Y-%m-%d")
    except ValueError:
        last_date = datetime.now()

    forecast_series = []
    n = len(values)
    for i in range(1, forecast_days + 1):
        future_date = last_date + timedelta(days=i)
        trend_value = slope * (n + i - 1) + intercept
        dow_mult = dow_pattern.get(future_date.weekday(), 1.0)
        predicted = max(0, trend_value * dow_mult)
        distance_factor = 1 + (i / forecast_days) * 0.5
        margin = std_dev * 1.96 * distance_factor
        forecast_series.append({
            "date": future_date.strftime("%Y-%m-%d"),
            "predicted": round(predicted, 2),
            "lower_bound": round(max(0, predicted - margin), 2),
            "upper_bound": round(predicted + margin, 2),
        })

    recent_7 = values[-7:] if len(values) >= 7 else values
    older_7 = values[-14:-7] if len(values) >= 14 else values[:max(1, len(values) // 2)]
    recent_avg = sum(recent_7) / len(recent_7) if recent_7 else 0
    older_avg = sum(older_7) / len(older_7) if older_7 else recent_avg

    if recent_avg > older_avg * 1.08:
        trend = "up"
    elif recent_avg < older_avg * 0.92:
        trend = "down"
    else:
        trend = "stable"

    data_points = len(values)
    if data_points >= 30:
        confidence = "high"
    elif data_points >= 14:
        confidence = "medium"
    else:
        confidence = "low"

    factors = []
    if slope > 0.5:
        factors.append("Consistent upward sales trajectory")
    elif slope < -0.5:
        factors.append("Declining sales trend detected")
    else:
        factors.append("Relatively flat sales trend")

    if dow_pattern:
        best_day = max(dow_pattern, key=dow_pattern.get)
        worst_day = min(dow_pattern, key=dow_pattern.get)
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        factors.append(f"Strongest sales day: {day_names[best_day]}")
        factors.append(f"Weakest sales day: {day_names[worst_day]}")

    if data_points < 14:
        factors.append("Limited historical data — forecast will improve over time")

    return forecast_series, trend, confidence, factors


def _product_level_forecast(sales_data: List[Dict], products_data: List[Dict], forecast_days: int) -> List[Dict]:
    """Forecast demand per product based on historical sales velocity."""
    product_daily = defaultdict(lambda: defaultdict(float))
    for sale in sales_data:
        product = sale.get("product", "Unknown")
        date = sale.get("date", "")[:10]
        qty = sale.get("quantity", 0)
        if date:
            product_daily[product][date] += qty

    forecasts = []
    for prod_data in products_data:
        name = prod_data.get("name", "")
        current_stock = prod_data.get("quantity", 0)
        min_stock = prod_data.get("minStock", 10)
        cost = prod_data.get("cost", 0)
        price = prod_data.get("price", 0)

        daily = product_daily.get(name, {})
        if not daily:
            continue

        sorted_dates = sorted(daily.keys())
        total_qty = sum(daily.values())
        span_days = max(1, (datetime.strptime(sorted_dates[-1][:10], "%Y-%m-%d") - datetime.strptime(sorted_dates[0][:10], "%Y-%m-%d")).days + 1) if len(sorted_dates) > 1 else 1
        avg_daily_demand = total_qty / span_days

        recent_dates = sorted_dates[-14:]
        recent_qty = sum(daily[d] for d in recent_dates)
        recent_span = max(1, len(recent_dates))
        recent_daily = recent_qty / recent_span

        if avg_daily_demand > 0:
            days_until_stockout = current_stock / recent_daily if recent_daily > 0 else 999
        else:
            days_until_stockout = 999

        forecasted_demand = round(recent_daily * forecast_days, 1)
        reorder_qty = max(0, round(forecasted_demand - current_stock + min_stock))

        velocity = "high" if recent_daily > avg_daily_demand * 1.2 else "low" if recent_daily < avg_daily_demand * 0.8 else "normal"

        forecasts.append({
            "product": name,
            "current_stock": current_stock,
            "avg_daily_demand": round(avg_daily_demand, 2),
            "recent_daily_demand": round(recent_daily, 2),
            "forecasted_demand": forecasted_demand,
            "days_until_stockout": round(min(days_until_stockout, 999)),
            "reorder_quantity": reorder_qty,
            "velocity": velocity,
            "estimated_reorder_cost": round(reorder_qty * cost, 2),
            "estimated_revenue": round(forecasted_demand * price, 2),
        })

    forecasts.sort(key=lambda x: x["days_until_stockout"])
    return forecasts


@api_router.post("/ai/forecast/advanced")
async def get_advanced_forecast(request: AdvancedForecastRequest):
    """Advanced sales forecasting with day-by-day predictions, confidence intervals, seasonal patterns, and product-level demand."""
    try:
        daily_totals: Dict[str, float] = {}
        for sale in request.historical_sales:
            date = sale.get("date", "")[:10]
            total = sale.get("total", sale.get("quantity", 0) * sale.get("price", 0))
            if date:
                daily_totals[date] = daily_totals.get(date, 0) + total

        forecast_series, trend, confidence, factors = _compute_forecast_series(daily_totals, request.forecast_days)

        sorted_values = [daily_totals[d] for d in sorted(daily_totals.keys())]
        predicted_avg = sum(f["predicted"] for f in forecast_series) / len(forecast_series) if forecast_series else 0

        monthly_totals = defaultdict(float)
        for date_str, total in daily_totals.items():
            month_key = date_str[:7]
            monthly_totals[month_key] += total
        historical_monthly = [{"month": k, "revenue": round(v, 2)} for k, v in sorted(monthly_totals.items())]

        dow_pattern = _detect_day_of_week_pattern(daily_totals)
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        weekly_pattern = [{"day": day_names[i], "multiplier": round(dow_pattern.get(i, 1.0), 3)} for i in range(7)]

        result = {
            "forecast_series": forecast_series,
            "predicted_daily_average": round(predicted_avg, 2),
            "trend": trend,
            "confidence": confidence,
            "factors": factors,
            "forecast_period": request.forecast_days,
            "data_points": len(sorted_values),
            "historical_monthly": historical_monthly,
            "weekly_pattern": weekly_pattern,
        }

        if request.include_product_forecast and request.products_data:
            result["product_forecasts"] = _product_level_forecast(
                request.historical_sales, request.products_data, request.forecast_days
            )

        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if api_key and len(sorted_values) >= 7:
            try:
                summary_prompt = f"""Analyze this sales forecast data for a business in Ghana (currency: ₵ GHS).

HISTORICAL: {len(sorted_values)} days of data. Recent 7-day avg: ₵{sum(sorted_values[-7:]) / min(7, len(sorted_values)):,.2f}
TREND: {trend} | CONFIDENCE: {confidence}
WEEKLY PATTERN: {', '.join(f'{wp["day"]}: {wp["multiplier"]:.2f}x' for wp in weekly_pattern)}
PREDICTED NEXT {request.forecast_days} DAYS AVG: ₵{predicted_avg:,.2f}

Provide 2-3 sentences of actionable analysis. Focus on what the owner should do, not just describe the data. Use ₵ symbol."""
                ai_summary = await call_llm(
                    api_key=api_key,
                    system_message="You are a sales forecasting analyst for a Ghanaian retail business. Be concise and actionable. Use ₵ for currency.",
                    prompt=summary_prompt,
                )
                result["ai_summary"] = ai_summary.strip()
            except Exception as e:
                logger.warning("AI summary for forecast failed: %s", e)

        return result

    except Exception as e:
        logger.error(f"Advanced forecast error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate advanced forecast: {str(e)}")


@api_router.post("/ai/chat")
async def ai_chat(data: Dict[str, Any], authorization: Optional[str] = Header(None)):
    """General AI chat for business questions; uses tool-style snapshot when datasets are sent."""
    try:
        question = (data.get("question") or "").strip()
        context = data.get("context", {}) if isinstance(data.get("context"), dict) else {}
        datasets = _sanitize_chat_datasets(data.get("datasets"))
        history = _sanitize_chat_history(data.get("history"))
        api_key = os.environ.get("EMERGENT_LLM_KEY")

        if not question:
            raise HTTPException(status_code=400, detail="question is required")

        if ai_chat_auth_enforced():
            if not ensure_firebase_admin_app():
                raise HTTPException(
                    status_code=503,
                    detail="AI chat authentication is required but Firebase Admin is not configured.",
                )
            try:
                claims = verify_bearer_id_token(authorization)
                uid = claims.get("uid") or claims.get("sub") or ""
                if uid:
                    check_ai_chat_rate_limit(uid)
            except ValueError:
                raise HTTPException(
                    status_code=401,
                    detail="Authentication required. Sign in and retry, or pass a valid Firebase ID token.",
                )
            except PermissionError:
                raise HTTPException(status_code=429, detail="Too many AI chat requests. Try again shortly.")
            except Exception as auth_exc:
                logger.warning("Firebase token verification failed: %s", auth_exc)
                raise HTTPException(status_code=401, detail="Invalid or expired authentication token.")

        if not api_key:
            return {"response": "AI chat is not configured. Please set the EMERGENT_LLM_KEY environment variable."}

        snapshot = compute_business_snapshot(datasets)
        snapshot_json = snapshot_json_for_prompt(snapshot)

        system_message = (
            "You are a helpful business advisor specializing in retail, inventory management, and bookkeeping. "
            "This business operates in Ghana. Always use the Ghana Cedi symbol ₵ (GHS) for all monetary values, never $. "
            "When get_business_snapshot results are provided, treat them as the source of truth for numbers; do not invent figures."
        )

        context_block = (
            "\n".join([f"- {k}: {v}" for k, v in context.items()])
            if context
            else "No additional summary context provided."
        )

        history_block = ""
        if history:
            history_block = (
                "Prior conversation (same session):\n"
                + "\n".join(f"{t['role'].upper()}: {t['content']}" for t in history)
                + "\n\n"
            )

        if HAS_EMERGENT:
            prompt = f"""{history_block}Business Question: {question}

High-level summary (may omit detail):
{context_block}

Structured business metrics (from client-loaded data; use for factual answers):
{snapshot_json}

Provide a helpful, concise response focused on actionable business advice. For inventory and restock questions, cite specific products from the structured metrics when relevant."""

            response = await call_llm(
                api_key=api_key,
                system_message=system_message,
                prompt=prompt,
            )
            return {"response": response, "agent_mode": "snapshot_prompt", "snapshot_meta": snapshot.get("computed_at")}

        response = await _ai_chat_with_openai_tools(
            api_key=api_key,
            system_message=system_message,
            user_question=f"Summary context:\n{context_block}\n\nQuestion:\n{question}",
            snapshot_json=snapshot_json,
            history=history,
        )
        return {"response": response, "agent_mode": "openai_tools", "snapshot_meta": snapshot.get("computed_at")}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")

# ==================== REPORT ENDPOINTS ====================

class ReportRequest(BaseModel):
    report_type: str  # tax_summary, ar_aging, stock_movement, period_comparison
    sales_data: List[Dict[str, Any]] = []
    expenses_data: List[Dict[str, Any]] = []
    products_data: List[Dict[str, Any]] = []
    customers_data: List[Dict[str, Any]] = []
    liabilities_data: List[Dict[str, Any]] = []
    date_start: Optional[str] = None
    date_end: Optional[str] = None
    business_name: str = "Ultimate Bookkeeping"
    include_ai_summary: bool = False


def _compute_tax_summary(sales: list, expenses: list, start: str, end: str) -> dict:
    """Compute tax collected on sales and deductible taxes on expenses."""
    filtered_sales = [s for s in sales if (not start or s.get("date", "") >= start) and (not end or s.get("date", "") <= end)]
    filtered_expenses = [e for e in expenses if (not start or e.get("date", "") >= start) and (not end or e.get("date", "") <= end)]

    tax_collected = 0.0
    taxable_sales_total = 0.0
    exempt_sales_total = 0.0
    tax_by_rate = defaultdict(lambda: {"sales_count": 0, "taxable_amount": 0.0, "tax_amount": 0.0})

    for s in filtered_sales:
        tax_rate = float(s.get("tax", 0) or 0)
        qty = float(s.get("quantity", 1) or 1)
        price = float(s.get("price", 0) or 0)
        discount = float(s.get("discount", 0) or 0)
        subtotal = qty * price * (1 - discount / 100)
        tax_amt = subtotal * (tax_rate / 100)

        if tax_rate > 0:
            taxable_sales_total += subtotal
            tax_collected += tax_amt
            bucket = f"{tax_rate}%"
            tax_by_rate[bucket]["sales_count"] += 1
            tax_by_rate[bucket]["taxable_amount"] += subtotal
            tax_by_rate[bucket]["tax_amount"] += tax_amt
        else:
            exempt_sales_total += subtotal

    input_tax = 0.0
    for e in filtered_expenses:
        amt = float(e.get("amount", 0) or 0)
        e_tax = float(e.get("tax", 0) or 0)
        if e_tax > 0:
            input_tax += amt * (e_tax / 100)

    return {
        "period": {"start": start or "all", "end": end or "all"},
        "total_sales_revenue": round(taxable_sales_total + exempt_sales_total, 2),
        "taxable_sales": round(taxable_sales_total, 2),
        "exempt_sales": round(exempt_sales_total, 2),
        "output_tax_collected": round(tax_collected, 2),
        "input_tax_on_expenses": round(input_tax, 2),
        "net_tax_payable": round(tax_collected - input_tax, 2),
        "tax_breakdown": {k: {kk: round(vv, 2) for kk, vv in v.items()} for k, v in tax_by_rate.items()},
        "total_transactions": len(filtered_sales),
    }


def _compute_ar_aging(customers: list, sales: list) -> dict:
    """Compute accounts receivable aging by customer."""
    today = datetime.now(timezone.utc).date()
    buckets = {"current": [], "days_30": [], "days_60": [], "days_90_plus": []}
    total_receivable = 0.0

    for c in customers:
        balance = float(c.get("balance", 0) or 0)
        if balance <= 0:
            continue
        total_receivable += balance
        last_purchase = c.get("lastPurchase") or c.get("last_purchase", "")
        if last_purchase:
            try:
                lp_date = datetime.fromisoformat(last_purchase.replace("Z", "+00:00")).date() if "T" in last_purchase else datetime.strptime(last_purchase, "%Y-%m-%d").date()
                age_days = (today - lp_date).days
            except Exception:
                age_days = 999
        else:
            age_days = 999

        entry = {
            "customer": c.get("name", c.get("id", "Unknown")),
            "email": c.get("email", ""),
            "phone": c.get("phone", ""),
            "balance": round(balance, 2),
            "age_days": age_days,
            "last_purchase": last_purchase or "N/A",
        }

        if age_days <= 30:
            buckets["current"].append(entry)
        elif age_days <= 60:
            buckets["days_30"].append(entry)
        elif age_days <= 90:
            buckets["days_60"].append(entry)
        else:
            buckets["days_90_plus"].append(entry)

    for k in buckets:
        buckets[k].sort(key=lambda x: x["balance"], reverse=True)

    return {
        "total_receivable": round(total_receivable, 2),
        "current": {"total": round(sum(e["balance"] for e in buckets["current"]), 2), "count": len(buckets["current"]), "entries": buckets["current"]},
        "days_30": {"total": round(sum(e["balance"] for e in buckets["days_30"]), 2), "count": len(buckets["days_30"]), "entries": buckets["days_30"]},
        "days_60": {"total": round(sum(e["balance"] for e in buckets["days_60"]), 2), "count": len(buckets["days_60"]), "entries": buckets["days_60"]},
        "days_90_plus": {"total": round(sum(e["balance"] for e in buckets["days_90_plus"]), 2), "count": len(buckets["days_90_plus"]), "entries": buckets["days_90_plus"]},
    }


def _compute_period_comparison(sales: list, expenses: list, start: str, end: str) -> dict:
    """Compare current period to the equivalent previous period."""
    if not start or not end:
        return {"error": "Both start and end dates are required for comparison"}

    try:
        s_date = datetime.strptime(start, "%Y-%m-%d").date()
        e_date = datetime.strptime(end, "%Y-%m-%d").date()
    except Exception:
        return {"error": "Invalid date format. Use YYYY-MM-DD"}

    period_days = (e_date - s_date).days
    prev_end = s_date - timedelta(days=1)
    prev_start = prev_end - timedelta(days=period_days)

    def _period_metrics(s_list, e_list, ps, pe):
        ps_str, pe_str = ps.isoformat(), pe.isoformat()
        fs = [s for s in s_list if ps_str <= s.get("date", "") <= pe_str]
        fe = [e for e in e_list if ps_str <= e.get("date", "") <= pe_str]
        revenue = sum(float(s.get("total", 0) or (float(s.get("quantity", 0) or 0) * float(s.get("price", 0) or 0))) for s in fs)
        exp_total = sum(float(e.get("amount", 0) or 0) for e in fe)
        return {
            "revenue": round(revenue, 2),
            "expenses": round(exp_total, 2),
            "profit": round(revenue - exp_total, 2),
            "transaction_count": len(fs),
            "avg_transaction": round(revenue / len(fs), 2) if fs else 0,
        }

    current = _period_metrics(sales, expenses, s_date, e_date)
    previous = _period_metrics(sales, expenses, prev_start, prev_end)

    def _pct(cur, prev_val):
        if prev_val == 0:
            return 100.0 if cur > 0 else 0.0
        return round((cur - prev_val) / abs(prev_val) * 100, 1)

    return {
        "current_period": {"start": start, "end": end, **current},
        "previous_period": {"start": prev_start.isoformat(), "end": prev_end.isoformat(), **previous},
        "changes": {
            "revenue_pct": _pct(current["revenue"], previous["revenue"]),
            "expenses_pct": _pct(current["expenses"], previous["expenses"]),
            "profit_pct": _pct(current["profit"], previous["profit"]),
            "transactions_pct": _pct(current["transaction_count"], previous["transaction_count"]),
        },
    }


@api_router.post("/reports/generate")
async def generate_report(request: ReportRequest):
    """Generate computed report data for the frontend to render or export."""
    try:
        result = {"report_type": request.report_type, "business_name": request.business_name, "generated_at": datetime.now(timezone.utc).isoformat()}

        if request.report_type == "tax_summary":
            result["data"] = _compute_tax_summary(request.sales_data, request.expenses_data, request.date_start, request.date_end)

        elif request.report_type == "ar_aging":
            result["data"] = _compute_ar_aging(request.customers_data, request.sales_data)

        elif request.report_type == "period_comparison":
            result["data"] = _compute_period_comparison(request.sales_data, request.expenses_data, request.date_start, request.date_end)

        else:
            raise HTTPException(status_code=400, detail=f"Unknown report type: {request.report_type}")

        if request.include_ai_summary:
            api_key = os.environ.get("EMERGENT_LLM_KEY")
            if api_key:
                try:
                    summary_prompt = f"""Analyze this {request.report_type.replace('_', ' ')} report for a business in Ghana and provide a brief (3-4 sentences) executive summary with actionable recommendations.

Report data: {json.dumps(result['data'], default=str)[:3000]}

Respond concisely in plain text, no markdown. Use GHS for currency."""
                    result["ai_summary"] = await call_llm(
                        api_key=api_key,
                        system_message="You are a financial analyst for a Ghana-based retail business. Provide concise, actionable insights. Use GHS for currency.",
                        prompt=summary_prompt,
                    )
                except Exception as e:
                    logger.warning("AI summary for report failed: %s", e)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Report generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")


# ==================== EMAIL ENDPOINTS ====================

from email_service import email_service
from scheduler import report_scheduler


@api_router.post("/email/stock-alert")
async def email_stock_alert(request: StockAlertEmailRequest):
    if not email_service.configured:
        raise HTTPException(status_code=503, detail="Email service not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing)")
    ok = await email_service.send_stock_alert(request.products, request.recipient, request.business_name)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to send stock alert email")
    return {"status": "sent", "recipient": request.recipient}


@api_router.post("/email/send-report")
async def email_send_report(request: SendReportRequest):
    if not email_service.configured:
        raise HTTPException(status_code=503, detail="Email service not configured")
    if request.report_type == "daily":
        ok = await email_service.send_daily_summary(request.data, request.recipient, request.business_name)
    elif request.report_type == "weekly":
        ok = await email_service.send_weekly_summary(request.data, request.recipient, request.business_name)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown report type: {request.report_type}")
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to send report email")
    return {"status": "sent", "report_type": request.report_type, "recipient": request.recipient}


@api_router.post("/email/test")
async def email_test(request: TestEmailRequest):
    if not email_service.configured:
        raise HTTPException(status_code=503, detail="Email service not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing)")
    ok = await email_service.send_test(request.recipient)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to send test email")
    return {"status": "sent", "recipient": request.recipient}


@api_router.post("/email/settings")
async def email_update_settings(request: EmailSettingsRequest):
    report_scheduler.update_schedule(request.model_dump())
    return {"status": "updated", "emailNotifications": request.emailNotifications, "dailyReports": request.dailyReports}


@api_router.post("/metrics/events")
async def ingest_metrics_event(request: MetricsEventRequest):
    """
    Best-effort ingestion for frontend product metrics events.
    This endpoint is intentionally resilient: it should not break UX if storage is unavailable.
    """
    try:
        event_name = (request.event_name or "").strip()
        if not event_name:
            raise HTTPException(status_code=400, detail="event_name is required")

        now_iso = datetime.now(timezone.utc).isoformat()
        event_id = request.event_id or str(uuid.uuid4())
        correlation_id = request.correlation_id or event_id

        event_doc = request.model_dump()
        event_doc["event_name"] = event_name
        event_doc["event_id"] = event_id
        event_doc["correlation_id"] = correlation_id
        event_doc["timestamp_server"] = now_iso
        event_doc["received_at"] = now_iso
        event_doc["received_at_dt"] = datetime.now(timezone.utc)

        if db is not None:
            try:
                await db.metrics_events.insert_one(event_doc)
            except Exception as db_exc:
                logger.warning("Metrics event storage failed; accepted anyway: %s", db_exc)
        else:
            logger.info("Metrics event accepted without DB: %s", event_name)

        return {
            "status": "accepted",
            "event_id": event_id,
            "correlation_id": correlation_id,
            "timestamp_server": now_iso
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Metrics ingestion error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to ingest metrics event")


@api_router.get("/metrics/events/health")
async def metrics_events_health():
    """
    Lightweight health/readiness endpoint for metrics ingestion.
    Returns ingestion counts for the last 1h and 24h when DB is available.
    """
    now = datetime.now(timezone.utc)
    hour_ago = now - timedelta(hours=1)
    day_ago = now - timedelta(hours=24)

    if db is None:
        return {
            "status": "ok",
            "storage": "disabled",
            "counts": {
                "last_1h": 0,
                "last_24h": 0
            },
            "timestamp_server": now.isoformat()
        }

    try:
        col = db.metrics_events
        count_1h = await col.count_documents({"received_at_dt": {"$gte": hour_ago}})
        count_24h = await col.count_documents({"received_at_dt": {"$gte": day_ago}})
        return {
            "status": "ok",
            "storage": "mongo",
            "counts": {
                "last_1h": count_1h,
                "last_24h": count_24h
            },
            "timestamp_server": now.isoformat()
        }
    except Exception as e:
        logger.warning("Metrics health query failed: %s", e)
        return {
            "status": "degraded",
            "storage": "mongo",
            "counts": {
                "last_1h": None,
                "last_24h": None
            },
            "timestamp_server": now.isoformat()
        }


# Registered after all concrete /api routes so GET/POST paths are not shadowed by this pattern.
@api_router.options("/{full_path:path}")
async def cors_preflight_handler(full_path: str):
    """
    Handle CORS preflight requests explicitly so that Cloud Run never returns 404
    for OPTIONS on /api/... paths (which would cause browsers to block requests).
    The CORSMiddleware will attach the appropriate CORS headers.
    """
    return Response(status_code=204)


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_services():
    try:
        report_scheduler.start()
        logger.info("Report scheduler started")
    except Exception as exc:
        logger.warning("Report scheduler could not start: %s", exc)

    if db is not None:
        try:
            await db.metrics_events.create_index(
                [("received_at_dt", -1)],
                name="idx_metrics_received_at_dt_desc"
            )
            logger.info("Metrics index ensured: idx_metrics_received_at_dt_desc")
        except Exception as exc:
            logger.warning("Metrics index ensure failed: %s", exc)


@app.on_event("shutdown")
async def shutdown_services():
    report_scheduler.stop()
    if client is not None:
        client.close()
