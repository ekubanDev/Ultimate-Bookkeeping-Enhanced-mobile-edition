"""
APScheduler-based job scheduler for daily/weekly email reports.
Reads notification settings from Firestore via firebase-admin.
"""

import os
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

_firestore_db = None


def _init_firebase():
    """Lazy-initialize firebase-admin and return Firestore client."""
    global _firestore_db
    if _firestore_db is not None:
        return _firestore_db

    sa_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", "")
    if not sa_path or not os.path.isfile(sa_path):
        logger.warning(
            "FIREBASE_SERVICE_ACCOUNT_PATH not set or file missing — "
            "scheduler cannot read Firestore settings"
        )
        return None

    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        cred = credentials.Certificate(sa_path)
        firebase_admin.initialize_app(cred)

    _firestore_db = firestore.client()
    return _firestore_db


def _get_settings_from_firestore(uid: str | None = None) -> dict | None:
    """Read notification settings from Firestore for the given user, or first admin user."""
    db = _init_firebase()
    if db is None:
        return None

    try:
        if uid:
            doc = db.collection("users").document(uid).collection("settings").document("config").get()
            if doc.exists:
                return doc.to_dict()

        settings_ref = db.collection("settings").document("config")
        doc = settings_ref.get()
        if doc.exists:
            return doc.to_dict()
    except Exception as exc:
        logger.error("Failed to read settings from Firestore: %s", exc)

    return None


async def _daily_stock_alert_job():
    """Scheduled job: check Firestore products for low/out-of-stock and email admin."""
    from email_service import email_service

    settings = _get_settings_from_firestore()
    if not settings:
        logger.info("Daily stock alert skipped — no settings found")
        return

    recipient = settings.get("notificationEmail", "")
    if not recipient or not settings.get("emailNotifications"):
        logger.info("Daily stock alert skipped — disabled or no recipient")
        return

    business_name = settings.get("name", "Ultimate Bookkeeping")
    db = _init_firebase()
    if db is None:
        return

    try:
        products_docs = db.collection("products").stream()
        problem_products = []
        for doc in products_docs:
            p = doc.to_dict()
            qty = float(p.get("quantity", 0) or 0)
            min_stock = float(p.get("minStock", 10) or 10)
            if qty <= min_stock:
                problem_products.append({
                    "name": p.get("name", "—"),
                    "category": p.get("category", ""),
                    "quantity": qty,
                    "minStock": min_stock,
                    "price": float(p.get("price", 0) or 0),
                })

        if not problem_products:
            logger.info("Daily stock alert: all stock levels healthy — no email sent")
            return

        await email_service.send_stock_alert(problem_products, recipient, business_name)
        logger.info("Daily stock alert sent to %s (%d items)", recipient, len(problem_products))

    except Exception as exc:
        logger.error("Daily stock alert job failed: %s", exc)


async def _daily_report_job():
    """Scheduled job: build daily summary from Firestore data and email it."""
    from email_service import email_service

    settings = _get_settings_from_firestore()
    if not settings:
        logger.info("Daily report skipped — no settings found")
        return

    recipient = settings.get("notificationEmail", "")
    if not recipient or not settings.get("dailyReports"):
        logger.info("Daily report skipped — disabled or no recipient")
        return

    business_name = settings.get("name", "Ultimate Bookkeeping")
    db = _init_firebase()
    if db is None:
        return

    today = datetime.now().strftime("%Y-%m-%d")
    yesterday_dt = datetime.now() - timedelta(days=1)

    try:
        sales_ref = db.collection("sales")
        sales_docs = sales_ref.where("date", ">=", yesterday_dt.strftime("%Y-%m-%d")).stream()
        total_revenue = 0.0
        sales_count = 0
        product_units: dict[str, int] = {}
        for doc in sales_docs:
            s = doc.to_dict()
            total_revenue += float(s.get("total", 0))
            sales_count += 1
            name = s.get("product", "Unknown")
            product_units[name] = product_units.get(name, 0) + int(s.get("quantity", 0))

        expenses_ref = db.collection("expenses")
        expenses_docs = expenses_ref.where("date", ">=", yesterday_dt.strftime("%Y-%m-%d")).stream()
        total_expenses = 0.0
        for doc in expenses_docs:
            e = doc.to_dict()
            etype = (e.get("expenseType", "") or "").lower()
            cat = (e.get("category", "") or "").lower()
            if etype == "liability_payment" or cat in ("debt payment", "loan repayment"):
                continue
            total_expenses += float(e.get("amount", 0))

        products_ref = db.collection("products")
        products_docs = products_ref.stream()
        low_stock_count = 0
        for doc in products_docs:
            p = doc.to_dict()
            if (p.get("quantity", 0) or 0) <= (p.get("minStock", 10) or 10):
                low_stock_count += 1

        top_product = None
        if product_units:
            top_name = max(product_units, key=product_units.get)
            top_product = {"name": top_name, "unitsSold": product_units[top_name]}

        data = {
            "date": today,
            "totalRevenue": total_revenue,
            "totalExpenses": total_expenses,
            "profit": total_revenue - total_expenses,
            "salesCount": sales_count,
            "topProduct": top_product,
            "lowStockCount": low_stock_count,
        }

        await email_service.send_daily_summary(data, recipient, business_name)
        logger.info("Daily summary email sent to %s", recipient)

    except Exception as exc:
        logger.error("Daily report job failed: %s", exc)


async def _weekly_report_job():
    """Scheduled job: build weekly summary from Firestore data and email it."""
    from email_service import email_service

    settings = _get_settings_from_firestore()
    if not settings:
        logger.info("Weekly report skipped — no settings found")
        return

    recipient = settings.get("notificationEmail", "")
    if not recipient or not settings.get("dailyReports"):
        logger.info("Weekly report skipped — disabled or no recipient")
        return

    business_name = settings.get("name", "Ultimate Bookkeeping")
    db = _init_firebase()
    if db is None:
        return

    now = datetime.now()
    week_start = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    week_end = now.strftime("%Y-%m-%d")

    try:
        sales_ref = db.collection("sales")
        sales_docs = sales_ref.where("date", ">=", week_start).stream()
        total_revenue = 0.0
        total_sales = 0
        product_revenue: dict[str, dict] = {}
        for doc in sales_docs:
            s = doc.to_dict()
            rev = float(s.get("total", 0))
            total_revenue += rev
            total_sales += 1
            name = s.get("product", "Unknown")
            entry = product_revenue.setdefault(name, {"name": name, "unitsSold": 0, "revenue": 0})
            entry["unitsSold"] += int(s.get("quantity", 0))
            entry["revenue"] += rev

        expenses_ref = db.collection("expenses")
        expenses_docs = expenses_ref.where("date", ">=", week_start).stream()
        total_expenses = 0.0
        for doc in expenses_docs:
            e = doc.to_dict()
            etype = (e.get("expenseType", "") or "").lower()
            cat = (e.get("category", "") or "").lower()
            if etype == "liability_payment" or cat in ("debt payment", "loan repayment"):
                continue
            total_expenses += float(e.get("amount", 0))

        customers_ref = db.collection("customers")
        customers_docs = customers_ref.where("createdAt", ">=", week_start).stream()
        new_customers = sum(1 for _ in customers_docs)

        top_products = sorted(product_revenue.values(), key=lambda p: p["unitsSold"], reverse=True)[:5]

        avg_sale = (total_revenue / total_sales) if total_sales > 0 else 0

        data = {
            "weekStart": week_start,
            "weekEnd": week_end,
            "weeklyRevenue": total_revenue,
            "weeklyExpenses": total_expenses,
            "weeklyProfit": total_revenue - total_expenses,
            "totalSales": total_sales,
            "newCustomers": new_customers,
            "averageSale": avg_sale,
            "topProducts": top_products,
        }

        await email_service.send_weekly_summary(data, recipient, business_name)
        logger.info("Weekly summary email sent to %s", recipient)

    except Exception as exc:
        logger.error("Weekly report job failed: %s", exc)


class ReportScheduler:
    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self._stock_alert_job_id = "daily_stock_alert"
        self._daily_job_id = "daily_report"
        self._weekly_job_id = "weekly_report"

    def start(self):
        self.scheduler.add_job(
            _daily_stock_alert_job,
            CronTrigger(hour=8, minute=0),
            id=self._stock_alert_job_id,
            replace_existing=True,
            name="Daily stock alert check",
        )

        self.scheduler.add_job(
            _daily_report_job,
            CronTrigger(hour=20, minute=0),
            id=self._daily_job_id,
            replace_existing=True,
            name="Daily business summary",
        )

        self.scheduler.add_job(
            _weekly_report_job,
            CronTrigger(day_of_week="mon", hour=9, minute=0),
            id=self._weekly_job_id,
            replace_existing=True,
            name="Weekly business report",
        )

        self.scheduler.start()
        logger.info("Report scheduler started (stock alerts 8AM, daily summary 8PM, weekly Mon 9AM)")

    def stop(self):
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("Report scheduler stopped")

    def update_schedule(self, settings: dict):
        """Refresh schedule based on user-provided settings."""
        daily_enabled = settings.get("dailyReports", False)
        email_enabled = settings.get("emailNotifications", False)
        recipient = settings.get("notificationEmail", "")

        if not email_enabled or not recipient:
            self._pause_jobs()
            logger.info("Email notifications disabled — jobs paused")
            return

        if daily_enabled:
            self._resume_jobs()
            logger.info("Email notifications enabled — jobs active")
        else:
            self._pause_jobs()
            logger.info("Daily reports disabled — jobs paused")

    def _pause_jobs(self):
        for jid in (self._stock_alert_job_id, self._daily_job_id, self._weekly_job_id):
            job = self.scheduler.get_job(jid)
            if job:
                job.pause()

    def _resume_jobs(self):
        for jid in (self._stock_alert_job_id, self._daily_job_id, self._weekly_job_id):
            job = self.scheduler.get_job(jid)
            if job:
                job.resume()


report_scheduler = ReportScheduler()
