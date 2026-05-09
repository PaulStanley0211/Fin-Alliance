"""Authentication endpoints — POST /signup, /login, /logout; GET /me.

Wire format (success):
    POST /api/auth/signup  ->  201 {"id", "username"}
    POST /api/auth/login   ->  200 {"id", "username"}
    POST /api/auth/logout  ->  204
    GET  /api/auth/me      ->  200 {"id", "username"}  (or 401 not_authenticated)

Errors are returned via the global APIError envelope ``{error, message}``:
- 400 invalid_request  — malformed body, username/password length wrong
- 401 invalid_credentials — bad username or password (login)
- 401 not_authenticated  — no/expired session (me)
- 409 username_taken — signup conflict

Side effect of signup: a fresh portfolio is seeded for the new user. That
gives the frontend a meaningful starting state ($10k cash, no positions, a
single anchor row in portfolio_snapshots so the P&L chart isn't blank).
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api import errors
from app.auth import (
    UsernameTakenError,
    create_user,
    current_user,
    current_user_optional,
    get_user_by_username,
    hash_password,
    issue_session,
    revoke_session,
    verify_password,
)
from app.db.connection import connect

router = APIRouter(prefix="/api/auth", tags=["auth"])


USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,32}$")
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 200


class SignupRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    username: str = Field(..., min_length=1, max_length=32)
    password: str = Field(..., min_length=1, max_length=PASSWORD_MAX_LENGTH)


class UserView(BaseModel):
    """Public view of a user — never carries the password hash."""

    id: str
    username: str


def _validate_username(username: str) -> None:
    if not USERNAME_PATTERN.match(username):
        raise errors.invalid_request(
            "Username must be 3-32 chars: letters, digits, or underscore."
        )


@router.post(
    "/signup",
    response_model=UserView,
    status_code=status.HTTP_201_CREATED,
)
def signup(body: SignupRequest, request: Request) -> UserView:
    _validate_username(body.username)
    pw_hash = hash_password(body.password)

    with connect() as conn:
        try:
            user = create_user(conn, body.username, pw_hash)
        except UsernameTakenError as exc:
            raise errors.username_taken() from exc

    issue_session(request, user["id"])
    return UserView(id=user["id"], username=user["username"])


@router.post("/login", response_model=UserView)
def login(body: LoginRequest, request: Request) -> UserView:
    """Verify credentials and start a session.

    The same generic error response is returned for "no such user" and
    "wrong password" so we don't leak which usernames are registered.
    """
    with connect() as conn:
        user = get_user_by_username(conn, body.username)

    if user is None or not verify_password(body.password, user["password_hash"]):
        raise errors.invalid_credentials()

    issue_session(request, user["id"])
    return UserView(id=user["id"], username=user["username"])


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request) -> Response:
    """Clear the current session. Always succeeds (idempotent)."""
    revoke_session(request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserView)
def me(user: dict = Depends(current_user)) -> UserView:
    """Return the authenticated user's id + username, or 401."""
    return UserView(id=user["id"], username=user["username"])


# Optional variant kept for other routers that want to know if a user is
# present without raising. Not registered as an endpoint; imported elsewhere.
__all__ = [
    "SignupRequest",
    "LoginRequest",
    "UserView",
    "current_user_optional",
    "router",
]
