"""
Structured P&L report data for automated email delivery.
Mirrors the canonical formula in CLAUDE.md:
  Revenue - COGS = Gross Profit - Op. Expenses = Op. Profit - Debt = Net Profit
"""

import logging
from datetime import datetime, timedelta
from collections import defaultdict

logger = logging.getLogger(__name__)


def _safe_float(v) -> float:
    try:
        f = float(v)
        return f if f == f else 0.0
    except (TypeError, ValueError):
        return 0.0


def _is_debt_payment(e: dict) -> bool:
    etype = (e.get("expenseType", "") or "").lower()
    cat = (e.get("category", "") or "").lower()
    return etype == "liability_payment" or cat in ("debt payment", "loan repayment")


def _sale_total(s: dict) -> float:
    t = _safe_float(s.get("total"))
    if t > 0:
        return t
    qty = _safe_float(s.get("quantity", 1))
    price = _safe_float(s.get("price") or s.get("sellingPrice") or s.get("unitPrice"))
    discount = _safe_float(s.get("discount", 0)) / 100
    tax = _safe_float(s.get("tax") or s.get("vatRate") or 0) / 100
    return qty * price * (1 - discount) * (1 + tax)


def _sale_cogs(s: dict, cost_map: dict) -> float:
    qty = _safe_float(s.get("quantity", 1))
    snapshot = _safe_float(s.get("cost"))
    if snapshot > 0:
        return qty * snapshot
    name = (s.get("product") or s.get("productName") or "").strip().lower()
    return qty * cost_map.get(name, 0.0)


def _in_period(doc: dict, start: datetime, end: datetime) -> bool:
    for field in ("date", "createdAt", "timestamp", "saleDate"):
        raw = doc.get(field)
        if raw is None:
            continue
        if hasattr(raw, "isoformat"):
            dt = raw.replace(tzinfo=None) if getattr(raw, "tzinfo", None) else raw
            return start <= dt < end
        if isinstance(raw, str) and len(raw) >= 10:
            try:
                dt = datetime.fromisoformat(raw[:10])
                return start <= dt < end
            except ValueError:
                continue
    return False


def _build_cost_map(db) -> dict:
    cost_map = {}
    for coll in ("products", "inventory"):
        try:
            for doc in db.collection(coll).stream():
                p = doc.to_dict()
                name = (p.get("name") or "").strip().lower()
                cost = _safe_float(p.get("cost") or p.get("unitCost"))
                if name and cost > 0:
                    cost_map[name] = cost
        except Exception:
            pass
    return cost_map


def _fetch_root_collection(db, uid: str, name: str, start: datetime, end: datetime) -> list:
    """
    Three-strategy fetch matching the frontend's unfiltered collection read.
    Strategy 3 is intentionally unfiltered (matches frontend loadSales/loadExpenses
    which call collection(db, name) with no createdBy filter).
    _merge via seen-set deduplicates across strategies.
    """
    seen: set = set()
    results = []

    def _add(docs, require_uid: bool):
        for doc in docs:
            if doc.id in seen:
                continue
            s = doc.to_dict()
            if require_uid and s.get("createdBy", uid) != uid:
                continue
            if not _in_period(s, start, end):
                continue
            seen.add(doc.id)
            results.append(s)

    # 1 — user subcollection (new layout)
    try:
        _add(db.collection("users").document(uid).collection(name).stream(), require_uid=False)
    except Exception:
        pass

    # 2 — root collection filtered by createdBy (indexed)
    try:
        _add(db.collection(name).where("createdBy", "==", uid).stream(), require_uid=False)
    except Exception:
        pass

    # 3 — unfiltered root scan (mirrors frontend; no createdBy filter applied)
    try:
        _add(db.collection(name).stream(), require_uid=False)
    except Exception:
        pass

    return results


def _fetch_sales(db, uid: str, start: datetime, end: datetime) -> list:
    return _fetch_root_collection(db, uid, "sales", start, end)


def _fetch_expenses(db, uid: str, start: datetime, end: datetime) -> list:
    return _fetch_root_collection(db, uid, "expenses", start, end)


def _low_stock_items(db) -> list:
    items = []
    try:
        for doc in db.collection("products").stream():
            p = doc.to_dict()
            qty = _safe_float(p.get("quantity", 0))
            min_stock = _safe_float(p.get("minStock") or 10)
            if qty <= min_stock:
                items.append({
                    "name": p.get("name", "—"),
                    "quantity": qty,
                    "minStock": min_stock,
                    "status": "Out of Stock" if qty <= 0 else "Low Stock",
                })
    except Exception:
        pass
    return items


def generate_pl_data(db, uid: str, start: datetime, end: datetime, label: str) -> dict:
    cost_map = _build_cost_map(db)
    sales = _fetch_sales(db, uid, start, end)
    expenses = _fetch_expenses(db, uid, start, end)

    revenue = 0.0
    cogs = 0.0
    vat_collected = 0.0
    product_revenue: dict = {}

    for s in sales:
        rev = _sale_total(s)
        revenue += rev
        cogs += _sale_cogs(s, cost_map)
        vat_collected += _safe_float(s.get("vatAmount"))
        pname = (s.get("product") or s.get("productName") or "Other").strip()
        entry = product_revenue.setdefault(pname, {"name": pname, "revenue": 0.0, "units": 0})
        entry["revenue"] += rev
        entry["units"] += int(_safe_float(s.get("quantity", 1)))

    op_expenses = 0.0
    debt_payments = 0.0
    expense_by_cat: dict = defaultdict(float)

    for e in expenses:
        amt = _safe_float(e.get("amount"))
        if _is_debt_payment(e):
            debt_payments += amt
        else:
            op_expenses += amt
            cat = (e.get("category") or "Other").strip().title()
            expense_by_cat[cat] += amt

    gross_profit = revenue - cogs
    op_profit = gross_profit - op_expenses
    net_profit = op_profit - debt_payments

    return {
        "label": label,
        "period_start": start.strftime("%Y-%m-%d"),
        "period_end": (end - timedelta(days=1)).strftime("%Y-%m-%d"),
        "sales_count": len(sales),
        "revenue": revenue,
        "cogs": cogs,
        "gross_profit": gross_profit,
        "gross_margin_pct": (gross_profit / revenue * 100) if revenue > 0 else 0,
        "op_expenses": op_expenses,
        "op_profit": op_profit,
        "debt_payments": debt_payments,
        "net_profit": net_profit,
        "net_margin_pct": (net_profit / revenue * 100) if revenue > 0 else 0,
        "vat_collected": vat_collected,
        "top_products": sorted(product_revenue.values(), key=lambda p: p["revenue"], reverse=True)[:5],
        "expense_categories": sorted(expense_by_cat.items(), key=lambda x: x[1], reverse=True)[:6],
        "low_stock_items": _low_stock_items(db),
    }


def get_daily_data(db, uid: str) -> dict:
    yesterday = (datetime.now() - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    data = generate_pl_data(db, uid, yesterday, yesterday + timedelta(days=1),
                            yesterday.strftime("%A, %d %B %Y"))
    data["date_label"] = yesterday.strftime("%Y-%m-%d")
    return data


def get_weekly_data(db, uid: str) -> dict:
    now = datetime.now()
    last_mon = (now - timedelta(days=now.weekday() + 7)).replace(hour=0, minute=0, second=0, microsecond=0)
    last_sun_end = last_mon + timedelta(days=7)
    label = f"{last_mon.strftime('%d %b')} – {(last_sun_end - timedelta(days=1)).strftime('%d %b %Y')}"
    data = generate_pl_data(db, uid, last_mon, last_sun_end, label)
    data["week_start"] = last_mon.strftime("%Y-%m-%d")
    data["week_end"] = (last_sun_end - timedelta(days=1)).strftime("%Y-%m-%d")
    return data


def get_monthly_data(db, uid: str) -> dict:
    now = datetime.now()
    year, month = (now.year - 1, 12) if now.month == 1 else (now.year, now.month - 1)
    start = datetime(year, month, 1)
    end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    data = generate_pl_data(db, uid, start, end, start.strftime("%B %Y"))
    data["month_name"] = start.strftime("%B %Y")
    return data
