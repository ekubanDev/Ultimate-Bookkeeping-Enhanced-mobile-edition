"""
Async email service using Gmail SMTP via aiosmtplib.
"""

import os
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import aiosmtplib

from email_templates import (
    low_stock_alert_html,
    daily_summary_html,
    weekly_summary_html,
    test_email_html,
)

logger = logging.getLogger(__name__)


class EmailService:
    def __init__(self):
        self.gmail_user: str = os.environ.get("GMAIL_USER", "")
        self.gmail_password: str = os.environ.get("GMAIL_APP_PASSWORD", "")
        self.smtp_host = "smtp.gmail.com"
        self.smtp_port = 587

    @property
    def configured(self) -> bool:
        return bool(self.gmail_user and self.gmail_password)

    async def _send(self, to: str, subject: str, html_body: str) -> bool:
        if not self.configured:
            logger.warning("Email not configured — GMAIL_USER / GMAIL_APP_PASSWORD missing")
            return False

        msg = MIMEMultipart("alternative")
        msg["From"] = self.gmail_user
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html"))

        try:
            await aiosmtplib.send(
                msg,
                hostname=self.smtp_host,
                port=self.smtp_port,
                start_tls=True,
                username=self.gmail_user,
                password=self.gmail_password,
            )
            logger.info("Email sent to %s — %s", to, subject)
            return True
        except Exception as exc:
            logger.error("Failed to send email to %s: %s", to, exc)
            return False

    async def send_stock_alert(
        self, products: list, recipient: str, business_name: str = "Ultimate Bookkeeping"
    ) -> bool:
        html = low_stock_alert_html(products, business_name)
        count = len(products)
        subject = f"⚠️ Stock Alert — {count} item{'s' if count != 1 else ''} need attention"
        return await self._send(recipient, subject, html)

    async def send_daily_summary(
        self, data: dict, recipient: str, business_name: str = "Ultimate Bookkeeping"
    ) -> bool:
        html = daily_summary_html(data, business_name)
        subject = f"📊 Daily Summary — {data.get('date', 'Today')}"
        return await self._send(recipient, subject, html)

    async def send_weekly_summary(
        self, data: dict, recipient: str, business_name: str = "Ultimate Bookkeeping"
    ) -> bool:
        html = weekly_summary_html(data, business_name)
        subject = f"📈 Weekly Report — {data.get('weekStart', '')} to {data.get('weekEnd', '')}"
        return await self._send(recipient, subject, html)

    async def send_test(self, recipient: str) -> bool:
        html = test_email_html()
        return await self._send(recipient, "✅ Test — Email Notifications Working", html)


email_service = EmailService()
