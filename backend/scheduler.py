"""
APScheduler-based email report scheduler.
Reads per-user preferences from Firestore: users/{uid}/settings/report_preferences
Jobs run at fixed UTC times; users control enable/disable per report type.
"""

import asyncio
import logging
import os
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

_firestore_db = None

PREFS_SUBCOL = "settings"
PREFS_DOC    = "report_preferences"


def _init_firebase():
    global _firestore_db
    if _firestore_db is not None:
        return _firestore_db

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            sa_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", "")
            if sa_path and os.path.isfile(sa_path):
                cred = credentials.Certificate(sa_path)
                firebase_admin.initialize_app(cred)
            else:
                firebase_admin.initialize_app()

        _firestore_db = firestore.client()
        return _firestore_db
    except Exception as exc:
        logger.warning("Scheduler: Firebase init failed — %s", exc)
        return None


def _all_user_prefs(db) -> list[tuple[str, dict]]:
    """Return [(uid, prefs_dict), ...] for all users who have report preferences set."""
    results = []
    try:
        for user_doc in db.collection("users").stream():
            uid = user_doc.id
            prefs_ref = (
                db.collection("users")
                .document(uid)
                .collection(PREFS_SUBCOL)
                .document(PREFS_DOC)
            )
            doc = prefs_ref.get()
            if doc.exists:
                p = doc.to_dict()
                if p.get("email"):
                    results.append((uid, p))
    except Exception as exc:
        logger.error("Scheduler: Failed to read user prefs — %s", exc)
    return results


async def _send_report_for_user(uid: str, prefs: dict, report_type: str, db):
    from email_service import email_service
    from report_generator import get_daily_data, get_weekly_data, get_monthly_data

    if not email_service.configured:
        logger.warning("Scheduler: email not configured — skipping")
        return

    recipient = prefs.get("email", "")
    business_name = prefs.get("business_name", "Your Business")

    try:
        if report_type == "daily":
            data = get_daily_data(db, uid)
            ok = await email_service.send_daily_summary(data, recipient, business_name)
        elif report_type == "weekly":
            data = get_weekly_data(db, uid)
            ok = await email_service.send_weekly_summary(data, recipient, business_name)
        elif report_type == "monthly":
            data = get_monthly_data(db, uid)
            ok = await email_service.send_monthly_summary(data, recipient, business_name)
        else:
            return

        if ok:
            _store_report_record(db, uid, report_type, data)
            logger.info("Scheduler: %s report sent to %s (%s)", report_type, recipient, uid)
        else:
            logger.warning("Scheduler: %s report failed for %s", report_type, uid)

    except Exception as exc:
        logger.error("Scheduler: error generating %s report for %s: %s", report_type, uid, exc)


def _store_report_record(db, uid: str, report_type: str, data: dict):
    """Write a lightweight record to users/{uid}/accountant_reports for history view."""
    try:
        record = {
            "type": report_type,
            "label": data.get("label") or data.get("month_name") or report_type,
            "period_start": data.get("period_start", ""),
            "period_end": data.get("period_end", ""),
            "net_profit": data.get("net_profit", 0),
            "revenue": data.get("revenue", 0),
            "generatedAt": datetime.utcnow().isoformat() + "Z",
            "source": "scheduled_email",
        }
        db.collection("users").document(uid).collection("accountant_reports").add(record)
    except Exception as exc:
        logger.warning("Scheduler: could not store report record — %s", exc)


async def _run_job(report_type: str, pref_key: str):
    db = _init_firebase()
    if db is None:
        return

    user_prefs = _all_user_prefs(db)
    if not user_prefs:
        logger.info("Scheduler: no users with %s reports enabled", report_type)
        return

    tasks = []
    for uid, prefs in user_prefs:
        if prefs.get(pref_key):
            tasks.append(_send_report_for_user(uid, prefs, report_type, db))

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    else:
        logger.info("Scheduler: no users opted in to %s reports", report_type)


async def _daily_job():
    await _run_job("daily", "daily_enabled")


async def _weekly_job():
    await _run_job("weekly", "weekly_enabled")


async def _monthly_job():
    await _run_job("monthly", "monthly_enabled")


async def _stock_alert_job():
    from email_service import email_service

    db = _init_firebase()
    if db is None:
        return

    user_prefs = _all_user_prefs(db)
    for uid, prefs in user_prefs:
        if not prefs.get("stock_alerts_enabled"):
            continue
        recipient = prefs.get("email", "")
        business_name = prefs.get("business_name", "Your Business")
        try:
            problem_products = []
            for doc in db.collection("products").stream():
                p = doc.to_dict()
                if p.get("createdBy", uid) != uid:
                    continue
                qty = float(p.get("quantity", 0) or 0)
                min_stock = float(p.get("minStock", 10) or 10)
                if qty <= min_stock:
                    problem_products.append({
                        "name": p.get("name", "—"),
                        "category": p.get("category", ""),
                        "quantity": qty,
                        "minStock": min_stock,
                    })
            if problem_products:
                await email_service.send_stock_alert(problem_products, recipient, business_name)
        except Exception as exc:
            logger.error("Scheduler: stock alert failed for %s: %s", uid, exc)


class ReportScheduler:
    def __init__(self):
        self.scheduler = AsyncIOScheduler()

    def start(self):
        # Daily P&L — 8 PM UTC every day
        self.scheduler.add_job(
            _daily_job, CronTrigger(hour=20, minute=0),
            id="daily_report", replace_existing=True, name="Daily P&L email",
        )
        # Weekly report — Monday 9 AM UTC
        self.scheduler.add_job(
            _weekly_job, CronTrigger(day_of_week="mon", hour=9, minute=0),
            id="weekly_report", replace_existing=True, name="Weekly report email",
        )
        # Monthly summary — 1st of month, 8 AM UTC
        self.scheduler.add_job(
            _monthly_job, CronTrigger(day=1, hour=8, minute=0),
            id="monthly_report", replace_existing=True, name="Monthly summary email",
        )
        # Stock alerts — 8 AM UTC every day
        self.scheduler.add_job(
            _stock_alert_job, CronTrigger(hour=8, minute=0),
            id="stock_alert", replace_existing=True, name="Daily stock alert",
        )
        self.scheduler.start()
        logger.info(
            "Report scheduler started: daily 8PM, weekly Mon 9AM, monthly 1st 8AM, stock-alert 8AM (all UTC)"
        )

    def stop(self):
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("Report scheduler stopped")

    def update_schedule(self, settings: dict):
        """Legacy shim — per-user preferences now stored in Firestore via API."""
        pass


report_scheduler = ReportScheduler()
