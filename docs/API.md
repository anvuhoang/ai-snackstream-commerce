# API reference

The API is described by an OpenAPI contract: [`api/openapi.json`](../api/openapi.json) (committed and checked in CI). When the API is running,
interactive documentation is at `/api/docs` (Swagger UI), for example <http://localhost:8000/api/docs>.

**107 documented endpoints** in 15 groups. All paths start with `/api`, bodies are JSON with camelCase fields, money is integer VND,
and errors look like `{"error": {"code": "snake_case_code", "message": "..."}}`. Stable codes are translated into Vietnamese by the web app.

| Group | Endpoints | Base path |
|---|---|---|
| [Probes](#probes) | 2 | `/api` |
| [Catalog (public)](#catalog-public) | 3 | `/api/catalog` |
| [Cart, checkout and orders (public)](#cart-checkout-and-orders-public) | 11 | `/api` |
| [Analytics events (public)](#analytics-events-public) | 1 | `/api/events` |
| [Customer accounts](#customer-accounts) | 10 | `/api/account` |
| [Chatbot (public)](#chatbot-public) | 4 | `/api/chat` |
| [AI live host (public)](#ai-live-host-public) | 11 | `/api/live` |
| [Back-office sign-in](#back-office-sign-in) | 3 | `/api/admin/auth` |
| [Back office: catalog](#back-office-catalog) | 14 | `/api/admin/catalog` |
| [Back office: orders](#back-office-orders) | 3 | `/api/admin/orders` |
| [Back office: customers](#back-office-customers) | 2 | `/api/admin/customers` |
| [Back office: inventory](#back-office-inventory) | 5 | `/api/admin/inventory` |
| [Back office: analytics](#back-office-analytics) | 10 | `/api/admin/analytics` |
| [Back office: chatbot](#back-office-chatbot) | 10 | `/api/admin/chat` |
| [Back office: live host](#back-office-live-host) | 18 | `/api/admin/live` |

## Probes

Public.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/healthz` | Liveness: the process is up. Does not touch the database. |
| `GET` | `/api/readyz` | Readiness: the process can reach its database. |

## Catalog (public)

Public. Only published products are returned.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/catalog/categories` | Categories that currently have at least one product on sale. |
| `GET` | `/api/catalog/products` | List published products (search `q`, category, paging). |
| `GET` | `/api/catalog/products/{slug}` | One published product with its variants, pictures and stock status. |

## Cart, checkout and orders (public)

The cart is identified by a cookie. `POST /api/orders` needs a signed-in customer (`401 login_required` otherwise) and a CSRF header.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/account/orders` | The signed-in customer's own orders. |
| `GET` | `/api/account/orders/{code}` | One of the signed-in customer's orders. |
| `GET` | `/api/cart` | The current cart with prices and stock status. |
| `POST` | `/api/cart/items` | Add a variant to the cart. |
| `DELETE` | `/api/cart/items/{variant_id}` | Remove a cart line. |
| `PATCH` | `/api/cart/items/{variant_id}` | Set the quantity of a cart line. |
| `POST` | `/api/orders` | Place an order from the cart. Needs a signed-in customer. Safe to repeat: the same Idempotency-Key and request return the same order. |
| `POST` | `/api/orders/lookup` | Find an order by its code and phone number (for orders placed without an account). |
| `POST` | `/api/orders/pay-link` | A new payment page for an order that was placed but not paid (the first page was lost, or payOS had failed). |
| `GET` | `/api/payments/payos/return` | The customer's browser lands on the web page, which asks this what to show. |
| `GET` | `/api/shop/config` | Public shop settings: shipping fee, free-shipping threshold, payment methods and order expiry. |

## Analytics events (public)

Public. The server writes `order_created` and `order_completed` itself; the browser cannot.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/events` | Record one behaviour event. Order events are not accepted here: the server writes them when an order changes. |

## Customer accounts

Register, sign-in and the e-mail link endpoints are public and rate limited; the rest need a customer session. Writes need `X-CSRF-Token`. Answers are `Cache-Control: no-store`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/account/change-password` | Change the password (asks for the current one). |
| `POST` | `/api/account/forgot-password` | Always the same answer, whether or not the address has an account, and the mail goes out after the reply is sent. |
| `POST` | `/api/account/login` | Sign a customer in with e-mail and password. |
| `POST` | `/api/account/logout` | End the customer session. |
| `GET` | `/api/account/me` | Never an error for a visitor: the page header asks this on every load and just wants to know who is there. |
| `PATCH` | `/api/account/profile` | Update name, phone and the saved delivery address. |
| `POST` | `/api/account/register` | Create a customer account and sign in; sends a verification e-mail. |
| `POST` | `/api/account/resend-verification` | Send a fresh verification e-mail. |
| `POST` | `/api/account/reset-password` | Set a new password with the one-time link from the reset e-mail. |
| `POST` | `/api/account/verify-email` | Confirm an e-mail address with the one-time link from the verification e-mail. |

## Chatbot (public)

Public and rate limited. Answers come from the shop's own data; a question can be handed to staff.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/chat/messages` | Send a message to the chatbot and get its answer with product cards. |
| `POST` | `/api/chat/questions/{question_id}/click` | Record that a visitor clicked a card in an answer. |
| `GET` | `/api/chat/status` | Whether the chatbot is on, its contact text and the support state. |
| `POST` | `/api/chat/support` | Ask for a person to follow up (hand-off to staff). |

## AI live host (public)

Viewer side of a live session: stream, questions and the Make callbacks (the callbacks require the shared callback token).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/live/current` | The live session that is on now, if any. |
| `GET` | `/api/live/events` | Server-sent events stream for a live session. |
| `POST` | `/api/live/make-answer` | Callback: Make delivers the answer to a viewer question (needs the callback token). |
| `POST` | `/api/live/make-result` | Callback: Make delivers the processed result (needs the callback token). |
| `POST` | `/api/live/media-metadata` | Measure the duration of an uploaded MP4 (needs ffprobe). |
| `GET` | `/api/live/products/{sku}` | Resolve an exact active SKU using the shop's publication and stock rules. |
| `POST` | `/api/live/{live_id}/host/viewers` | Register a viewer for the avatar host. |
| `GET` | `/api/live/{live_id}/host/viewers/{viewer_id}` | State of one viewer's host session. |
| `POST` | `/api/live/{live_id}/host/viewers/{viewer_id}/answer` | Send the browser's answer in the avatar connection handshake. |
| `POST` | `/api/live/{live_id}/host/viewers/{viewer_id}/leave` | A viewer leaves the host session. |
| `POST` | `/api/live/{live_id}/questions` | A viewer asks a question during a live session. |

## Back-office sign-in

Staff sign in with e-mail and password. The session is a signed cookie; writes send `X-CSRF-Token`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/auth/login` | Sign a staff member in with e-mail and password; returns the CSRF token. |
| `POST` | `/api/admin/auth/logout` | End the back-office session. |
| `GET` | `/api/admin/auth/me` | The signed-in staff member and their role. |

## Back office: catalog

Requires a back-office session. Reads: `admin` or `staff`. Writes: `admin` plus CSRF.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/catalog/categories` | List all categories. |
| `POST` | `/api/admin/catalog/categories` | Create a category. |
| `PATCH` | `/api/admin/catalog/categories/{category_id}` | Rename or reorder a category. |
| `DELETE` | `/api/admin/catalog/images/{image_id}` | Delete a picture. |
| `PATCH` | `/api/admin/catalog/images/{image_id}` | Change a picture's alt text or order. |
| `GET` | `/api/admin/catalog/products` | List products of every status for the back office. |
| `POST` | `/api/admin/catalog/products` | Create a draft product with its variants. |
| `GET` | `/api/admin/catalog/products/{product_id}` | One product with every field, including drafts. |
| `PATCH` | `/api/admin/catalog/products/{product_id}` | Edit a product's text and details. |
| `POST` | `/api/admin/catalog/products/{product_id}/hide` | Hide a product from the shop without deleting it. |
| `POST` | `/api/admin/catalog/products/{product_id}/images` | Upload a product picture (JPEG, PNG or WebP, checked by content). |
| `POST` | `/api/admin/catalog/products/{product_id}/publish` | Make a product visible in the shop (checks it is complete). |
| `POST` | `/api/admin/catalog/products/{product_id}/variants` | Add a variant (size, price, SKU). |
| `PATCH` | `/api/admin/catalog/variants/{variant_id}` | Edit a variant's name, price or weight. |

## Back office: orders

Requires a back-office session; writes need CSRF.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/orders` | List orders with filters and paging. |
| `GET` | `/api/admin/orders/{order_id}` | One order with items, payment and status history. |
| `POST` | `/api/admin/orders/{order_id}/status` | Move an order along its lifecycle (confirm, ship, complete, cancel). |

## Back office: customers

`admin` or `staff` can list; only `admin` can lock or unlock an account.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/customers` | List customer accounts with search, paging and order count. |
| `PATCH` | `/api/admin/customers/{customer_id}` | Switching an account off stops it signing in and ends any session it already has; its orders stay as they are. |

## Back office: inventory

Requires a back-office session; writes need CSRF.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/inventory` | Stock levels per variant. |
| `GET` | `/api/admin/inventory/sync` | Status of the last Odoo stock sync. |
| `POST` | `/api/admin/inventory/sync` | Pull the on-hand counts from Odoo now. A failure is recorded in `lastRun`, not raised. |
| `POST` | `/api/admin/inventory/{variant_id}/adjust` | Receive or correct stock by hand; recorded as a movement. |
| `GET` | `/api/admin/inventory/{variant_id}/movements` | The stock ledger of one variant. |

## Back office: analytics

Requires a back-office session.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/analytics/ai` | Chatbot and live-host report: questions, hand-offs, latency, live joins and clicks. |
| `GET` | `/api/admin/analytics/channels` | What TikTok, Facebook and others report (imported or typed in), per channel. |
| `GET` | `/api/admin/analytics/export/channels.csv` | Every stored channel number in the period, one row per value, in the same format the importer reads back. |
| `GET` | `/api/admin/analytics/export/overview.csv` | The funnel and the by-source table, as the dashboard shows them (empty cells = cannot be computed). |
| `GET` | `/api/admin/analytics/imports` | List imported data batches. |
| `POST` | `/api/admin/analytics/imports` | Import a CSV of numbers reported by other channels. A bad row refuses the whole file; the same file is refused twice. |
| `DELETE` | `/api/admin/analytics/imports/{batch_id}` | Undo an import batch. |
| `POST` | `/api/admin/analytics/manual` | Add channel figures by hand; recorded as an import batch. |
| `GET` | `/api/admin/analytics/overview` | Funnel, totals, sources and products for Vietnam calendar days `from`..`to` (default: the last 30 days). |
| `GET` | `/api/admin/analytics/shopee` | Shopee report: web clicks, landing and outbound sessions, outbound rate. |

## Back office: chatbot

Requires a back-office session; writes need CSRF. Saving an FAQ refreshes the chatbot's search index.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/chat/faqs` | List FAQs. |
| `POST` | `/api/admin/chat/faqs` | Add an FAQ; an approved FAQ is searchable by the bot. |
| `DELETE` | `/api/admin/chat/faqs/{faq_id}` | Delete an FAQ. |
| `PUT` | `/api/admin/chat/faqs/{faq_id}` | Edit or approve an FAQ. |
| `GET` | `/api/admin/chat/logs` | Chatbot question and answer logs. |
| `PATCH` | `/api/admin/chat/logs/{question_id}` | Mark an answer as reviewed (correct or not). |
| `GET` | `/api/admin/chat/settings` | Bot settings: on or off and the contact text. |
| `PUT` | `/api/admin/chat/settings` | Save bot settings. |
| `GET` | `/api/admin/chat/support` | List support requests handed off by the bot. |
| `PATCH` | `/api/admin/chat/support/{support_id}` | Update the state of a support request. |

## Back office: live host

Requires a back-office session; writes need CSRF.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/live` | Create a live session. |
| `GET` | `/api/admin/live/host-capabilities` | Which host features are configured (content, audio, transport). |
| `GET` | `/api/admin/live/{live_id}/content` | Read the session's script and audio status. |
| `POST` | `/api/admin/live/{live_id}/content/audio` | Generate the narration audio from the script. |
| `PUT` | `/api/admin/live/{live_id}/content/script` | Save the reviewed script for the pinned product. |
| `POST` | `/api/admin/live/{live_id}/end` | End a live session. |
| `POST` | `/api/admin/live/{live_id}/host/acquire` | Take control of the avatar host for this session. |
| `POST` | `/api/admin/live/{live_id}/host/action` | Control the host (for example mark it ready). |
| `POST` | `/api/admin/live/{live_id}/host/audio` | Send narration audio to the avatar. |
| `POST` | `/api/admin/live/{live_id}/host/mock-video` | Use the mock video for the host (testing). |
| `POST` | `/api/admin/live/{live_id}/host/offer` | Start the avatar connection handshake. |
| `POST` | `/api/admin/live/{live_id}/host/reply-audio/{question_id}` | Send the spoken answer to a viewer question to the avatar. |
| `POST` | `/api/admin/live/{live_id}/host/token` | Get a short-lived token for the avatar provider. |
| `POST` | `/api/admin/live/{live_id}/pause` | Pause a live session. |
| `POST` | `/api/admin/live/{live_id}/pin` | Pin a product in the live session. |
| `POST` | `/api/admin/live/{live_id}/questions/{question_id}/skip` | Skip a viewer question. |
| `POST` | `/api/admin/live/{live_id}/resume` | Resume a paused live session. |
| `POST` | `/api/admin/live/{live_id}/start` | Start a live session. |

## Not in the contract

`POST /api/payments/payos/webhook` is called by payOS's servers, not by the web app, so it is left out of the OpenAPI file. It accepts a
payment notification only when the checksum signature is valid and answers `200` for anything signed but already handled, so payOS does not retry it.
Set it in the payOS dashboard to `https://<your-api-host>/api/payments/payos/webhook`.
