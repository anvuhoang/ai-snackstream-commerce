"""Read-only client for Odoo's JSON-2 API (Odoo 19+): `POST /json/2/<model>/<method>` with a bearer API key.

We only read stock. Nothing here writes to Odoo, so the worst a mistake can do is show a wrong number for a while.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import Settings


class OdooError(Exception):
    """Odoo could not be reached, refused the key, or answered something unexpected. The message is safe to show."""


@dataclass(frozen=True)
class OdooStock:
    sku: str
    name: str
    on_hand: int  # quantity physically in Odoo's warehouse
    price_vnd: int


class OdooClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self._base = settings.odoo_url.rstrip("/")
        self._headers = {
            "Authorization": f"bearer {settings.odoo_api_key}",
            "X-Odoo-Database": settings.odoo_db,
            "Content-Type": "application/json",
        }
        self._client = httpx.Client(timeout=settings.odoo_timeout_s, transport=transport)

    def close(self) -> None:
        self._client.close()

    def _call(self, model: str, method: str, payload: dict) -> list | dict | bool | int:
        try:
            r = self._client.post(
                f"{self._base}/json/2/{model}/{method}", headers=self._headers, json=payload
            )
        except httpx.HTTPError as exc:
            raise OdooError(f"Cannot reach Odoo ({type(exc).__name__}).") from exc
        if r.status_code in (401, 403):
            raise OdooError(
                "Odoo refused the API key (wrong key, expired, or this account may not read stock)."
            )
        if r.status_code == 404:
            raise OdooError(
                "Odoo answered 404: check ODOO_URL and ODOO_DB (and that the JSON-2 API is available)."
            )
        if r.status_code != 200:
            raise OdooError(f"Odoo answered HTTP {r.status_code}.")
        try:
            return r.json()
        except ValueError as exc:
            raise OdooError("Odoo answered something that is not JSON.") from exc

    def stock_by_sku(self, skus: list[str]) -> dict[str, OdooStock]:
        """On-hand quantity for each of our SKUs that Odoo knows (matched on Internal Reference)."""
        if not skus:
            return {}
        rows = self._call(
            "product.product",
            "search_read",
            {
                "domain": [["default_code", "in", skus]],
                "fields": ["default_code", "name", "qty_available", "list_price"],
                "context": {"active_test": True},
            },
        )
        if not isinstance(rows, list):
            raise OdooError("Unexpected answer from Odoo.")
        out: dict[str, OdooStock] = {}
        for r in rows:
            sku = r.get("default_code") or ""
            if not sku:
                continue
            # A SKU can be duplicated in Odoo (archived copy, other company). Keep the larger count and never crash.
            qty = max(0, int(r.get("qty_available") or 0))
            prev = out.get(sku)
            if prev is None or qty > prev.on_hand:
                out[sku] = OdooStock(sku, r.get("name") or "", qty, int(r.get("list_price") or 0))
        return out
