"""payOS (VietQR) payment links, signatures and payment look-up, per https://payos.vn/docs.

The signing helpers are pure functions. The one class that talks to the network takes its HTTP transport as an argument, so
tests run it against a fake. The checksum key never leaves the server; every webhook is verified with it.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

import httpx

# payOS wants a unique integer per payment link. We use  payment id * SCALE + a random attempt number, so the payment can
# be read back from the number, and asking for a new link for the same payment never collides with an earlier one.
ORDER_CODE_SCALE = 10_000
MAX_ORDER_CODE = 9_007_199_254_740_991  # the largest integer payOS accepts (2^53 - 1)


class PayosError(Exception):
    """payOS refused a request or could not be reached."""

    def __init__(self, message: str, code: str = "") -> None:
        super().__init__(message)
        self.code = code


def new_order_code(payment_id: int) -> int:
    return payment_id * ORDER_CODE_SCALE + secrets.randbelow(ORDER_CODE_SCALE)


def payment_id_of(order_code: int) -> int | None:
    """The payment an order code was made for, or None for a number that is not ours."""
    if not isinstance(order_code, int) or isinstance(order_code, bool) or order_code < ORDER_CODE_SCALE:
        return None
    if order_code > MAX_ORDER_CODE:
        return None
    return order_code // ORDER_CODE_SCALE


def _hex(key: str, text: str) -> str:
    return hmac.new(key.encode("utf-8"), text.encode("utf-8"), hashlib.sha256).hexdigest()


def sign_payment_request(
    key: str, *, amount: int, cancel_url: str, description: str, order_code: int, return_url: str
) -> str:
    """Signature of a create-link request: five fields in alphabetical order."""
    text = (
        f"amount={amount}&cancelUrl={cancel_url}&description={description}"
        f"&orderCode={order_code}&returnUrl={return_url}"
    )
    return _hex(key, text)


def _as_text(value: Any) -> str:
    if value is None or value in ("null", "NULL", "undefined"):
        return ""
    return str(value)


def sign_data(key: str, data: dict[str, Any]) -> str:
    """Signature of a webhook's `data` object: keys sorted, `key=value` joined by `&`, a missing value is empty."""
    text = "&".join(f"{k}={_as_text(data[k])}" for k in sorted(data))
    return _hex(key, text)


def verify_webhook(key: str, body: Any) -> bool:
    """True only if the webhook carries a signature made with our key over exactly its `data`."""
    if not isinstance(body, dict):
        return False
    data, given = body.get("data"), body.get("signature")
    if not isinstance(data, dict) or not isinstance(given, str) or not given:
        return False
    return hmac.compare_digest(sign_data(key, data), given.lower())


def description_for(order_code: str) -> str:
    """Shown on the customer's bank transfer. Letters and digits only: some banks drop anything else."""
    return "".join(ch for ch in order_code if ch.isalnum())[:25]


class PayosClient:
    def __init__(
        self,
        *,
        client_id: str,
        api_key: str,
        checksum_key: str,
        base_url: str,
        timeout_s: float = 15.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._checksum_key = checksum_key
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=timeout_s,
            headers={"x-client-id": client_id, "x-api-key": api_key},
            transport=transport,
        )

    def _call(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = self._http.request(method, path, **kwargs)
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise PayosError("payOS could not be reached or sent an unreadable answer") from exc
        if response.status_code != 200 or not isinstance(body, dict) or body.get("code") != "00":
            code = str(body.get("code", "")) if isinstance(body, dict) else ""
            desc = str(body.get("desc", "")) if isinstance(body, dict) else ""
            raise PayosError(f"payOS refused the request: {code} {desc}".strip(), code)
        data = body.get("data")
        if not isinstance(data, dict):
            raise PayosError("payOS answer has no data")
        return data

    def create_link(
        self,
        *,
        order_code: int,
        amount: int,
        description: str,
        return_url: str,
        cancel_url: str,
        expires_at: int | None,
    ) -> str:
        """Ask payOS for a payment page and return its address."""
        body: dict[str, Any] = {
            "orderCode": order_code,
            "amount": amount,
            "description": description,
            "returnUrl": return_url,
            "cancelUrl": cancel_url,
            "signature": sign_payment_request(
                self._checksum_key,
                amount=amount,
                cancel_url=cancel_url,
                description=description,
                order_code=order_code,
                return_url=return_url,
            ),
        }
        if expires_at is not None:
            body["expiredAt"] = expires_at
        url = self._call("POST", "/v2/payment-requests", json=body).get("checkoutUrl")
        if not isinstance(url, str) or not url.startswith("https://"):
            raise PayosError("payOS answer has no payment page")
        return url

    def get_payment(self, order_code: int) -> dict[str, Any]:
        """What payOS itself says about a payment link (status, amount, amount paid)."""
        return self._call("GET", f"/v2/payment-requests/{order_code}")
