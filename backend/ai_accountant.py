"""
AI Accountant Skill
-------------------
Agentic accountant with live Firestore access (via Firebase Admin SDK).
Reads tenant-isolated data using the verified UID from the Bearer token.

Tools available to the LLM:
  get_financial_summary  — revenue, expenses, net profit for a period
  get_sales_breakdown    — top products, daily trend, outlet split
  get_expense_breakdown  — by category, flagged uncategorised items
  get_liabilities        — active debts, repayment progress
  classify_expense       — suggest a category for a description
  get_vat_summary        — Ghana VAT (15%) and levy summary
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# ── Ghana tax constants ────────────────────────────────────────────────────
VAT_RATE          = 0.15
NHIL_RATE         = 0.025
GETFUND_RATE      = 0.025
COVID_LEVY_RATE   = 0.01
EFFECTIVE_VAT     = VAT_RATE + NHIL_RATE + GETFUND_RATE + COVID_LEVY_RATE  # 20.5%


def _load_knowledge_base() -> str:
    """Load accountant.md from the project root if present, else return empty string."""
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "accountant.md"),
        os.path.join(os.path.dirname(__file__), "accountant.md"),
    ]
    for path in candidates:
        try:
            with open(os.path.normpath(path), "r", encoding="utf-8") as f:
                return f.read().strip()
        except FileNotFoundError:
            continue
    logger.warning("accountant.md not found — running without knowledge base preamble")
    return ""


_KNOWLEDGE_BASE = _load_knowledge_base()

_GHANA_RULES = """
---
## Ghana-Specific Identity & Operational Rules

Your name is **ChiefAccounts**. You operate exclusively in Ghana. All of the following
rules override the general guidance above wherever there is any conflict.

**Ghana tax rates (GRA):**
- VAT: 15%
- NHIL (National Health Insurance Levy): 2.5%
- GetFund Levy: 2.5%
- COVID-19 Health Recovery Levy: 1%
- Effective combined rate: 20.5%

**Mandatory rules — always follow without exception:**
1. Currency is always Ghana Cedi (₵) — never use $ or any other symbol.
2. Always call get_financial_summary before answering any profitability question.
3. Cite specific numbers from tool results — never invent or estimate figures.
4. Flag GRA compliance risks clearly with ⚠️.
5. Be concise and actionable — the user is a busy Ghanaian business owner, not an accountant.
6. When you see uncategorised expenses, offer to classify them.
7. Format all currency as ₵X,XXX.XX with commas for thousands.
8. P&L format must follow this exact structure every time:
   Revenue
   − Cost of Goods Sold (COGS)
   = Gross Profit  [gross margin %]
   − Operating Expenses
   = Operating Profit
   − Debt Payments (if any)
   = Net Profit  [net margin %]
   Never merge COGS into Operating Expenses. Never show a single "Total Expenses" line.
9. Revenue uses the stored 'total' field where present (POS precomputed), otherwise
   qty × price × (1 − discount%) × (1 + tax%). Never add tax on top of a tax-inclusive price.
10. For ANY monthly comparison, best/worst month, or historical trend question —
    ALWAYS call get_monthly_breakdown (not get_financial_summary). It returns all months
    in one call. Never guess date ranges or loop get_financial_summary across months.
11. Scope rules — ALWAYS respect these:
    - Default scope is 'main' (main store only) for every tool unless the user specifies otherwise.
    - When the user mentions a specific outlet by name, call list_outlets first to resolve the
      exact name, then pass that name as scope.
    - Only use scope='all' when the user explicitly asks for consolidated, combined, or
      all-outlet figures.
    - Always state the scope clearly in your response: "Main store only:", "Branch X:", "Consolidated (all outlets):"

You have live access to the business's Firestore records via tools. Always call the
relevant tool before answering any financial question — never rely on prior context alone.
"""

SYSTEM_PROMPT = (_KNOWLEDGE_BASE + "\n\n" + _GHANA_RULES).strip() if _KNOWLEDGE_BASE else _GHANA_RULES.strip()


def _safe_float(v, default=0.0):
    try:
        return float(v) if v not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _sale_total(s: Dict) -> float:
    """
    Canonical sale total — mirrors getSaleTotal() in accounting.js.
    1. Use s['total'] if present and finite (POS-written precomputed value).
    2. Derive from qty × price × (1 − discount%) × (1 + tax%).
    """
    explicit = _safe_float(s.get("total"), float("nan"))
    if not (explicit != explicit):  # NaN check: nan != nan is True
        return explicit
    qty      = _safe_float(s.get("quantity"), 0)
    price    = _safe_float(s.get("price"),    0)
    discount = _safe_float(s.get("discount"), 0)
    tax      = _safe_float(s.get("tax"),      0)
    return qty * price * (1 - discount / 100) * (1 + tax / 100)


def _is_debt_payment(expense: Dict) -> bool:
    """
    Mirrors isDebtPayment() in accounting.js.
    Debt/loan repayments are financing cash flows, not operating expenses.
    """
    e_type = (expense.get("expenseType") or "").lower()
    cat    = (expense.get("category")    or "").lower()
    return e_type == "liability_payment" or cat in ("debt payment", "loan repayment")


def _sale_cogs(s: Dict, product_cost_map: Dict[str, float]) -> float:
    """
    Cost of Goods Sold for a single sale.
    1. Use sale-time cost snapshot (s['cost']) — written at POS when product was sold.
    2. Fall back to current product cost from the products collection.
    Both mirror the same logic the frontend uses in its profit analysis (app-controller:3633).
    """
    qty = _safe_float(s.get("quantity"), 0)
    if qty == 0:
        return 0.0
    unit_cost = _safe_float(s.get("cost"), float("nan"))
    if not (unit_cost != unit_cost):  # not NaN — snapshot present
        return qty * unit_cost
    # Fall back to current product cost by name
    product_name = s.get("product") or ""
    fallback = product_cost_map.get(product_name, 0.0)
    return qty * fallback


def _parse_date(v: Any) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        # Strip tz info so comparisons against naive parsed dates don't TypeError
        return v.replace(tzinfo=None) if v.tzinfo else v
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(v)[:10], fmt)
        except ValueError:
            continue
    return None


def _in_period(date_str: Any, start: Optional[str], end: Optional[str]) -> bool:
    d = _parse_date(date_str)
    if not d:
        return True  # include if date unknown
    if start:
        s = _parse_date(start)
        if s and d < s:
            return False
    if end:
        e = _parse_date(end)
        if e and d > e:
            return False
    return True


# ── Firestore helpers ──────────────────────────────────────────────────────

def _get_firestore():
    """Return a Firestore client, or None if Admin SDK unavailable."""
    try:
        from firebase_admin import firestore as fs
        return fs.client()
    except Exception:
        return None


def _fetch_collection(db, *path_parts) -> List[Dict]:
    """Fetch all docs from a Firestore collection path (alternating col/doc segments)."""
    try:
        ref = db.collection(path_parts[0])
        for i, part in enumerate(path_parts[1:], 1):
            # Odd positions are document IDs, even positions are sub-collection names
            ref = ref.document(part) if (i % 2 == 1) else ref.collection(part)
        return [{"id": doc.id, **doc.to_dict()} for doc in ref.stream()]
    except Exception as exc:
        logger.warning("Firestore fetch %s failed: %s", "/".join(str(p) for p in path_parts), exc)
        return []


def _fetch_user_collection(db, uid: str, name: str) -> List[Dict]:
    """
    Fetch user's collection by merging three sources and deduplicating by doc ID.
    All strategies run unconditionally — short-circuiting dropped historical data.

    1. users/{uid}/{name}              — subcollection (outlet/new layout)
    2. root/{name} where createdBy==uid — docs with ownership field (fast Firestore filter)
    3. root/{name} legacy filter       — docs without createdBy (written before field was enforced)
                                         Mirrors Firestore security rule default:
                                         get('createdBy', requestUid) == requestUid
                                         so another user's docs (createdBy != uid) are excluded.
    """
    seen: set = set()
    result: List[Dict] = []

    def _merge(docs):
        for d in docs:
            if d["id"] not in seen:
                seen.add(d["id"])
                result.append(d)

    # 1 — user subcollection
    try:
        _merge([{"id": d.id, **d.to_dict()} for d in
                db.collection("users").document(uid).collection(name).stream()])
    except Exception as exc:
        logger.warning("Firestore users/%s/%s failed: %s", uid, name, exc)

    # 2 — root collection filtered by createdBy (indexed, fast)
    try:
        _merge([{"id": d.id, **d.to_dict()} for d in
                db.collection(name).where("createdBy", "==", uid).stream()])
    except Exception:
        pass

    # 3 — legacy docs that predate the createdBy field.
    #     Read all, then keep only docs where createdBy is absent (legacy) or matches uid.
    #     Docs belonging to another user have createdBy set to their uid and are excluded.
    try:
        legacy = [
            {"id": d.id, **d.to_dict()}
            for d in db.collection(name).stream()
            if d.to_dict().get("createdBy", uid) == uid
        ]
        _merge(legacy)
    except Exception as exc:
        logger.warning("Firestore root/%s legacy scan failed: %s", name, exc)

    return result


# ── Scope helpers ─────────────────────────────────────────────────────────
# scope values:
#   "main"           → root collections only (main store, no outlets)
#   "all"            → root + all outlet subcollections (consolidated)
#   "<outlet name>"  → that outlet's subcollections only

def _get_outlets_map(db, uid: str) -> Dict[str, Dict]:
    """
    Returns {outlet_name_lower: {id, name, location}} for all outlets belonging to uid.
    Used by scoped fetchers to resolve outlet names to Firestore IDs.
    """
    result = {}
    try:
        for doc in db.collection("users").document(uid).collection("outlets").stream():
            data = doc.to_dict() or {}
            name = (data.get("name") or doc.id).strip()
            result[name.lower()] = {"id": doc.id, "name": name, "location": data.get("location") or ""}
    except Exception as exc:
        logger.warning("Could not fetch outlets for %s: %s", uid, exc)
    return result


def _resolve_outlet(scope: str, outlets_map: Dict[str, Dict]) -> Optional[Dict]:
    """Fuzzy-match a scope string to an outlet entry. Returns None if not found."""
    s = scope.lower().strip()
    # Exact match first
    if s in outlets_map:
        return outlets_map[s]
    # Substring match
    for key, info in outlets_map.items():
        if s in key or key in s:
            return info
    return None


def _fetch_scoped(
    db, uid: str,
    root_col: str,
    outlet_sub_col: str,
    scope: str,
    outlets_map: Dict[str, Dict],
) -> List[Dict]:
    """
    Fetch documents from a collection according to scope:
      "main" → root collection only (main store)
      "all"  → root + every outlet subcollection (consolidated)
      name   → that outlet's subcollection only
    Deduplicates by document id.
    """
    seen: set = set()
    result: List[Dict] = []

    def _merge(docs):
        for d in docs:
            if d["id"] not in seen:
                seen.add(d["id"])
                result.append(d)

    if scope == "main":
        _merge(_fetch_user_collection(db, uid, root_col))

    elif scope == "all":
        _merge(_fetch_user_collection(db, uid, root_col))
        for info in outlets_map.values():
            _merge(_fetch_collection(db, "users", uid, "outlets", info["id"], outlet_sub_col))

    else:
        info = _resolve_outlet(scope, outlets_map)
        if info:
            _merge(_fetch_collection(db, "users", uid, "outlets", info["id"], outlet_sub_col))
        else:
            logger.warning("Outlet not found for scope=%r", scope)

    return result


def _tool_list_outlets(uid: str) -> Dict:
    """List all outlets for the user — call this before using a named scope."""
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable"}
    outlets_map = _get_outlets_map(db, uid)
    if not outlets_map:
        return {
            "outlets": [],
            "note": "No outlets found. This account has a main store only. Use scope='main'.",
        }
    return {
        "outlets": [
            {"name": v["name"], "location": v["location"], "id": v["id"]}
            for v in outlets_map.values()
        ],
        "note": "Use scope='main' for main store, scope='all' for consolidated, or scope='<outlet name>' for a specific branch.",
    }


# ── Tool implementations ───────────────────────────────────────────────────

def _build_product_cost_map(db, uid: str) -> Dict[str, float]:
    """Build {product_name: unit_cost} from the products collection for COGS fallback."""
    products = _fetch_user_collection(db, uid, "products")
    return {
        p.get("name", ""): _safe_float(p.get("cost"), 0.0)
        for p in products
        if p.get("name")
    }


def _tool_get_financial_summary(uid: str, start: Optional[str], end: Optional[str], scope: str = "main") -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable — Firebase Admin SDK not configured."}

    outlets_map = _get_outlets_map(db, uid)
    sales    = _fetch_scoped(db, uid, "sales",    "outlet_sales",    scope, outlets_map)
    expenses = _fetch_scoped(db, uid, "expenses", "outlet_expenses", scope, outlets_map)

    period_sales    = [s for s in sales    if _in_period(s.get("date") or s.get("createdAt"), start, end)]
    period_expenses = [e for e in expenses if _in_period(e.get("date") or e.get("createdAt"), start, end)]

    # Product cost map for COGS fallback (sales that lack a cost snapshot)
    product_cost_map = _build_product_cost_map(db, uid)

    # Revenue: use canonical _sale_total (checks s.total first, then derives from components)
    revenue = sum(_sale_total(s) for s in period_sales)

    # COGS: sale-time cost snapshot (s.cost × qty), falling back to current product cost
    cogs = sum(_sale_cogs(s, product_cost_map) for s in period_sales)

    # Separate operating expenses from debt/loan repayments
    operating_expenses = [e for e in period_expenses if not _is_debt_payment(e)]
    debt_payments      = [e for e in period_expenses if     _is_debt_payment(e)]

    total_opex  = sum(_safe_float(e.get("amount", 0)) for e in operating_expenses)
    total_debt  = sum(_safe_float(e.get("amount", 0)) for e in debt_payments)
    uncategorised = [e for e in operating_expenses if not e.get("category")]

    gross_profit     = revenue - cogs
    operating_profit = gross_profit - total_opex
    net_profit       = operating_profit - total_debt
    gross_margin     = (gross_profit / revenue * 100) if revenue else 0
    net_margin       = (net_profit   / revenue * 100) if revenue else 0

    return {
        "period":                    {"start": start or "all time", "end": end or "present"},
        "revenue":                   round(revenue, 2),
        "cogs":                      round(cogs, 2),
        "gross_profit":              round(gross_profit, 2),
        "gross_margin_pct":          round(gross_margin, 1),
        "operating_expenses":        round(total_opex, 2),
        "operating_profit":          round(operating_profit, 2),
        "debt_payments":             round(total_debt, 2),
        "net_profit":                round(net_profit, 2),
        "net_profit_margin_pct":     round(net_margin, 1),
        "total_sales_transactions":  len(period_sales),
        "total_expense_records":     len(period_expenses),
        "operating_expense_records": len(operating_expenses),
        "uncategorised_expenses":    len(uncategorised),
        "scope": scope,
        "note": "COGS uses sale-time cost snapshot (s.cost) where recorded, else current product cost. Revenue uses stored total where available (POS), otherwise qty×price×(1-discount%)×(1+tax%).",
    }


def _tool_get_sales_breakdown(uid: str, start: Optional[str], end: Optional[str], scope: str = "main") -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable"}

    outlets_map  = _get_outlets_map(db, uid)
    sales        = _fetch_scoped(db, uid, "sales", "outlet_sales", scope, outlets_map)
    period_sales = [s for s in sales if _in_period(s.get("date") or s.get("createdAt"), start, end)]

    by_product: Dict[str, Dict] = {}
    by_date: Dict[str, float]   = {}
    by_outlet: Dict[str, float] = {}

    for s in period_sales:
        total = _sale_total(s)
        name = s.get("product", "Unknown")
        p    = by_product.setdefault(name, {"revenue": 0, "qty": 0})
        p["revenue"] += total
        p["qty"]     += _safe_float(s.get("quantity", 1))

        date_key = str(s.get("date", ""))[:10]
        by_date[date_key] = by_date.get(date_key, 0) + total

        outlet_key = s.get("locationName") or s.get("location") or "Main Shop"
        by_outlet[outlet_key] = by_outlet.get(outlet_key, 0) + total

    top_products = sorted(by_product.items(), key=lambda x: x[1]["revenue"], reverse=True)[:10]
    daily_trend  = sorted(by_date.items())[-14:]  # last 14 data points

    return {
        "period": {"start": start or "all time", "end": end or "present"},
        "total_transactions": len(period_sales),
        "top_products": [
            {"product": k, "revenue": round(v["revenue"], 2), "units_sold": int(v["qty"])}
            for k, v in top_products
        ],
        "daily_trend": [{"date": d, "revenue": round(r, 2)} for d, r in daily_trend],
        "by_outlet": {k: round(v, 2) for k, v in sorted(by_outlet.items(), key=lambda x: -x[1])},
        "scope": scope,
    }


def _tool_get_expense_breakdown(uid: str, start: Optional[str], end: Optional[str], scope: str = "main") -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable"}

    outlets_map = _get_outlets_map(db, uid)
    expenses    = _fetch_scoped(db, uid, "expenses", "outlet_expenses", scope, outlets_map)
    period      = [e for e in expenses if _in_period(e.get("date") or e.get("createdAt"), start, end)]

    operating = [e for e in period if not _is_debt_payment(e)]
    debt_pmts = [e for e in period if     _is_debt_payment(e)]

    by_category: Dict[str, float] = {}
    uncategorised = []

    for e in operating:
        cat    = e.get("category") or ""
        amount = _safe_float(e.get("amount", 0))
        if not cat:
            uncategorised.append({"id": e.get("id", ""), "description": e.get("description", ""), "amount": amount, "date": str(e.get("date", ""))[:10]})
        else:
            by_category[cat] = by_category.get(cat, 0) + amount

    sorted_cats = sorted(by_category.items(), key=lambda x: -x[1])
    total_opex  = sum(by_category.values()) + sum(u["amount"] for u in uncategorised)
    total_debt  = sum(_safe_float(e.get("amount", 0)) for e in debt_pmts)

    return {
        "period":             {"start": start or "all time", "end": end or "present"},
        "total_opex":         round(total_opex, 2),
        "total_debt_payments": round(total_debt, 2),
        "total_all_expenses": round(total_opex + total_debt, 2),
        "by_category":        [{"category": k, "amount": round(v, 2), "pct": round(v / total_opex * 100, 1) if total_opex else 0} for k, v in sorted_cats],
        "uncategorised":      uncategorised[:10],
        "uncategorised_count": len(uncategorised),
        "debt_payments_detail": [{"description": e.get("description",""), "amount": _safe_float(e.get("amount",0)), "date": str(e.get("date",""))[:10]} for e in debt_pmts[:5]],
        "scope": scope,
    }


def _tool_get_liabilities(uid: str) -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable"}

    liabilities = _fetch_user_collection(db, uid, "liabilities")
    payments    = _fetch_user_collection(db, uid, "payment_transactions")

    active = [l for l in liabilities if l.get("status", "active") != "paid"]
    paid   = [l for l in liabilities if l.get("status") == "paid"]

    total_debt    = sum(_safe_float(l.get("balance", 0)) for l in active)
    total_paid    = sum(_safe_float(p.get("amount", 0)) for p in payments)
    overdue       = [l for l in active if l.get("dueDate") and _parse_date(l.get("dueDate")) and _parse_date(l.get("dueDate")) < datetime.now()]

    sorted_active = sorted(active, key=lambda l: -_safe_float(l.get("interestRate", 0)))

    return {
        "total_active_debt": round(total_debt, 2),
        "total_paid_to_date": round(total_paid, 2),
        "active_liabilities": len(active),
        "paid_liabilities": len(paid),
        "overdue_count": len(overdue),
        "overdue_items": [{"creditor": l.get("creditor"), "balance": _safe_float(l.get("balance")), "due": str(l.get("dueDate", ""))[:10]} for l in overdue[:5]],
        "repayment_priority": [
            {
                "creditor":      l.get("creditor", ""),
                "type":          l.get("type", ""),
                "balance":       round(_safe_float(l.get("balance", 0)), 2),
                "interest_rate": _safe_float(l.get("interestRate", 0)),
                "due_date":      str(l.get("dueDate", ""))[:10],
            }
            for l in sorted_active[:8]
        ],
    }


def _tool_get_vat_summary(uid: str, start: Optional[str], end: Optional[str], scope: str = "main") -> Dict:
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable"}

    outlets_map = _get_outlets_map(db, uid)
    sales    = _fetch_scoped(db, uid, "sales",    "outlet_sales",    scope, outlets_map)
    expenses = _fetch_scoped(db, uid, "expenses", "outlet_expenses", scope, outlets_map)

    period_sales    = [s for s in sales    if _in_period(s.get("date") or s.get("createdAt"), start, end)]
    period_expenses = [e for e in expenses if _in_period(e.get("date") or e.get("createdAt"), start, end)]

    # Use canonical revenue (stored total where available)
    gross_revenue = sum(_sale_total(s) for s in period_sales)
    vat_collected   = round(gross_revenue * VAT_RATE, 2)
    nhil_collected  = round(gross_revenue * NHIL_RATE, 2)
    getfund         = round(gross_revenue * GETFUND_RATE, 2)
    covid_levy      = round(gross_revenue * COVID_LEVY_RATE, 2)
    total_tax       = round(gross_revenue * EFFECTIVE_VAT, 2)
    net_revenue     = round(gross_revenue - total_tax, 2)

    total_expenses  = sum(_safe_float(e.get("amount", 0)) for e in period_expenses)
    input_vat       = round(total_expenses * VAT_RATE, 2)
    vat_payable     = round(vat_collected - input_vat, 2)

    return {
        "period": {"start": start or "all time", "end": end or "present"},
        "gross_revenue": round(gross_revenue, 2),
        "net_revenue_excl_tax": net_revenue,
        "output_vat_15pct": vat_collected,
        "nhil_2_5pct": nhil_collected,
        "getfund_levy_2_5pct": getfund,
        "covid_health_levy_1pct": covid_levy,
        "total_tax_collected": total_tax,
        "input_vat_on_expenses": input_vat,
        "estimated_vat_payable_to_gra": max(0, vat_payable),
        "scope": scope,
        "note": "Estimates only. Actual VAT obligations depend on whether your business is VAT-registered with GRA.",
    }


def _tool_get_monthly_breakdown(uid: str, scope: str = "main") -> Dict:
    """
    Groups ALL sales and expenses by calendar month (YYYY-MM) in a single pass.
    Returns a sorted monthly P&L table so the LLM can compare months without
    making N individual get_financial_summary calls.
    """
    db = _get_firestore()
    if not db:
        return {"error": "Firestore unavailable — Firebase Admin SDK not configured."}

    outlets_map = _get_outlets_map(db, uid)
    sales    = _fetch_scoped(db, uid, "sales",    "outlet_sales",    scope, outlets_map)
    expenses = _fetch_scoped(db, uid, "expenses", "outlet_expenses", scope, outlets_map)

    product_cost_map = _build_product_cost_map(db, uid)

    # Group sales by month
    months: Dict[str, Dict] = {}

    def _month_key(doc) -> Optional[str]:
        d = _parse_date(doc.get("date") or doc.get("createdAt"))
        return d.strftime("%Y-%m") if d else None

    def _empty_month():
        return {"revenue": 0.0, "cogs": 0.0, "operating_expenses": 0.0, "debt_payments": 0.0, "sales_count": 0, "expense_count": 0}

    for s in sales:
        key = _month_key(s)
        if not key:
            continue
        m = months.setdefault(key, _empty_month())
        m["revenue"]     += _sale_total(s)
        m["cogs"]        += _sale_cogs(s, product_cost_map)
        m["sales_count"] += 1

    for e in expenses:
        key = _month_key(e)
        if not key:
            continue
        m = months.setdefault(key, _empty_month())
        amount = _safe_float(e.get("amount", 0))
        if _is_debt_payment(e):
            m["debt_payments"] += amount
        else:
            m["operating_expenses"] += amount
        m["expense_count"] += 1

    if not months:
        return {"error": "No data found for this account.", "months": []}

    sorted_keys = sorted(months.keys())

    rows = []
    for key in sorted_keys:
        m = months[key]
        rev              = m["revenue"]
        cogs             = m["cogs"]
        opex             = m["operating_expenses"]
        debt             = m["debt_payments"]
        gross_profit     = rev - cogs
        operating_profit = gross_profit - opex
        net_profit       = operating_profit - debt
        gross_margin     = round(gross_profit / rev * 100, 1) if rev else 0
        net_margin       = round(net_profit   / rev * 100, 1) if rev else 0
        rows.append({
            "month":               key,
            "revenue":             round(rev, 2),
            "cogs":                round(cogs, 2),
            "gross_profit":        round(gross_profit, 2),
            "gross_margin_pct":    gross_margin,
            "operating_expenses":  round(opex, 2),
            "operating_profit":    round(operating_profit, 2),
            "debt_payments":       round(debt, 2),
            "net_profit":          round(net_profit, 2),
            "net_margin_pct":      net_margin,
            "sales_transactions":  m["sales_count"],
            "expense_records":     m["expense_count"],
        })

    best = max(rows, key=lambda r: r["net_profit"])

    return {
        "scope":                  scope,
        "data_range":             {"first_month": sorted_keys[0], "last_month": sorted_keys[-1]},
        "total_months_with_data": len(rows),
        "best_month":             {"month": best["month"], "net_profit": best["net_profit"], "net_margin_pct": best["net_margin_pct"]},
        "months":                 rows,
    }


def _tool_classify_expense(description: str, api_key: str) -> Dict:
    """Use GPT to suggest a category for an expense description."""
    if not api_key:
        return {"suggested_category": "Miscellaneous", "confidence": "low", "reason": "LLM unavailable"}

    categories = [
        "Rent", "Utilities", "Transport", "Supplies", "Salaries & Wages",
        "Marketing", "Maintenance & Repairs", "Insurance", "Bank Charges",
        "Taxes & Levies", "Communication", "Food & Refreshments", "Equipment",
        "Security", "Miscellaneous"
    ]

    import asyncio

    async def _classify():
        client = AsyncOpenAI(api_key=api_key)
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a Ghana business expense classifier. Reply with JSON only."},
                {"role": "user", "content": (
                    f"Classify this expense into one category.\n"
                    f"Description: {description}\n"
                    f"Categories: {', '.join(categories)}\n"
                    f"Reply with: {{\"category\": \"...\", \"confidence\": \"high|medium|low\", \"reason\": \"...\"}}"
                )},
            ],
            temperature=0,
            max_tokens=80,
        )
        return resp.choices[0].message.content or ""

    try:
        raw = asyncio.get_event_loop().run_until_complete(_classify())
        return json.loads(raw.strip())
    except Exception as exc:
        logger.warning("classify_expense failed: %s", exc)
        return {"suggested_category": "Miscellaneous", "confidence": "low", "reason": str(exc)}


# ── Tool registry ──────────────────────────────────────────────────────────

ACCOUNTANT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_financial_summary",
            "description": "Returns revenue, total expenses, net profit, profit margin, and number of uncategorised expenses for a given period. Call this first for any profitability question.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "ISO date YYYY-MM-DD, or omit for all time"},
                    "end_date":   {"type": "string", "description": "ISO date YYYY-MM-DD, or omit for present"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sales_breakdown",
            "description": "Returns top-selling products by revenue, daily revenue trend, and revenue split by outlet.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string"},
                    "end_date":   {"type": "string"},
                    "scope":      {"type": "string", "description": "'main' (default), 'all' for consolidated, or outlet name"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_expense_breakdown",
            "description": "Returns expenses grouped by category with percentages. Flags uncategorised expenses.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string"},
                    "end_date":   {"type": "string"},
                    "scope":      {"type": "string", "description": "'main' (default), 'all' for consolidated, or outlet name"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_liabilities",
            "description": "Returns all active debts, overdue items, total balance, and repayment priority order (highest interest rate first).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_vat_summary",
            "description": "Estimates Ghana VAT (15%), NHIL (2.5%), GetFund levy (2.5%), and COVID-19 levy (1%) for a period. Shows estimated VAT payable to GRA.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string"},
                    "end_date":   {"type": "string"},
                    "scope":      {"type": "string", "description": "'main' (default), 'all' for consolidated, or outlet name"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "classify_expense",
            "description": "Suggests an expense category for a given description using AI. Use when the user asks to classify or fix uncategorised expenses.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "The expense description to classify"},
                },
                "required": ["description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_monthly_breakdown",
            "description": (
                "Returns a month-by-month P&L table covering ALL historical data in one call. "
                "Always call this — instead of get_financial_summary — when the user asks: "
                "which month had the highest/lowest profit, monthly trends, historical comparisons, "
                "best/worst month, year-over-year, or any question that spans multiple months."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "scope": {"type": "string", "description": "'main' (default), 'all' for consolidated, or outlet name"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_outlets",
            "description": (
                "Returns all outlet names and IDs for this account. "
                "Call this before using a named scope so you know the exact outlet names available."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _dispatch_tool(name: str, args: Dict, uid: str, api_key: str) -> str:
    start = args.get("start_date")
    end   = args.get("end_date")
    scope = args.get("scope", "main")

    if name == "get_financial_summary":
        result = _tool_get_financial_summary(uid, start, end, scope)
    elif name == "get_sales_breakdown":
        result = _tool_get_sales_breakdown(uid, start, end, scope)
    elif name == "get_expense_breakdown":
        result = _tool_get_expense_breakdown(uid, start, end, scope)
    elif name == "get_liabilities":
        result = _tool_get_liabilities(uid)
    elif name == "get_vat_summary":
        result = _tool_get_vat_summary(uid, start, end, scope)
    elif name == "classify_expense":
        result = _tool_classify_expense(args.get("description", ""), api_key)
    elif name == "get_monthly_breakdown":
        result = _tool_get_monthly_breakdown(uid, scope)
    elif name == "list_outlets":
        result = _tool_list_outlets(uid)
    else:
        result = {"error": f"Unknown tool: {name}"}

    return json.dumps(result, default=str)


# ── Agentic loop ───────────────────────────────────────────────────────────

async def run_accountant(
    question: str,
    uid: str,
    history: List[Dict],
    api_key: str,
    max_steps: int = 6,
) -> Dict[str, Any]:
    """
    Run the AI Accountant agent loop.
    Returns {"response": str, "tools_called": [str], "steps": int}
    """
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
            tools=ACCOUNTANT_TOOLS,
            tool_choice="auto",
            temperature=0.2,
            max_tokens=1200,
        )

        msg = resp.choices[0].message
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
                tool_result = _dispatch_tool(fn_name, fn_args, uid, api_key)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_result,
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
