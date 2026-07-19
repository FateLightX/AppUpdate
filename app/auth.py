from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from app import db

# intranet panel: long-lived session
SESSION_DAYS = 30
PBKDF2_ROUNDS = 120_000


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str, salt: Optional[str] = None) -> str:
    """Return storage form: pbkdf2$rounds$salt$hash (hex)."""
    if salt is None:
        salt = secrets.token_hex(16)
    raw = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ROUNDS,
    )
    return f"pbkdf2${PBKDF2_ROUNDS}${salt}${raw.hex()}"


def verify_password(password: str, stored: str) -> bool:
    stored = (stored or "").strip()
    if not stored or not password:
        return False
    try:
        algo, rounds_s, salt, digest = stored.split("$", 3)
        if algo != "pbkdf2":
            return False
        rounds = int(rounds_s)
        raw = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            rounds,
        )
        return hmac.compare_digest(raw.hex(), digest)
    except Exception:
        return False


def is_password_required() -> bool:
    return bool((db.get_settings().get("panelPasswordHash") or "").strip())


def create_session() -> str:
    token = secrets.token_urlsafe(32)
    expires = utc_now() + timedelta(days=SESSION_DAYS)
    db.create_session(token, expires.isoformat())
    return token


def validate_session(token: Optional[str]) -> bool:
    if not token:
        return False
    return db.session_valid(token, utc_now().isoformat())


def revoke_session(token: Optional[str]) -> None:
    if token:
        db.delete_session(token)


def revoke_all_sessions() -> None:
    db.delete_all_sessions()


def extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip() or None
    return None
