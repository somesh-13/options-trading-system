"""Password hashing + JWT session cookie helpers.

A single password (bcrypt hash in `APP_PASSWORD_HASH`) gates the cookie. On
verify, we issue a signed JWT containing only `{iat, exp, sub}` and set it as
an HTTP-only cookie. There's no user table — `sub` is just a sentinel for
forward-compat in case we ever add multi-user.
"""

from __future__ import annotations

import logging
import os
import secrets
import time
from typing import Optional

import bcrypt
import jwt  # PyJWT

log = logging.getLogger(__name__)

COOKIE_NAME = "app_session"

# Default 7 days. Lowering this forces re-login more often; raising means a
# stolen cookie is replayable for longer.
DEFAULT_TTL_SEC = 7 * 24 * 3600

# bcrypt hashes anything longer than 72 bytes as nonsense; we truncate
# defensively on both hash + verify so the behavior is consistent.
_BCRYPT_MAX_BYTES = 72


def _encode_password(plain: str) -> bytes:
    b = plain.encode("utf-8")
    return b[:_BCRYPT_MAX_BYTES]


def _password_hash() -> Optional[str]:
    h = os.getenv("APP_PASSWORD_HASH", "").strip()
    return h or None


def is_configured() -> bool:
    """True iff a password hash is present in the env. When False, the auth
    endpoints respond 503 — better than silently letting anyone log in with
    a default password we forgot to change."""
    return _password_hash() is not None


def _session_secret() -> str:
    """Return the JWT signing secret. Required for cookies to survive a
    uvicorn restart. In dev, we'll auto-generate one but warn loudly so the
    user knows the cookie won't outlast the process."""
    secret = os.getenv("APP_SESSION_SECRET", "").strip()
    if secret:
        return secret
    # Process-local fallback. Survives this uvicorn run but not a restart.
    global _PROCESS_FALLBACK_SECRET
    try:
        return _PROCESS_FALLBACK_SECRET  # type: ignore[name-defined]
    except NameError:
        _PROCESS_FALLBACK_SECRET = secrets.token_urlsafe(48)
        log.warning(
            "APP_SESSION_SECRET not set — using a process-local fallback. "
            "Cookies will be invalidated when uvicorn restarts."
        )
        return _PROCESS_FALLBACK_SECRET


def _ttl_seconds() -> int:
    raw = os.getenv("APP_SESSION_TTL_SEC", "")
    try:
        return int(raw) if raw else DEFAULT_TTL_SEC
    except ValueError:
        return DEFAULT_TTL_SEC


def hash_password(plain: str) -> str:
    """Hash a plaintext password. Used by the CLI bootstrap helper."""
    salted = bcrypt.hashpw(_encode_password(plain), bcrypt.gensalt())
    return salted.decode("utf-8")


def verify_password(plain: str) -> bool:
    """Return True iff `plain` matches APP_PASSWORD_HASH."""
    h = _password_hash()
    if not h:
        return False
    try:
        return bcrypt.checkpw(_encode_password(plain), h.encode("utf-8"))
    except (ValueError, TypeError) as exc:
        # Malformed hash in the env, wrong scheme, etc.
        log.warning("password verify failed: %s", exc)
        return False


def issue_token() -> str:
    """Sign a fresh session JWT. Expiry is honored both in the cookie's
    Max-Age and in the JWT's `exp` claim so a clever client can't extend a
    cookie past its server-side lifetime."""
    now = int(time.time())
    payload = {
        "sub": "user",
        "iat": now,
        "exp": now + _ttl_seconds(),
    }
    return jwt.encode(payload, _session_secret(), algorithm="HS256")


def verify_token(token: str) -> Optional[dict]:
    """Decode + verify a JWT. Returns the payload dict on success, None on
    any failure (expired, bad signature, malformed)."""
    if not token:
        return None
    try:
        return jwt.decode(token, _session_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _cookie_secure() -> bool:
    """Mark the cookie Secure when the host is on https. Defaults to False
    for dev (LAN over http). Set APP_SESSION_COOKIE_SECURE=true in prod."""
    return os.getenv("APP_SESSION_COOKIE_SECURE", "false").strip().lower() in ("1", "true", "yes")


def set_session_cookie(response) -> None:
    """Attach a fresh session cookie to a Response object."""
    response.set_cookie(
        key=COOKIE_NAME,
        value=issue_token(),
        max_age=_ttl_seconds(),
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response) -> None:
    """Clear the session cookie. Browsers honor delete on path+name match."""
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        samesite="lax",
    )


def status_for(token: Optional[str]) -> dict:
    """Shape the response for GET /api/auth/me."""
    if not is_configured():
        return {"configured": False, "authenticated": False}
    if not token:
        return {"configured": True, "authenticated": False}
    payload = verify_token(token)
    if not payload:
        return {"configured": True, "authenticated": False}
    return {
        "configured": True,
        "authenticated": True,
        "expires_at": payload.get("exp"),
    }
