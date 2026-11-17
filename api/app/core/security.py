"""Password hashing, a small rate limiter and token helpers. Standard library only."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

# Cost for NEW hashes. OWASP's floor for scrypt is N=2^15 with p=3, or N=2^17 with p=1; this sits between those and costs
# about 0.2 s per hash on a laptop. Stored hashes keep the cost they were made with, and `needs_rehash` lets a login upgrade them.
_N, _R, _P = 2**15, 8, 2


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    # The default memory cap (32 MiB) is below what N=2^15 needs, so state the real need: 128 * N * r * p bytes, plus headroom.
    return hashlib.scrypt(
        password.encode(), salt=salt, n=n, r=r, p=p, maxmem=128 * n * r * p + 16 * 1024 * 1024
    )


def hash_password(password: str) -> str:
    """Format: scrypt$N$r$p$salt$hash. Cost parameters are stored with the hash."""
    salt = secrets.token_bytes(16)
    digest = _scrypt(password, salt, _N, _R, _P)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        calc = _scrypt(password, bytes.fromhex(salt), int(n), int(r), int(p))
        return hmac.compare_digest(calc.hex(), digest)
    except (ValueError, TypeError):
        return False


def needs_rehash(stored: str) -> bool:
    """True when this stored hash was made with a lower cost than today's. Call it after a successful sign-in."""
    try:
        scheme, n, r, p, _salt, _digest = stored.split("$")
        return scheme == "scrypt" and (int(n), int(r), int(p)) < (_N, _R, _P)
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
