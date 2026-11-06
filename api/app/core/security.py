"""Password hashing, a small rate limiter and token helpers. Standard library only."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    """Format: scrypt$N$r$p$salt$hash. Cost parameters are stored with the hash."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(calc.hex(), digest)
    except (ValueError, TypeError):
        return False


def new_public_token(nbytes: int = 18) -> str:
    """Unguessable URL-safe token for public links (order lookup, etc.). Never use sequential ids publicly."""
    return secrets.token_urlsafe(nbytes)


class RateLimiter:
    """Sliding-window limiter kept in process memory.

    Good enough for one worker. With several workers each keeps its own count, so move this behind Redis
    (same interface) before scaling out — see docs/ARCHITECTURE.md.
    """

    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self._hits: dict[str, list[float]] = {}

    def _recent(self, key: str) -> list[float]:
        now = time.monotonic()
        hits = [t for t in self._hits.get(key, []) if now - t < self.window]
        self._hits[key] = hits
        return hits

    def blocked(self, key: str) -> bool:
        return len(self._recent(key)) >= self.limit

    def hit(self, key: str) -> None:
        self._recent(key).append(time.monotonic())

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)
