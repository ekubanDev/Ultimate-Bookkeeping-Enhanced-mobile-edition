"""
Firebase ID token verification for protected API routes.

Cloud Run may run in a different GCP project than Firebase (Auth / Hosting). Tokens are always issued for
the Firebase project — set FIREBASE_PROJECT_ID to that project id on the backend. Use a service account key
from the Firebase project (or equivalent) if default credentials on the Run service cannot verify tokens.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_firebase_app_ready = False

# uid -> list of monotonic timestamps in the last window
_rate_bucket: Dict[str, List[float]] = {}


def ensure_firebase_admin_app() -> bool:
    """Initialize firebase-admin once. Returns False if initialization fails."""
    global _firebase_app_ready
    if _firebase_app_ready:
        return True
    try:
        import firebase_admin
        from firebase_admin import credentials

        if firebase_admin._apps:
            _firebase_app_ready = True
            return True

        sa_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", "").strip()
        pid = os.environ.get("FIREBASE_PROJECT_ID", "").strip()
        app_options = {"projectId": pid} if pid else None
        if sa_path and os.path.isfile(sa_path):
            firebase_admin.initialize_app(credentials.Certificate(sa_path), options=app_options)
        else:
            firebase_admin.initialize_app(options=app_options)

        _firebase_app_ready = True
        logger.info("Firebase Admin initialized for auth verification")
        return True
    except Exception as exc:
        logger.warning("Firebase Admin could not be initialized: %s", exc)
        return False


def ai_chat_auth_enforced() -> bool:
    """
    When True, /api/ai/chat requires a valid Firebase ID token.
    - AI_CHAT_REQUIRE_AUTH=false disables (local / tests).
    - AI_CHAT_REQUIRE_AUTH=true forces on.
    - Default: on when K_SERVICE is set (Cloud Run).
    """
    v = os.environ.get("AI_CHAT_REQUIRE_AUTH", "").strip().lower()
    if v in ("0", "false", "no", "off"):
        return False
    if v in ("1", "true", "yes", "on"):
        return True
    return bool(os.environ.get("K_SERVICE"))


def verify_bearer_id_token(authorization: Optional[str]) -> Dict[str, Any]:
    """Verify Authorization: Bearer <Firebase ID token>. Returns decoded claims."""
    from firebase_admin import auth

    if not authorization or not authorization.startswith("Bearer "):
        raise ValueError("missing_or_invalid_authorization")
    token = authorization[7:].strip()
    if not token:
        raise ValueError("empty_token")
    return auth.verify_id_token(token)


def check_ai_chat_rate_limit(uid: str, max_per_minute: Optional[int] = None) -> None:
    """Raises PermissionError if uid exceeds per-minute limit (best-effort, per instance)."""
    if max_per_minute is None:
        try:
            max_per_minute = int(os.environ.get("AI_CHAT_RATE_LIMIT_PER_MINUTE", "40"))
        except ValueError:
            max_per_minute = 40
    if max_per_minute <= 0:
        return

    now = time.monotonic()
    window = 60.0
    bucket = _rate_bucket.setdefault(uid, [])
    while bucket and bucket[0] < now - window:
        bucket.pop(0)
    if len(bucket) >= max_per_minute:
        raise PermissionError("rate_limited")
    bucket.append(now)
