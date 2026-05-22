"""CLI bootstrap helpers for the auth module.

Usage:
    cd backend && source venv/bin/activate
    python -m auth.cli set-password

Reads a password from stdin (no echo) and prints its bcrypt hash. Paste the
output into your .env as APP_PASSWORD_HASH.
"""

from __future__ import annotations

import getpass
import secrets
import sys

from . import sessions


def _set_password() -> int:
    pw1 = getpass.getpass("New password: ")
    if len(pw1) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1
    pw2 = getpass.getpass("Confirm:      ")
    if pw1 != pw2:
        print("Passwords don't match.", file=sys.stderr)
        return 1
    h = sessions.hash_password(pw1)
    print()
    print("# Paste this into your .env (and a long random APP_SESSION_SECRET):")
    print(f"APP_PASSWORD_HASH='{h}'")
    print(f"APP_SESSION_SECRET='{secrets.token_urlsafe(48)}'")
    return 0


def _main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] != "set-password":
        print("usage: python -m auth.cli set-password", file=sys.stderr)
        return 2
    return _set_password()


if __name__ == "__main__":
    sys.exit(_main())
