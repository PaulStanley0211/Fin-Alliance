"""Authentication for FinAlly.

Public API:
    create_user        - Insert a new user row + seed their portfolio
    get_user_by_username, get_user_by_id  - Repository lookups
    hash_password, verify_password        - bcrypt helpers
    current_user, current_user_optional   - FastAPI dependencies
    SESSION_USER_KEY, SESSION_ISSUED_KEY  - Cookie keys (string constants)
    SESSION_MAX_AGE_SECONDS               - 24 hours, fixed
"""

from .passwords import hash_password, verify_password
from .sessions import (
    SESSION_ISSUED_KEY,
    SESSION_MAX_AGE_SECONDS,
    SESSION_USER_KEY,
    current_user,
    current_user_optional,
    issue_session,
    revoke_session,
)
from .users import (
    UsernameTakenError,
    create_user,
    get_user_by_id,
    get_user_by_username,
)

__all__ = [
    "SESSION_ISSUED_KEY",
    "SESSION_MAX_AGE_SECONDS",
    "SESSION_USER_KEY",
    "UsernameTakenError",
    "create_user",
    "current_user",
    "current_user_optional",
    "get_user_by_id",
    "get_user_by_username",
    "hash_password",
    "issue_session",
    "revoke_session",
    "verify_password",
]
