"""
AI Inventory Manager Skill
--------------------------
Agentic inventory specialist with live Firestore access (Firebase Admin SDK).
Reads tenant-isolated data using the verified UID from the Bearer token.

Tools available to the LLM:
  get_inventory_status       — current stock levels, low-stock alerts, days remaining
  get_abc_analysis           — classify products by revenue contribution (A/B/C)
  get_reorder_recommendations — reorder point per product using real sales velocity
  get_stock_movements        — sales out + PO receipts in, for a product or all
  get_purchase_orders        — active and recent purchase orders
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

# Re-use shared helpers from the accountant module
from ai_accountant import (
    _safe_float,
    _parse_date,
    _in_period,
    _get_firestore,
    _fetch_collection,
    _fetch_user_collection,
    _sale_total,
)

logger = logging.getLogger(__name__)

DEFAULT_LEAD_TIME_DAYS = 7   # assumed supplier lead time when not stored on product
DEAD_STOCK_DAYS        = 60  # no sales movement in this many days = dead stock
LOW_STOCK_DAYS_WARNING = 14  # flag if days-of-stock < this threshold


# ── Knowledge base ─────────────────────────────────────────────────────────

def _load_skill_doc() -> str:
    candidates = [
        os.path.join(os.path.dirname(__file__), "inventory-manager.md"),
        os.path.join(os.path.dirname(__file__), "..", "inventory-manager.md"),
    ]
    for path in candidates:
        try:
            with open(os.path.normpath(path), "r", encoding="utf-8") as f:
                return f.read().strip()
        except FileNotFoundError:
            continue
    logger.warning("inventory-manager.md not found — running without knowledge base preamble")
    return ""


_SKILL_DOC = _load_skill_doc()

_INVENTORY_RULES = """
---
## Ghana Retail Context & Operational Rules

Your name is **StockMaster**. You operate in the Ghanaian retail market.

**Mandatory rules — always follow without exception:**
1. Currency is Ghana Cedi (₵) — never use $ or any other symbol.
2. Always call get_inventory_status before answering any stock question.
3. Cite specific numbers from tool results — never invent or estimate figures.
4. Flag stockout risks clearly with ⚠️ and dead stock with 🔴.
5. Be concise and actionable — the user is a busy business owner.
6. Format all currency as ₵X,XXX.XX with commas for thousands.
7. For reorder recommendations, always show the formula inputs (avg daily sales,
   lead time days, safety stock) before the reorder point result.
8. For ABC analysis, always produce a ranked table with cumulative revenue % column.
9. For ANY multi-SKU comparison, use a table — never prose lists.
10. When the user shares inventory data without a specific question, scan for the
    3 most important signals: stockout risk, dead stock, margin/costing issues.
    Lead with the most urgent finding.

You have live access to the business's Firestore records via tools. Always call the
relevant tool before answering any inventory question.
"""

SYSTEM_PROMPT = (_SKILL_DOC + "\n\n" + _INVENTORY_RULES).strip() if _SKILL_DOC else _INVENTORY_RULES.strip()


# ── Shared data helpers ────────────────────────────────────────────────────

def _fetch_all_products(db, uid: str) -> List[Dict]:
    """Fetch inventory (products) from root + outlet subcollections."""
    products = _fetch_user_collection(db, uid, "inventory")
    try:
        outlets = [d.id for d in db.collection("users").document(uid).collection("outlets").stream()]
        for oid in outlets:
            products += _fetch_collection(db, "users", uid, "outlets", oid, "outlet_inventory")
    except Exception:
        pass
    # Deduplicate by id
    seen, result = set(), []
    for p in products:
        if p["id"] not in seen:
            seen.add(p["id"])
            result.append(p)
    return result


def _fetch_all_sales(db, uid: str) -> List[Dict]:
    """Fetch sales from root + outlet subcollections."""
    sales = _fetch_user_collection(db, uid, "sales")
    try:
        outlets = [d.id for d in db.collection("users").document(uid).collection("outlets").stream()]
        for oid in outlets:
            sales += _fetch_collection(db, "users", uid, "outlets", oid, "outlet_sales")
    except Exception:
        pass
    seen, result = set(), []
    for s in sales:
        if s["id"] not in seen:
            seen.add(s["id"])
            result.append(s)
    return result


def _avg_daily_sales_qty(sales: List[Dict], product_name: str, days: int = 30) -> float:
    """Average units sold per day for a product over the last `days` days."""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    qty = sum(
        _safe_float(s.get("quantity"), 0)
        for s in sales
        if (s.get("product") == product_name or s.get("productName") == product_name)
        and str(s.get("date", ""))[:10] >= cutoff
    )
    return qty / days


# ── Tool implementations ───────────────────────────────────────────────────

def _tool_get_inventory_status(uid: str) -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable — Firebase Admin SDK not configured."}

    products = _fetch_all_products(db, uid)
    sales    = _fetch_all_sales(db, uid)

    if not products:
        return {"error": "No inventory records found.", "items": []}

    today = datetime.now().strftime("%Y-%m-%d")
    dead_cutoff = (datetime.now() - timedelta(days=DEAD_STOCK_DAYS)).strftime("%Y-%m-%d")

    items = []
    low_stock_count  = 0
    stockout_count   = 0
    dead_stock_count = 0

    for p in products:
        name      = p.get("name") or p.get("productName") or "Unknown"
        qty       = _safe_float(p.get("quantity"), 0)
        min_stock = _safe_float(p.get("minStock"), 10)
        cost      = _safe_float(p.get("cost"), 0)
        price     = _safe_float(p.get("price"), 0)

        avg_daily = _avg_daily_sales_qty(sales, name, days=30)
        days_remaining = round(qty / avg_daily, 1) if avg_daily > 0 else None

        # Dead stock: no sales in last DEAD_STOCK_DAYS days
        recent_sales = [
            s for s in sales
            if (s.get("product") == name or s.get("productName") == name)
            and str(s.get("date", ""))[:10] >= dead_cutoff
        ]
        is_dead = (len(recent_sales) == 0 and qty > 0)

        status = "ok"
        if qty == 0:
            status = "stockout"
            stockout_count += 1
        elif qty <= min_stock:
            status = "low"
            low_stock_count += 1
        if is_dead:
            dead_stock_count += 1

        stockout_risk = False
        if days_remaining is not None and days_remaining < DEFAULT_LEAD_TIME_DAYS:
            stockout_risk = True

        items.append({
            "name":              name,
            "category":          p.get("category") or "Uncategorised",
            "quantity":          round(qty, 0),
            "min_stock":         round(min_stock, 0),
            "status":            status,
            "avg_daily_sales":   round(avg_daily, 2),
            "days_remaining":    days_remaining,
            "stockout_risk":     stockout_risk,
            "is_dead_stock":     is_dead,
            "unit_cost":         round(cost, 2),
            "unit_price":        round(price, 2),
            "stock_value":       round(qty * cost, 2),
            "gross_margin_pct":  round((price - cost) / price * 100, 1) if price else 0,
        })

    items.sort(key=lambda x: (x["status"] != "stockout", x["status"] != "low", x["name"]))

    total_stock_value = sum(i["stock_value"] for i in items)

    return {
        "total_skus":        len(items),
        "stockout_count":    stockout_count,
        "low_stock_count":   low_stock_count,
        "dead_stock_count":  dead_stock_count,
        "total_stock_value": round(total_stock_value, 2),
        "items":             items,
        "note": f"Days remaining based on 30-day avg daily sales. Stockout risk = days_remaining < {DEFAULT_LEAD_TIME_DAYS} days (assumed lead time).",
    }


def _tool_get_abc_analysis(uid: str, days: int = 90) -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable"}

    sales = _fetch_all_sales(db, uid)
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    period_sales = [s for s in sales if str(s.get("date", ""))[:10] >= cutoff]

    by_product: Dict[str, Dict] = {}
    for s in period_sales:
        name = s.get("product") or s.get("productName") or "Unknown"
        rev  = _sale_total(s)
        qty  = _safe_float(s.get("quantity"), 0)
        p    = by_product.setdefault(name, {"revenue": 0.0, "units": 0, "transactions": 0})
        p["revenue"]      += rev
        p["units"]        += qty
        p["transactions"] += 1

    if not by_product:
        return {"error": f"No sales data found in the last {days} days.", "items": []}

    total_revenue = sum(v["revenue"] for v in by_product.values())
    ranked = sorted(by_product.items(), key=lambda x: -x[1]["revenue"])

    cumulative = 0.0
    items = []
    for name, data in ranked:
        rev_pct    = data["revenue"] / total_revenue * 100 if total_revenue else 0
        cumulative += rev_pct
        grade      = "A" if cumulative <= 80 else ("B" if cumulative <= 95 else "C")
        items.append({
            "product":         name,
            "revenue":         round(data["revenue"], 2),
            "revenue_pct":     round(rev_pct, 1),
            "cumulative_pct":  round(cumulative, 1),
            "units_sold":      int(data["units"]),
            "transactions":    data["transactions"],
            "grade":           grade,
        })

    a_count = sum(1 for i in items if i["grade"] == "A")
    b_count = sum(1 for i in items if i["grade"] == "B")
    c_count = sum(1 for i in items if i["grade"] == "C")

    return {
        "period_days":    days,
        "total_skus":     len(items),
        "total_revenue":  round(total_revenue, 2),
        "grade_summary":  {"A": a_count, "B": b_count, "C": c_count},
        "items":          items,
        "note": "A = top 80% of revenue, B = next 15%, C = bottom 5%. Focus management effort on A items.",
    }


def _tool_get_reorder_recommendations(uid: str) -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable"}

    products = _fetch_all_products(db, uid)
    sales    = _fetch_all_sales(db, uid)

    recommendations = []
    for p in products:
        name      = p.get("name") or "Unknown"
        qty       = _safe_float(p.get("quantity"), 0)
        min_stock = _safe_float(p.get("minStock"), 10)
        lead_time = _safe_float(p.get("leadTimeDays"), DEFAULT_LEAD_TIME_DAYS)
        cost      = _safe_float(p.get("cost"), 0)

        avg_daily = _avg_daily_sales_qty(sales, name, days=30)

        # Safety stock = 50% of demand during lead time (simple heuristic when σ unavailable)
        safety_stock = round(avg_daily * lead_time * 0.5, 1)
        rop          = round(avg_daily * lead_time + safety_stock, 1)

        # EOQ: √(2 × annual_demand × order_cost / holding_cost)
        # Assume order_cost = ₵50 flat, holding_cost = 20% of unit cost per year
        annual_demand = avg_daily * 365
        order_cost    = 50
        holding_cost  = cost * 0.20 if cost > 0 else 1
        eoq = round((2 * annual_demand * order_cost / holding_cost) ** 0.5, 0) if annual_demand > 0 else 0

        needs_reorder = qty <= rop
        recommendations.append({
            "product":         name,
            "current_stock":   round(qty, 0),
            "min_stock":       round(min_stock, 0),
            "avg_daily_sales": round(avg_daily, 2),
            "lead_time_days":  lead_time,
            "safety_stock":    safety_stock,
            "reorder_point":   rop,
            "eoq":             eoq,
            "needs_reorder":   needs_reorder,
            "suggested_order_qty": max(eoq, min_stock) if needs_reorder else 0,
            "unit_cost":       round(cost, 2),
        })

    recommendations.sort(key=lambda x: (not x["needs_reorder"], x["product"]))
    urgent = [r for r in recommendations if r["needs_reorder"]]

    return {
        "total_skus":        len(recommendations),
        "items_needing_reorder": len(urgent),
        "recommendations":   recommendations,
        "formula_note": (
            "ROP = (Avg Daily Sales × Lead Time Days) + Safety Stock. "
            "Safety stock = 50% of lead time demand (heuristic; update when σ(demand) is known). "
            f"Default lead time = {DEFAULT_LEAD_TIME_DAYS} days. "
            "EOQ = √(2 × Annual Demand × ₵50 order cost / 20% holding cost)."
        ),
    }


def _tool_get_stock_movements(uid: str, product_name: Optional[str], days: int = 30) -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable"}

    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    sales  = _fetch_all_sales(db, uid)

    if product_name:
        sales = [
            s for s in sales
            if (s.get("product") or "").lower() == product_name.lower()
            or (s.get("productName") or "").lower() == product_name.lower()
        ]

    period_sales = [s for s in sales if str(s.get("date", ""))[:10] >= cutoff]

    # Sales movements (stock out)
    out_movements = [
        {
            "date":        str(s.get("date", ""))[:10],
            "type":        "sale",
            "product":     s.get("product") or s.get("productName") or "Unknown",
            "qty_out":     _safe_float(s.get("quantity"), 0),
            "revenue":     round(_sale_total(s), 2),
            "customer":    s.get("customer") or "Walk-in",
        }
        for s in sorted(period_sales, key=lambda x: str(x.get("date", "")), reverse=True)
    ]

    # Purchase order receipts (stock in) — fetch recent POs
    try:
        pos = _fetch_user_collection(db, uid, "purchase_orders")
        period_pos = [
            p for p in pos
            if str(p.get("date") or p.get("createdAt") or "")[:10] >= cutoff
        ]
        in_movements = []
        for po in period_pos:
            items = po.get("items") or []
            for item in items:
                iname = item.get("productName") or item.get("name") or ""
                if product_name and iname.lower() != product_name.lower():
                    continue
                in_movements.append({
                    "date":     str(po.get("date") or po.get("createdAt") or "")[:10],
                    "type":     "purchase_receipt",
                    "product":  iname,
                    "qty_in":   _safe_float(item.get("quantity") or item.get("receivedQty"), 0),
                    "unit_cost": _safe_float(item.get("unitCost") or item.get("cost"), 0),
                    "po_ref":   po.get("id") or "",
                    "supplier": po.get("supplier") or po.get("supplierName") or "Unknown",
                })
    except Exception:
        in_movements = []

    total_out = sum(m["qty_out"] for m in out_movements)
    total_in  = sum(m["qty_in"]  for m in in_movements)

    return {
        "period_days":     days,
        "product_filter":  product_name or "all products",
        "total_sales_out": round(total_out, 0),
        "total_receipts_in": round(total_in, 0),
        "net_movement":    round(total_in - total_out, 0),
        "sales_movements": out_movements[:50],
        "receipt_movements": in_movements[:20],
    }


def _tool_get_purchase_orders(uid: str) -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable"}

    pos = _fetch_user_collection(db, uid, "purchase_orders")

    if not pos:
        return {"total": 0, "orders": [], "note": "No purchase orders found."}

    orders = []
    for po in pos:
        items     = po.get("items") or []
        total_val = sum(
            _safe_float(i.get("unitCost") or i.get("cost"), 0) *
            _safe_float(i.get("quantity") or i.get("receivedQty"), 0)
            for i in items
        )
        orders.append({
            "id":           po.get("id") or "",
            "date":         str(po.get("date") or po.get("createdAt") or "")[:10],
            "supplier":     po.get("supplier") or po.get("supplierName") or "Unknown",
            "status":       po.get("status") or "unknown",
            "item_count":   len(items),
            "total_value":  round(total_val, 2),
            "items":        [
                {
                    "product":   i.get("productName") or i.get("name") or "",
                    "ordered":   _safe_float(i.get("quantity"), 0),
                    "received":  _safe_float(i.get("receivedQty"), 0),
                    "unit_cost": _safe_float(i.get("unitCost") or i.get("cost"), 0),
                }
                for i in items
            ],
        })

    orders.sort(key=lambda x: x["date"], reverse=True)
    active = [o for o in orders if o["status"] not in ("completed", "cancelled", "received")]

    return {
        "total":        len(orders),
        "active_count": len(active),
        "orders":       orders[:20],
    }


# ── Tool registry ──────────────────────────────────────────────────────────

INVENTORY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_inventory_status",
            "description": (
                "Returns current stock levels for all products with status (ok/low/stockout), "
                "days of stock remaining based on 30-day sales velocity, stockout risk flags, "
                "dead stock identification, and total stock value. "
                "Always call this first for any stock or inventory question."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_abc_analysis",
            "description": (
                "Classifies all products by revenue contribution into A (top 80%), "
                "B (next 15%), C (bottom 5%) grades. Call for questions about which products "
                "matter most, where to focus buying effort, or stock prioritisation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "description": "Analysis period in days (default 90)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reorder_recommendations",
            "description": (
                "Calculates reorder point (ROP) and Economic Order Quantity (EOQ) for every "
                "product using actual 30-day sales velocity. Flags items that are at or below "
                "their reorder point and suggests order quantities. Call for reorder planning, "
                "'what should I order?', or replenishment questions."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stock_movements",
            "description": (
                "Returns sales (stock out) and purchase order receipts (stock in) over a period. "
                "Call for movement history, demand analysis, or to understand how fast a "
                "specific product sells."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_name": {"type": "string", "description": "Filter to a specific product name, or omit for all"},
                    "days":         {"type": "integer", "description": "Lookback period in days (default 30)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_purchase_orders",
            "description": (
                "Returns all purchase orders with supplier, status, item lines, quantities, "
                "and total value. Call for supplier analysis, open PO tracking, or three-way "
                "matching questions."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _dispatch_tool(name: str, args: Dict, uid: str) -> str:
    if name == "get_inventory_status":
        result = _tool_get_inventory_status(uid)
    elif name == "get_abc_analysis":
        result = _tool_get_abc_analysis(uid, days=int(args.get("days", 90)))
    elif name == "get_reorder_recommendations":
        result = _tool_get_reorder_recommendations(uid)
    elif name == "get_stock_movements":
        result = _tool_get_stock_movements(uid, args.get("product_name"), days=int(args.get("days", 30)))
    elif name == "get_purchase_orders":
        result = _tool_get_purchase_orders(uid)
    else:
        result = {"error": f"Unknown tool: {name}"}
    return json.dumps(result, default=str)


# ── Agentic loop ───────────────────────────────────────────────────────────

async def run_inventory(
    question: str,
    uid: str,
    history: List[Dict],
    api_key: str,
    max_steps: int = 6,
) -> Dict[str, Any]:
    client = AsyncOpenAI(api_key=api_key)
    today  = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT + f"\n\nToday's date: {today}. User UID: {uid}."},
    ]
    for h in history[-10:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": question})

    tools_called = []
    steps = 0

    while steps < max_steps:
        steps += 1
        resp = await client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=INVENTORY_TOOLS,
            tool_choice="auto",
            temperature=0.2,
            max_tokens=1500,
        )

        msg    = resp.choices[0].message
        finish = resp.choices[0].finish_reason

        if finish == "tool_calls" and msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                fn_name = tc.function.name
                try:
                    fn_args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    fn_args = {}

                tools_called.append(fn_name)
                tool_result = _dispatch_tool(fn_name, fn_args, uid)

                messages.append({
                    "role":        "tool",
                    "tool_call_id": tc.id,
                    "content":     tool_result,
                })
        else:
            return {
                "response":     msg.content or "I could not generate a response.",
                "tools_called": tools_called,
                "steps":        steps,
            }

    return {
        "response":     "I reached the maximum reasoning steps. Please try a more specific question.",
        "tools_called": tools_called,
        "steps":        steps,
    }
