"""VNPay (sandbox) payment URL and callback signature, per the VNPay 2.1.0 integration guide.

Pure functions, no network. The shared secret never leaves the server; every callback is verified with it.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime, timedelta, timezone
from urllib.parse import quote_plus

VN_TZ = timezone(timedelta(hours=7))
SIGNATURE_FIELDS = ("vnp_SecureHash", "vnp_SecureHashType")


def _canonical(params: dict[str, str]) -> str:
    """Keys sorted, values URL-encoded, empty values dropped. Both the signature and the query string use this form."""
    return "&".join(f"{k}={quote_plus(str(v))}" for k, v in sorted(params.items()) if v not in (None, ""))


def sign(secret: str, params: dict[str, str]) -> str:
    return hmac.new(secret.encode(), _canonical(params).encode(), hashlib.sha512).hexdigest()


def txn_ref(order_id: int, payment_id: int) -> str:
    """Our reference for one payment attempt. Letters and digits only, as the gateway requires."""
    return f"{order_id}x{payment_id}"


def parse_txn_ref(ref: str) -> tuple[int, int] | None:
    try:
        order_id, payment_id = ref.split("x")
        return int(order_id), int(payment_id)
    except ValueError:
        return None


def build_payment_url(
    *,
    base_url: str,
    tmn_code: str,
    secret: str,
    return_url: str,
    ref: str,
    amount_vnd: int,
    order_code: str,
    ip: str,
    now: datetime,
    expires_at: datetime | None,
) -> str:
    created = now.astimezone(VN_TZ)
    params = {
        "vnp_Version": "2.1.0",
        "vnp_Command": "pay",
        "vnp_TmnCode": tmn_code,
        "vnp_Amount": str(amount_vnd * 100),  # the gateway wants the amount times 100
        "vnp_CreateDate": created.strftime("%Y%m%d%H%M%S"),
        "vnp_CurrCode": "VND",
        "vnp_IpAddr": ip or "127.0.0.1",
        "vnp_Locale": "vn",
        "vnp_OrderInfo": f"Thanh toan don hang {order_code}",
        "vnp_OrderType": "other",
        "vnp_ReturnUrl": return_url,
        "vnp_TxnRef": ref,
    }
    if expires_at is not None:
        params["vnp_ExpireDate"] = expires_at.astimezone(VN_TZ).strftime("%Y%m%d%H%M%S")
    return f"{base_url}?{_canonical(params)}&vnp_SecureHash={sign(secret, params)}"


def verify(secret: str, query: dict[str, str]) -> bool:
    """True only if the callback carries a signature made with our secret over exactly the other fields."""
    given = query.get("vnp_SecureHash", "")
    if not given:
        return False
    params = {k: v for k, v in query.items() if k.startswith("vnp_") and k not in SIGNATURE_FIELDS}
    return hmac.compare_digest(sign(secret, params).lower(), given.lower())


def utcnow() -> datetime:
    return datetime.now(UTC)
