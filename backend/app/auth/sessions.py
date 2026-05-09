"""Session helpers and the ``current_user`` FastAPI dependency.

Sessions are signed cookies via Starlette's ``SessionMiddleware`` (mounted in
``main.py``). We store two values inside the session:

- ``SESSION_USER_KEY`` — the user_id (UUID string).
- ``SESSION_ISSUED_KEY`` — UNIX timestamp at login. We use this to enforce a
  fixed 24-hour lifetime regardless of activity (Starlette's ``max_age``
  alone gives a *sliding* lifetime — every response refreshes the cookie's
  Max-Age, so a user touching the app every 23h would never log out).

Two dependencies:

- ``current_user`` — 401s when there's no valid session. Use this on every
  protected endpoint.
- ``current_user_optional`` — returns ``None`` instead of raising. Used by
  ``GET /api/auth/me`` so the endpoint can answer "you're not logged in"
  without a redirect-style 401.
"""

from __future__ import annotations

import time

from fastapi import Depends, Request

from app.api import errors
from app.db.connection import connect

from .users import get_user_by_id

SESSION_USER_KEY = "user_id"
SESSION_ISSUED_KEY = "issued_at"

# 24 hours, fixed (the user picked this in the design questions). The same
# value is passed to SessionMiddleware as ``max_age`` so the cookie expires
# even without an enforcement check on the server, but the explicit check
# below means we can't be tricked by a client preserving an old cookie.
SESSION_MAX_AGE_SECONDS = 24 * 60 * 60


def issue_session(request: Request, user_id: str) -> None:
    """Write the session keys for a freshly logged-in user."""
    request.session[SESSION_USER_KEY] = user_id
    request.session[SESSION_ISSUED_KEY] = int(time.time())


def revoke_session(request: Request) -> None:
    """Drop our session keys. Equivalent to ``request.session.clear()`` for
    our purposes — kept as a separate helper so future middleware or
    audit-log calls have a clear hook."""
    request.session.pop(SESSION_USER_KEY, None)
    request.session.pop(SESSION_ISSUED_KEY, None)


def _resolve_session(request: Request) -> dict | None:
    """Return the user row if the session is valid, else None.

    Validity rules:
    - Session has ``user_id`` and ``issued_at``.
    - ``issued_at`` is within ``SESSION_MAX_AGE_SECONDS`` of now (fixed).
    - The user_id still resolves to a row in ``users``.

    Stale or invalid sessions are silently revoked so a user with a
    long-expired cookie ends up at the login screen instead of a 500.
    """
    user_id = request.session.get(SESSION_USER_KEY)
    issued_at = request.session.get(SESSION_ISSUED_KEY)
    if not isinstance(user_id, str) or not isinstance(issued_at, (int, float)):
        return None
    if time.time() - issued_at > SESSION_MAX_AGE_SECONDS:
        revoke_session(request)
        return None

    with connect() as conn:
        user_row = get_user_by_id(conn, user_id)
    if user_row is None:
        # Account deleted while their cookie was still valid — clean up.
        revoke_session(request)
        return None
    return user_row


def current_user_optional(request: Request) -> dict | None:
    """Return the user row or ``None`` for unauthenticated requests."""
    return _resolve_session(request)


def current_user(
    user: dict | None = Depends(current_user_optional),
) -> dict:
    """Return the user row or raise 401."""
    if user is None:
        raise errors.APIError(401, "not_authenticated", "Sign in to continue.")
    return user


__all__ = [
    "SESSION_ISSUED_KEY",
    "SESSION_MAX_AGE_SECONDS",
    "SESSION_USER_KEY",
    "current_user",
    "current_user_optional",
    "issue_session",
    "revoke_session",
]
