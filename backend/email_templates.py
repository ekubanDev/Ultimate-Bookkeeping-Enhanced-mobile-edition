"""
HTML email templates for automated bookkeeping reports.
All monetary values in Ghana Cedi (GHS / ₵).
P&L structure: Revenue → COGS → Gross Profit → Op. Expenses → Op. Profit → Debt → Net Profit
"""

from datetime import datetime


def _fmt(amount) -> str:
    try:
        v = float(amount)
        color = "color:#dc3545;" if v < 0 else ""
        return f'<span style="{color}">₵{abs(v):,.2f}</span>'
    except (TypeError, ValueError):
        return "₵0.00"


def _pct(v) -> str:
    try:
        return f"{float(v):.1f}%"
    except (TypeError, ValueError):
        return "0.0%"


def _year() -> int:
    return datetime.now().year


_BASE_CSS = """
body{font-family:Arial,sans-serif;line-height:1.6;color:#333;margin:0;padding:0;background:#f0f2f5;}
.wrap{max-width:640px;margin:20px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);}
.hdr{padding:24px 28px;color:#fff;text-align:center;}
.hdr h1{margin:0;font-size:22px;font-weight:700;}
.hdr p{margin:4px 0 0;opacity:.88;font-size:14px;}
.body{padding:24px 28px;}
.pl-table{width:100%;border-collapse:collapse;margin:16px 0;}
.pl-table td{padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;}
.pl-table tr:last-child td{border-bottom:none;}
.pl-table .tier{font-weight:700;background:#f8f9fa;}
.pl-table .sub{padding-left:20px;color:#555;}
.pl-table .total{font-weight:700;border-top:2px solid #dee2e6 !important;}
.pl-table .profit{font-weight:700;color:#28a745;}
.pl-table .loss{font-weight:700;color:#dc3545;}
.kpi-row{display:flex;gap:12px;margin:16px 0;flex-wrap:wrap;}
.kpi{flex:1;min-width:110px;background:#f8f9fa;border-radius:6px;padding:12px;text-align:center;}
.kpi-val{font-size:20px;font-weight:700;}
.kpi-lbl{font-size:11px;color:#777;margin-top:3px;}
.section{background:#f8f9fa;border-radius:6px;padding:16px;margin:16px 0;}
.section h3{margin:0 0 10px;font-size:14px;color:#555;text-transform:uppercase;letter-spacing:.5px;}
.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;}
.tag-ok{background:#d4edda;color:#155724;}
.tag-warn{background:#fff3cd;color:#856404;}
.tag-bad{background:#f8d7da;color:#721c24;}
.footer{text-align:center;color:#aaa;font-size:11px;padding:16px;border-top:1px solid #f0f0f0;}
ol,ul{margin:6px 0;padding-left:20px;}
li{margin:3px 0;font-size:13px;}
"""


def _pl_row(label: str, value, cls: str = "", indent: bool = False) -> str:
    td_cls = f"{'sub ' if indent else ''}{cls}".strip()
    return f'<tr class="{td_cls}"><td>{label}</td><td style="text-align:right;">{_fmt(value)}</td></tr>'


def _divider_row(label: str) -> str:
    return f'<tr class="tier"><td colspan="2" style="padding:6px 12px;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.5px;">{label}</td></tr>'


def _pl_block(d: dict) -> str:
    net = d.get("net_profit", 0)
    net_cls = "profit" if net >= 0 else "loss"
    gross = d.get("gross_profit", 0)
    op = d.get("op_profit", 0)
    return f"""
<table class="pl-table">
  {_divider_row("Revenue")}
  {_pl_row("Gross Revenue", d.get("revenue", 0))}
  {_divider_row("Cost of Goods Sold")}
  {_pl_row("COGS", d.get("cogs", 0), indent=True)}
  <tr class="total"><td>Gross Profit <span style="color:#777;font-size:12px;font-weight:400;">({_pct(d.get('gross_margin_pct',0))} margin)</span></td>
    <td style="text-align:right;">{'<span style="color:#28a745;font-weight:700;">' if gross >= 0 else '<span style="color:#dc3545;font-weight:700;">'}{_fmt(gross)}</span></td></tr>
  {_divider_row("Operating Expenses")}
  {_pl_row("Total Op. Expenses", d.get("op_expenses", 0), indent=True)}
  <tr class="total"><td>Operating Profit</td>
    <td style="text-align:right;">{'<span style="color:#28a745;font-weight:700;">' if op >= 0 else '<span style="color:#dc3545;font-weight:700;">'}{_fmt(op)}</span></td></tr>
  {_divider_row("Financing")}
  {_pl_row("Debt / Liability Payments", d.get("debt_payments", 0), indent=True)}
  <tr class="total"><td><strong>Net Profit</strong> <span style="color:#777;font-size:12px;font-weight:400;">({_pct(d.get('net_margin_pct',0))} margin)</span></td>
    <td style="text-align:right;"><strong class="{net_cls}">{_fmt(net)}</strong></td></tr>
</table>"""


def _top_products_block(products: list) -> str:
    if not products:
        return ""
    rows = "".join(
        f'<li>{p["name"]} &mdash; {p["units"]} units · ₵{float(p["revenue"]):,.2f}</li>'
        for p in products[:5]
    )
    return f'<div class="section"><h3>Top Products</h3><ol>{rows}</ol></div>'


def _expense_block(cats: list) -> str:
    if not cats:
        return ""
    rows = "".join(f'<li>{cat} &mdash; ₵{float(amt):,.2f}</li>' for cat, amt in cats[:6])
    return f'<div class="section"><h3>Expense Breakdown</h3><ul>{rows}</ul></div>'


def _low_stock_block(items: list) -> str:
    if not items:
        return ""
    out = [f'<li>{i["name"]} — <strong>{int(i["quantity"])}</strong> units '
           f'<span class="tag {"tag-bad" if i["status"] == "Out of Stock" else "tag-warn"}">{i["status"]}</span></li>'
           for i in items[:8]]
    return f'<div class="section" style="border-left:4px solid #ffc107;"><h3>Stock Alerts</h3><ul>{"".join(out)}</ul></div>'


def _footer(name: str) -> str:
    return f'<div class="footer">Automated report &bull; {_year()} {name}<br>To unsubscribe, update your notification settings in the app.</div>'


# ── Daily ──────────────────────────────────────────────────────────────────────

def daily_summary_html(data: dict, business_name: str = "Ultimate Bookkeeping") -> str:
    label = data.get("label", data.get("date_label", datetime.now().strftime("%Y-%m-%d")))
    net = data.get("net_profit", 0)
    kpi_color = "#28a745" if net >= 0 else "#dc3545"

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_BASE_CSS}</style></head>
<body><div class="wrap">
  <div class="hdr" style="background:linear-gradient(135deg,#007bff,#0056b3);">
    <h1>Daily P&amp;L Report</h1><p>{label}</p>
  </div>
  <div class="body">
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-val" style="color:#007bff;">₵{float(data.get("revenue",0)):,.0f}</div><div class="kpi-lbl">Revenue</div></div>
      <div class="kpi"><div class="kpi-val" style="color:{kpi_color};">₵{float(net):,.0f}</div><div class="kpi-lbl">Net Profit</div></div>
      <div class="kpi"><div class="kpi-val">{data.get("sales_count",0)}</div><div class="kpi-lbl">Sales</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#7c3aed;">₵{float(data.get("vat_collected",0)):,.0f}</div><div class="kpi-lbl">VAT Collected</div></div>
    </div>
    <h3 style="margin:20px 0 4px;font-size:14px;color:#555;">Profit &amp; Loss</h3>
    {_pl_block(data)}
    {_top_products_block(data.get("top_products", []))}
    {_low_stock_block(data.get("low_stock_items", []))}
  </div>
  {_footer(business_name)}
</div></body></html>"""


# ── Weekly ─────────────────────────────────────────────────────────────────────

def weekly_summary_html(data: dict, business_name: str = "Ultimate Bookkeeping") -> str:
    label = data.get("label", f"{data.get('week_start','')} – {data.get('week_end','')}")
    net = data.get("net_profit", 0)
    kpi_color = "#28a745" if net >= 0 else "#dc3545"
    avg_sale = (float(data.get("revenue", 0)) / data["sales_count"]) if data.get("sales_count") else 0

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_BASE_CSS}</style></head>
<body><div class="wrap">
  <div class="hdr" style="background:linear-gradient(135deg,#6f42c1,#5a32a3);">
    <h1>Weekly Business Report</h1><p>{label}</p>
  </div>
  <div class="body">
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-val" style="color:#6f42c1;">₵{float(data.get("revenue",0)):,.0f}</div><div class="kpi-lbl">Revenue</div></div>
      <div class="kpi"><div class="kpi-val" style="color:{kpi_color};">₵{float(net):,.0f}</div><div class="kpi-lbl">Net Profit</div></div>
      <div class="kpi"><div class="kpi-val">{data.get("sales_count",0)}</div><div class="kpi-lbl">Sales</div></div>
      <div class="kpi"><div class="kpi-val">₵{avg_sale:,.0f}</div><div class="kpi-lbl">Avg Sale</div></div>
    </div>
    <h3 style="margin:20px 0 4px;font-size:14px;color:#555;">Profit &amp; Loss</h3>
    {_pl_block(data)}
    {_top_products_block(data.get("top_products", []))}
    {_expense_block(data.get("expense_categories", []))}
    {_low_stock_block(data.get("low_stock_items", []))}
  </div>
  {_footer(business_name)}
</div></body></html>"""


# ── Monthly ────────────────────────────────────────────────────────────────────

def monthly_summary_html(data: dict, business_name: str = "Ultimate Bookkeeping") -> str:
    label = data.get("month_name", data.get("label", "Monthly Report"))
    net = data.get("net_profit", 0)
    kpi_color = "#28a745" if net >= 0 else "#dc3545"
    vat = float(data.get("vat_collected", 0))

    # Ghana VAT note
    if vat > 0:
        vat_note = (f'Your VAT collected this month was <strong>₵{vat:,.2f}</strong>. '
                    f'Ensure this is remitted to GRA by the 21st of next month.')
    else:
        vat_note = "No VAT recorded this month. If your business is VAT-registered, verify your POS settings."

    sales_avg = (float(data.get("revenue", 0)) / data["sales_count"]) if data.get("sales_count") else 0

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_BASE_CSS}</style></head>
<body><div class="wrap">
  <div class="hdr" style="background:linear-gradient(135deg,#20c997,#12a37f);">
    <h1>Monthly Financial Summary</h1><p>{label} &bull; {business_name}</p>
  </div>
  <div class="body">
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-val" style="color:#20c997;">₵{float(data.get("revenue",0)):,.0f}</div><div class="kpi-lbl">Revenue</div></div>
      <div class="kpi"><div class="kpi-val" style="color:{kpi_color};">₵{float(net):,.0f}</div><div class="kpi-lbl">Net Profit</div></div>
      <div class="kpi"><div class="kpi-val">{_pct(data.get("gross_margin_pct",0))}</div><div class="kpi-lbl">Gross Margin</div></div>
      <div class="kpi"><div class="kpi-val">{data.get("sales_count",0)}</div><div class="kpi-lbl">Sales</div></div>
    </div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-val" style="color:#7c3aed;">₵{vat:,.0f}</div><div class="kpi-lbl">VAT Collected</div></div>
      <div class="kpi"><div class="kpi-val">₵{float(data.get("cogs",0)):,.0f}</div><div class="kpi-lbl">COGS</div></div>
      <div class="kpi"><div class="kpi-val">₵{float(data.get("debt_payments",0)):,.0f}</div><div class="kpi-lbl">Debt Payments</div></div>
      <div class="kpi"><div class="kpi-val">₵{sales_avg:,.0f}</div><div class="kpi-lbl">Avg Sale</div></div>
    </div>

    <h3 style="margin:20px 0 4px;font-size:14px;color:#555;">Full P&amp;L Statement</h3>
    {_pl_block(data)}

    <div class="section" style="border-left:4px solid #7c3aed;">
      <h3>Ghana VAT Summary</h3>
      <p style="margin:0;font-size:13px;">{vat_note}</p>
      <table style="width:100%;margin-top:10px;font-size:13px;">
        <tr><td>VAT Collected</td><td style="text-align:right;font-weight:600;">₵{vat:,.2f}</td></tr>
        <tr><td>Effective Period</td><td style="text-align:right;">{data.get("period_start","")} to {data.get("period_end","")}</td></tr>
        <tr><td>GRA Filing Due</td><td style="text-align:right;font-weight:600;">21st of next month</td></tr>
      </table>
    </div>

    {_top_products_block(data.get("top_products", []))}
    {_expense_block(data.get("expense_categories", []))}
    {_low_stock_block(data.get("low_stock_items", []))}
  </div>
  {_footer(business_name)}
</div></body></html>"""


# ── Stock Alert ────────────────────────────────────────────────────────────────

def low_stock_alert_html(products: list, business_name: str = "Ultimate Bookkeeping") -> str:
    out_of_stock = [p for p in products if (p.get("quantity") or 0) <= 0]
    low_stock = [p for p in products if 0 < (p.get("quantity") or 0) <= (p.get("minStock") or 10)]

    rows = "".join(
        f"""<tr style="background:#fff5f5;">
          <td style="padding:10px;border-bottom:1px solid #eee;">{p.get('name','—')}</td>
          <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;color:#dc3545;font-weight:bold;">0</td>
          <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">{p.get('minStock',10)}</td>
          <td style="padding:10px;border-bottom:1px solid #eee;"><span class="tag tag-bad">Out of Stock</span></td>
        </tr>""" for p in out_of_stock
    ) + "".join(
        f"""<tr>
          <td style="padding:10px;border-bottom:1px solid #eee;">{p.get('name','—')}</td>
          <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;color:#e67e00;font-weight:bold;">{p.get('quantity',0)}</td>
          <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">{p.get('minStock',10)}</td>
          <td style="padding:10px;border-bottom:1px solid #eee;"><span class="tag tag-warn">Low Stock</span></td>
        </tr>""" for p in low_stock
    )

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_BASE_CSS}
    .tag{{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;}}
    .tag-warn{{background:#fff3cd;color:#856404;}}.tag-bad{{background:#f8d7da;color:#721c24;}}
    </style></head>
<body><div class="wrap">
  <div class="hdr" style="background:linear-gradient(135deg,#dc3545,#c82333);">
    <h1>Stock Alert</h1>
    <p>{len(out_of_stock)} out of stock &bull; {len(low_stock)} running low</p>
  </div>
  <div class="body">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f8f9fa;">
        <th style="padding:10px;text-align:left;">Product</th>
        <th style="padding:10px;text-align:center;">Stock</th>
        <th style="padding:10px;text-align:center;">Min.</th>
        <th style="padding:10px;text-align:left;">Status</th>
      </tr></thead>
      <tbody>{rows}</tbody>
    </table>
    <p style="margin-top:20px;color:#666;font-size:13px;">Please restock these items to avoid lost sales.</p>
  </div>
  {_footer(business_name)}
</div></body></html>"""


def test_email_html() -> str:
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_BASE_CSS}</style></head>
<body><div class="wrap">
  <div class="hdr" style="background:linear-gradient(135deg,#28a745,#1e7e34);">
    <h1>Email Notifications Working</h1>
  </div>
  <div class="body">
    <p>Your automated email reports are configured correctly.</p>
    <p style="color:#666;font-size:13px;">Sent at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} UTC</p>
  </div>
  {_footer("Ultimate Bookkeeping")}
</div></body></html>"""
