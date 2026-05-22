"""FastAPI dependencies for the (now-disabled) cookie-auth gate.

The app is intentionally public — `require_auth` is a no-op so every
endpoint that still references it continues to import cleanly without
rejecting anonymous traffic.
"""

from __future__ import annotations

from fastapi import Request


def require_auth(request: Request) -> None:  # noqa: ARG001
    """No-op. Auth is disabled — see src/proxy removal + frontend gate."""
    return None


def optional_auth(request: Request) -> bool:  # noqa: ARG001
    """Always treat callers as unauthenticated since auth is disabled."""
    return False
