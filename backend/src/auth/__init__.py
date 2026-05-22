"""Single-user cookie auth for the dashboard.

Public surface:
    sessions.verify_password(plain)           — bool, against APP_PASSWORD_HASH
    sessions.issue_token()                    — signed JWT (str)
    sessions.verify_token(token)              — payload dict | None
    sessions.set_session_cookie(response)     — bake the cookie onto a Response
    sessions.clear_session_cookie(response)   — clear it
    dependencies.require_auth                 — FastAPI Depends that 401s if missing
    dependencies.optional_auth                — Depends that returns bool, never 401s

The hash is created out-of-band via `python -m auth.cli set-password`. The
session secret defaults to a derived value if APP_SESSION_SECRET is unset, but
that mode is for dev only — production must set the env explicitly so the
secret survives uvicorn restarts.
"""

from . import sessions, dependencies

__all__ = ["sessions", "dependencies"]
