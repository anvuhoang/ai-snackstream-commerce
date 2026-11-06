import hashlib
import hmac
import os
import sys
import time

from . import config

_attempts: dict[str, list[float]] = {}
MAX_ATTEMPTS, WINDOW = 5, 300


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"


def _verify_hash(pw: str, stored: str) -> bool:
    try:
        _, salt, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
        return hmac.compare_digest(calc.hex(), h)
    except Exception:  # noqa: BLE001
        return False


def check_credentials(user: str, pw: str) -> bool:
    if not hmac.compare_digest(user.encode(), config.ADMIN_USER.encode()):
        return False
    if config.ADMIN_PASSWORD_HASH:
        return _verify_hash(pw, config.ADMIN_PASSWORD_HASH)
    return hmac.compare_digest(pw.encode(), config.ADMIN_PASSWORD.encode())


def rate_limited(key: str) -> bool:
    now = time.time()
    hits = [t for t in _attempts.get(key, []) if now - t < WINDOW]
    _attempts[key] = hits
    return len(hits) >= MAX_ATTEMPTS


def record_failure(key: str) -> None:
    _attempts.setdefault(key, []).append(time.time())


def using_default_password() -> bool:
    return not config.ADMIN_PASSWORD_HASH and config.ADMIN_PASSWORD in ("admin123", "change-me")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print('Dùng: python -m app.security "mat-khau"')
        sys.exit(1)
    print(hash_password(sys.argv[1]))
