"""
Read-only aggregates for AI chat agent. All inputs are untrusted JSON from the client;
outputs are structured facts for model grounding (no side effects).
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple


def _parse_date(val: Any) -> Optional[datetime]:
    if val is None or val == "":
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    s = str(val).strip()
    if not s:
        return None
    try:
        if "T" in s:
            s2 = s.replace("Z", "+00:00")
            return datetime.fromisoformat(s2)
        return datetime.strptime(s[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _sale_line_amount(s: Dict[str, Any]) -> float:
    try:
        q = float(s.get("quantity", 0) or 0)
        p = float(s.get("price", 0) or 0)
        disc = float(s.get("discount", 0) or 0)
        return max(0.0, q * p * (1.0 - disc / 100.0))
    except Exception:
        return 0.0


def _product_key(s: Dict[str, Any]) -> str:
    pid = s.get("productId") or s.get("product_id")
    if pid:
        return f"id:{pid}"
    name = (s.get("product") or s.get("name") or "").strip()
    return f"n:{name.lower()}" if name else "unknown"


def compute_business_snapshot(datasets: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build a JSON-serializable snapshot: inventory, sales, restock hints, replenishment from POs.
    """
    products: List[Dict[str, Any]] = list(datasets.get("products") or [])
    sales: List[Dict[str, Any]] = list(datasets.get("sales") or [])
    purchase_orders: List[Dict[str, Any]] = list(datasets.get("purchase_orders") or [])

    now = datetime.now(timezone.utc)
    day_90 = now - timedelta(days=90)
    day_180 = now - timedelta(days=180)

    # --- Sales aggregates (90d window) ---
    units_by_key: Dict[str, float] = {}
    revenue_by_key: Dict[str, float] = {}
    revenue_90 = 0.0
    sales_count_90 = 0
    for s in sales:
        d = _parse_date(s.get("date") or s.get("createdAt"))
        if d is None or d < day_90:
            continue
        sales_count_90 += 1
        key = _product_key(s)
        amt = _sale_line_amount(s)
        qty = float(s.get("quantity", 0) or 0)
        units_by_key[key] = units_by_key.get(key, 0.0) + qty
        revenue_by_key[key] = revenue_by_key.get(key, 0.0) + amt
        revenue_90 += amt

    # Map product id -> meta
    by_id: Dict[str, Dict[str, Any]] = {}
    for p in products:
        pid = p.get("id")
        if pid:
            by_id[str(pid)] = p

    def pkey_for_product(p: Dict[str, Any]) -> str:
        pid = p.get("id")
        return f"id:{pid}" if pid else f"n:{(p.get('name') or '').strip().lower()}"

    # --- Last replenishment from received POs ---
    last_po_receive: Dict[str, str] = {}
    for po in purchase_orders:
        st = (po.get("status") or "").lower()
        if st != "received":
            continue
        rd = _parse_date(po.get("receivedDate") or po.get("received_date"))
        if rd is None:
            continue
        rd_iso = rd.date().isoformat()
        for it in po.get("items") or []:
            pid = it.get("productId") or it.get("product_id")
            if not pid:
                continue
            spid = str(pid)
            prev = last_po_receive.get(spid)
            if prev is None or rd_iso > prev:
                last_po_receive[spid] = rd_iso

    # Inventory may carry lastRestockedAt from PO receive (or future stock-in paths); merge as max date with POs.
    for p in products:
        pid = p.get("id")
        if not pid:
            continue
        spid = str(pid)
        raw_lr = p.get("lastRestockedAt") or p.get("last_restocked_at")
        dlr = _parse_date(raw_lr)
        if dlr is None:
            continue
        iso = dlr.date().isoformat()
        prev = last_po_receive.get(spid)
        if prev is None or iso > prev:
            last_po_receive[spid] = iso

    # --- Low stock ---
    low_stock: List[Dict[str, Any]] = []
    for p in products:
        try:
            q = float(p.get("quantity", 0) or 0)
            mn = float(p.get("minStock", p.get("min_stock", 10)) or 10)
        except Exception:
            continue
        if q <= mn:
            low_stock.append(
                {
                    "id": p.get("id"),
                    "name": p.get("name"),
                    "quantity": q,
                    "min_stock": mn,
                    "category": p.get("category"),
                }
            )
    low_stock.sort(key=lambda x: (x.get("quantity") is not None, x.get("quantity", 0)))

    # --- Top sellers 90d by revenue ---
    rev_items: List[Tuple[str, float]] = sorted(revenue_by_key.items(), key=lambda x: x[1], reverse=True)[:10]
    top_sellers: List[Dict[str, Any]] = []
    for key, rev in rev_items:
        label = key
        if key.startswith("id:"):
            pid = key[3:]
            name = (by_id.get(pid) or {}).get("name") or pid
            label = f"{name} (id {pid})"
        elif key.startswith("n:"):
            label = key[2:] or key
        top_sellers.append({"key": key, "label": label, "units_90d": round(units_by_key.get(key, 0), 2), "revenue_90d": round(rev, 2)})

    # --- Slow movers: in catalog, qty>0, low or zero 90d units ---
    slow: List[Dict[str, Any]] = []
    for p in products:
        try:
            qoh = float(p.get("quantity", 0) or 0)
        except Exception:
            continue
        if qoh <= 0:
            continue
        pk = pkey_for_product(p)
        u = units_by_key.get(pk, 0.0)
        if u < 1.0:
            pid = str(p.get("id") or "")
            last_recv = last_po_receive.get(pid)
            slow.append(
                {
                    "id": p.get("id"),
                    "name": p.get("name"),
                    "quantity_on_hand": qoh,
                    "units_sold_90d": round(u, 2),
                    "last_restock_or_po_date": last_recv,
                    "no_restock_signal_180d": (last_recv is None or last_recv < day_180.date().isoformat()),
                }
            )
    slow.sort(key=lambda x: (x.get("units_sold_90d", 0), -(x.get("quantity_on_hand") or 0)))

    # --- Restock candidates: low stock, prioritized by 90d revenue ---
    restock_scores: List[Dict[str, Any]] = []
    for row in low_stock[:40]:
        pid = row.get("id")
        pk = f"id:{pid}" if pid else f"n:{(row.get('name') or '').strip().lower()}"
        rev = revenue_by_key.get(pk, 0.0)
        restock_scores.append({**row, "revenue_90d": round(rev, 2)})
    restock_scores.sort(key=lambda x: (-(x.get("revenue_90d") or 0), x.get("quantity") or 0))

    return {
        "computed_at": now.isoformat(),
        "window_days": 90,
        "sales_transactions_in_window": sales_count_90,
        "revenue_90d": round(revenue_90, 2),
        "currency": "GHS",
        "low_stock_count": len(low_stock),
        "low_stock_sample": low_stock[:25],
        "restock_priority": restock_scores[:15],
        "top_sellers_90d": top_sellers,
        "slow_movers_sample": slow[:20],
        "products_loaded": len(products),
        "sales_loaded": len(sales),
        "purchase_orders_loaded": len(purchase_orders),
        "note": "Figures are derived from data sent by the client for this session; not a server-side database query.",
    }


def snapshot_json_for_prompt(snapshot: Dict[str, Any]) -> str:
    import json

    return json.dumps(snapshot, indent=2, default=str)
