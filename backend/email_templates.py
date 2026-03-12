"""
HTML email templates for backend notifications.
All monetary values use Ghana Cedi (GHS / ₵).
"""

from datetime import datetime


def _fmt(amount) -> str:
    try:
        return f"₵{float(amount):,.2f}"
    except (TypeError, ValueError):
        return "₵0.00"


def _year() -> int:
    return datetime.now().year


def low_stock_alert_html(products: list, business_name: str = "Ultimate Bookkeeping") -> str:
    out_of_stock = [p for p in products if (p.get("quantity") or 0) <= 0]
    low_stock = [p for p in products if 0 < (p.get("quantity") or 0) <= (p.get("minStock") or 10)]

    rows = ""
    for p in out_of_stock:
        rows += f"""<tr style="background:#fff5f5;">
            <td style="padding:10px;border-bottom:1px solid #eee;"><strong>{p.get('name','—')}</strong></td>
            <td style="padding:10px;border-bottom:1px solid #eee;">{p.get('category','—')}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;color:#dc3545;font-weight:bold;">0</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">{p.get('minStock',10)}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;"><span style="background:#dc3545;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;">Out of Stock</span></td>
        </tr>"""
    for p in low_stock:
        rows += f"""<tr>
            <td style="padding:10px;border-bottom:1px solid #eee;"><strong>{p.get('name','—')}</strong></td>
            <td style="padding:10px;border-bottom:1px solid #eee;">{p.get('category','—')}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;color:#e67e00;font-weight:bold;">{p.get('quantity',0)}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">{p.get('minStock',10)}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;"><span style="background:#ffc107;color:#333;padding:2px 8px;border-radius:10px;font-size:12px;">Low Stock</span></td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html><head><style>
body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }}
.container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
.header {{ background: linear-gradient(135deg, #dc3545, #c82333); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
.content {{ background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }}
.footer {{ text-align: center; color: #999; font-size: 12px; margin-top: 20px; }}
</style></head>
<body><div class="container">
    <div class="header">
        <h1 style="margin:0;">⚠️ Stock Alert</h1>
        <p style="margin:5px 0 0;">{business_name}</p>
    </div>
    <div class="content">
        <p><strong>{len(out_of_stock)}</strong> product(s) out of stock and <strong>{len(low_stock)}</strong> product(s) running low.</p>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:4px;">
            <thead><tr style="background:#f8f9fa;">
                <th style="padding:10px;text-align:left;">Product</th>
                <th style="padding:10px;text-align:left;">Category</th>
                <th style="padding:10px;text-align:center;">Stock</th>
                <th style="padding:10px;text-align:center;">Min.</th>
                <th style="padding:10px;text-align:left;">Status</th>
            </tr></thead>
            <tbody>{rows}</tbody>
        </table>
        <p style="margin-top:20px;color:#666;">Please restock these items to avoid lost sales.</p>
    </div>
    <div class="footer">
        <p>Automated stock alert &bull; {_year()} {business_name}</p>
    </div>
</div></body></html>"""


def daily_summary_html(data: dict, business_name: str = "Ultimate Bookkeeping") -> str:
    date_str = data.get("date", datetime.now().strftime("%Y-%m-%d"))
    revenue = data.get("totalRevenue", 0)
    expenses = data.get("totalExpenses", 0)
    profit = data.get("profit", revenue - expenses)
    sales_count = data.get("salesCount", 0)
    top_product = data.get("topProduct")
    low_stock_count = data.get("lowStockCount", 0)

    top_html = ""
    if top_product:
        top_html = f"""<div style="background:#d4edda;border-left:4px solid #28a745;padding:15px;margin:15px 0;">
            <strong>🏆 Top Selling Product:</strong><br>
            {top_product.get('name','—')} ({top_product.get('unitsSold',0)} units)
        </div>"""

    low_html = ""
    if low_stock_count > 0:
        low_html = f"""<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:15px;margin:15px 0;">
            <strong>⚠️ Low Stock Alert:</strong> {low_stock_count} items need restocking
        </div>"""

    return f"""<!DOCTYPE html>
<html><head><style>
body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; }}
.container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
.header {{ background: linear-gradient(135deg, #007bff, #0056b3); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
.content {{ background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }}
.grid {{ display: flex; flex-wrap: wrap; gap: 15px; margin: 20px 0; }}
.card {{ background: white; padding: 15px; border-radius: 4px; text-align: center; flex: 1; min-width: 120px; }}
.val {{ font-size: 24px; font-weight: bold; color: #007bff; }}
.lbl {{ font-size: 13px; color: #666; margin-top: 5px; }}
.footer {{ text-align: center; color: #999; font-size: 12px; margin-top: 20px; }}
</style></head>
<body><div class="container">
    <div class="header">
        <h1 style="margin:0;">📊 Daily Business Summary</h1>
        <p style="margin:5px 0 0;">{date_str}</p>
    </div>
    <div class="content">
        <div class="grid">
            <div class="card"><div class="val">{_fmt(revenue)}</div><div class="lbl">Total Revenue</div></div>
            <div class="card"><div class="val">{_fmt(expenses)}</div><div class="lbl">Op. Expenses</div></div>
        </div>
        <div class="grid">
            <div class="card"><div class="val" style="color:#28a745;">{_fmt(profit)}</div><div class="lbl">Net Profit</div></div>
            <div class="card"><div class="val">{sales_count}</div><div class="lbl">Sales Made</div></div>
        </div>
        {top_html}
        {low_html}
    </div>
    <div class="footer">
        <p>Automated daily report &bull; {_year()} {business_name}</p>
    </div>
</div></body></html>"""


def weekly_summary_html(data: dict, business_name: str = "Ultimate Bookkeeping") -> str:
    week_start = data.get("weekStart", "")
    week_end = data.get("weekEnd", "")
    revenue = data.get("weeklyRevenue", 0)
    expenses = data.get("weeklyExpenses", 0)
    profit = data.get("weeklyProfit", revenue - expenses)
    total_sales = data.get("totalSales", 0)
    new_customers = data.get("newCustomers", 0)
    avg_sale = data.get("averageSale", 0)
    top_products = data.get("topProducts", [])

    top_html = ""
    if top_products:
        items = "".join(
            f"<li>{p.get('name','—')} — {p.get('unitsSold',0)} units ({_fmt(p.get('revenue',0))})</li>"
            for p in top_products[:5]
        )
        top_html = f"""<div style="background:white;padding:20px;border-radius:4px;margin:20px 0;">
            <h3 style="margin-top:0;">🏆 Top 5 Products This Week</h3>
            <ol>{items}</ol>
        </div>"""

    return f"""<!DOCTYPE html>
<html><head><style>
body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; }}
.container {{ max-width: 700px; margin: 0 auto; padding: 20px; }}
.header {{ background: linear-gradient(135deg, #6f42c1, #5a32a3); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
.content {{ background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }}
.grid {{ display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0; }}
.card {{ background: white; padding: 14px; border-radius: 4px; text-align: center; flex: 1; min-width: 100px; }}
.val {{ font-size: 22px; font-weight: bold; color: #6f42c1; }}
.lbl {{ font-size: 12px; color: #666; margin-top: 4px; }}
.footer {{ text-align: center; color: #999; font-size: 12px; margin-top: 20px; }}
</style></head>
<body><div class="container">
    <div class="header">
        <h1 style="margin:0;">📈 Weekly Business Report</h1>
        <p style="margin:5px 0 0;">{week_start} — {week_end}</p>
    </div>
    <div class="content">
        <h2 style="margin-top:0;">Financial Overview</h2>
        <div class="grid">
            <div class="card"><div class="val">{_fmt(revenue)}</div><div class="lbl">Revenue</div></div>
            <div class="card"><div class="val">{_fmt(expenses)}</div><div class="lbl">Expenses</div></div>
            <div class="card"><div class="val" style="color:#28a745;">{_fmt(profit)}</div><div class="lbl">Profit</div></div>
        </div>
        <div class="grid">
            <div class="card"><div class="val">{total_sales}</div><div class="lbl">Total Sales</div></div>
            <div class="card"><div class="val">{new_customers}</div><div class="lbl">New Customers</div></div>
            <div class="card"><div class="val">{_fmt(avg_sale)}</div><div class="lbl">Avg Sale</div></div>
        </div>
        {top_html}
    </div>
    <div class="footer">
        <p>Automated weekly report &bull; {_year()} {business_name}</p>
    </div>
</div></body></html>"""


def test_email_html() -> str:
    return f"""<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
    <h2 style="color:#28a745;">✅ Email Notifications Working</h2>
    <p>This is a test email from your Ultimate Bookkeeping backend.</p>
    <p>If you received this, email notifications are configured correctly.</p>
    <p style="color:#999;font-size:12px;">Sent at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
</body></html>"""
