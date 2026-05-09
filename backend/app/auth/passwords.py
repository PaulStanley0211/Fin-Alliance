"""Password hashing helpers.

Uses the ``bcrypt`` package directly. We tried passlib first but its 1.7.4
release doesn't support bcrypt 5.x (passlib has been unmaintained since
2020 and trips on the stricter type checking in modern bcrypt). Direct
bcrypt is four lines and avoids the dependency churn.

Bcrypt has a 72-byte input limit; longer passwords are accepted by our
endpoint validator (max 200 chars) but bcrypt itself silently truncates
beyond 72 bytes. We pre-truncate to keep the behavior explicit and to dodge
the runtime ``ValueError`` newer bcrypt versions raise on overlength input.

Two operations only:
- ``hash_password(plaintext)`` returns the salted hash to persist.
- ``verify_password(plaintext, stored_hash)`` returns a bool, never raises.
"""

from __future__ import annotations

import bcrypt

BCRYPT_MAX_BYTES = 72


def _to_bcrypt_input(plaintext: str) -> bytes:
    """Encode + truncate to bcrypt's 72-byte limit.

    Slicing in *bytes* (not chars) avoids splitting a multi-byte UTF-8
    sequence — the trailing partial code point is dropped instead of
    leaving an invalid byte.
    """
    encoded = plaintext.encode("utf-8")
    if len(encoded) <= BCRYPT_MAX_BYTES:
        return encoded
    truncated = encoded[:BCRYPT_MAX_BYTES]
    # Drop trailing bytes that are continuation of an incomplete code point.
    while truncated and (truncated[-1] & 0b11000000) == 0b10000000:
        truncated = truncated[:-1]
    return truncated


def hash_password(plaintext: str) -> str:
    """Return the bcrypt hash of ``plaintext`` as a UTF-8 string."""
    return bcrypt.hashpw(_to_bcrypt_input(plaintext), bcrypt.gensalt()).decode("utf-8")


def verify_password(plaintext: str, stored_hash: str) -> bool:
    """Return True iff ``plaintext`` hashes to ``stored_hash``.

    Returns False on any failure (malformed hash, type error, etc.). Never
    raises; the auth endpoint maps failure to a generic
    ``invalid_credentials`` response so we don't leak whether the username
    exists.
    """
    try:
        return bcrypt.checkpw(
            _to_bcrypt_input(plaintext), stored_hash.encode("utf-8")
        )
    except (ValueError, TypeError):
        return False


__all__ = ["hash_password", "verify_password"]
