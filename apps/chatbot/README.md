# apps/chatbot (Phong's module)

The advisory chatbot lives here, separate from the dashboard so the two of you never edit the same files.

Suggested flow (from the proposal): classify intent + SKU → look up exactly the matching fields from the product data / Odoo → compose the answer
only from the fields that were looked up → write a log. No LangChain or RAG; use a small model (e.g. GPT-4o-mini); API keys stay on the server.

## Handing logs over to the dashboard

Columns of `chat_logs` (see `data_samples/mau_chat_logs.csv`):

| Column | Meaning |
|---|---|
| `ts` | When the question was received, e.g. `2026-10-30 14:05:00` (required) |
| `session_id`, `question` | Required |
| `intent` | `INTENT_PRODUCT_INFO` / `SHELF_LIFE` / `PRICE_PROMO` / `STOCK_STATUS` / `OTHER` |
| `sku` | The SKU asked about |
| `latency_ms` | From receiving the question to having an answer (target < 3,500 ms) |
| `handoff` | `true` if it was handed to a human operator |
| `clicked_buy` | The customer clicked buy after the answer |
| `cost_vnd` | Model cost for this question |
| `correct` | Manual review result; leave empty if not reviewed |

Send them by importing a file on the `/data` page, or push automatically: `POST /api/ingest/make` with an `X-Ingest-Token` header
and a body like `{"kind": "chat_logs", "rows": [...], "source_note": "..."}`.
