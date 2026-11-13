# Architecture

## Shape: a modular monolith

One FastAPI application, one PostgreSQL database. The code is split into **modules** with clear owners, not into
separate services — three people do not need network calls, distributed transactions or three deploy pipelines.
Order creation and stock reservation in particular must happen in **one database transaction**.

```
Browser ──► Next.js (web) ──/api/* proxy──► FastAPI (api) ──► PostgreSQL
                │                              │
                └─ server components ──────────┤              (later) Redis · Odoo (JSON-RPC) · object storage
                   call the API directly       └─ background work: sync jobs, clip generation
```

| Module (`api/app/modules/…`, created when its phase starts) | Owns | Owner | Phase |
|---|---|---|---|
| `health`, `auth` | probes, back-office login | An | 0 |
| `catalog` | products, variants, categories, images | An | 1 |
| `cart`, `orders` | cart, checkout, order lifecycle, payments | An | 2 |
| `inventory` | stock, reservations, `StockProvider` (own / Odoo) | An | 3 |
| `analytics` | events, attribution, funnel, KPIs, imports | An | 4 |
| `chat` | chatbot backend and logs | Phong | 5 |
| `live` | live sessions, SSE stream, host pipeline | Nguyen | 6 |

A module is a package with `models.py`, `schemas.py`, `service.py`, `router.py`. Rules:

1. Routers are thin; business rules live in `service.py`.
2. A module reads another module's data **through its `service.py`**, not by importing its models into queries.
3. Cross-module calls go one way (e.g. `orders → inventory`, never back); if two modules need each other, extract the shared piece.
4. Every module that adds tables adds one import line to `app/models.py`.

## Why the browser never talks to the API directly

The web app proxies `/api/*` (`web/src/app/api/[...path]/route.ts`). The browser has a single origin, so the signed
session cookie works without CORS, no API address is exposed, and the response body is streamed — which is what
server-sent events need. Server components call the API with the visitor's cookie forwarded verbatim
(`cookies().toString()` re-encodes `=` and breaks the signature).

## Authentication

- **Customers have no accounts** (guest checkout). They get an unguessable order token and look orders up with token + phone.
- **Staff** sign in with e-mail and password (scrypt). The session is a signed cookie; every write sends `X-CSRF-Token`.
  Roles: `admin` (everything) and `staff` (operate orders and stock).
- Service-to-service writers (chat, live workers) will use scoped tokens, one per module, so a leak can be revoked alone.

## Data rules that shape the schema

- Money is stored as integer VND. Prices are **snapshotted** onto order items.
- A missing value is never stored or shown as 0: use null plus a status.
- Real and demo data are flagged and never mixed in one report by accident.
- Hiding a product never deletes it; orders keep their history.

## Scaling notes

| Concern | Now | When it matters |
|---|---|---|
| App processes | stateless, run several workers | needs the next two rows first |
| Rate limiter | in-process memory | Redis with the same interface before >1 worker |
| Live fan-out | single process | Redis pub/sub (or Postgres `LISTEN/NOTIFY`) before >1 worker |
| Analytics queries | SQL aggregation | summary tables / materialized views when rows reach the hundreds of thousands |
| Hot SKU | conditional UPDATE in a short transaction | queue the checkout during a flash sale |
| Images / catalog pages | local volume, server render | object storage + CDN; cache catalog pages |

## Decisions (short ADRs)

- **FastAPI + SQLAlchemy over a TypeScript backend.** The hard parts are data intake, metric correctness, row-locked stock
  and AI integrations; Python has the least friction for those. The frontend stays TypeScript, and types are generated
  from the OpenAPI contract so the two sides cannot drift.
- **Sync SQLAlchemy.** Simpler transactions and row locks; FastAPI runs sync routes in a thread pool. Long-lived streams
  (SSE) must not hold a DB session.
- **One Alembic history, one owner.** Parallel migrations by three people produce multiple heads; schema PRs go through the owner.
- **PostgreSQL features are tested on PostgreSQL.** SQLite is for fast unit tests only.

## Contracts between modules

Agree on these **before** branching. `api/openapi.json` is the machine-readable part; this section holds
what OpenAPI cannot say (names, meanings, lifecycle). Changing anything here needs the owners of both sides to agree.

### Conventions

- **JSON:** camelCase fields, ISO-8601 UTC timestamps, money as integer VND (`priceVnd: 39000`).
- **Errors:** `{"error": {"code": "snake_case_code", "message": "English text for logs"}}`. Codes are stable; the web app
  translates them (`web/src/lib/errors.ts`).
- **IDs:** internal integer ids are never shown in public URLs. Public things use a slug (products) or a random token (orders).
- **Real vs demo:** every record and event carries `isDemo`. Reports can include or exclude demo, never blend silently.

### Catalog item (Phase 1) — consumed by chat and live

```
productId, slug, name, description, ingredients, storage,
variants: [{ sku, name, priceVnd, compareAtVnd?, weightG, available (int), stockUpdatedAt }],
images: [{ url, alt }], categoryId, shopeeUrl?
```

`available` is the sellable quantity (on hand minus reserved). Consumers must not assume it is fresh: show `stockUpdatedAt`
or treat an old value as unknown. Chat and live **read** the catalog through the API; they never copy prices.

### Cart (Phase 2) — shared by store, chat and live

`POST /api/cart/items {sku, qty}`, `PATCH`, `DELETE`, `GET /api/cart`. The cart is server-side and identified by a cookie.
Any surface (a chat card, a pinned live item) adds to the same cart with the same call.

### Events (Phase 4) — written by web, chat and live

Common fields on every event: `event` (name), `sessionId`, `occurredAt`, `isDemo`, `sku?`, `source?`, `campaign?`, `contentCode?`
(UTM `utm_source`, `utm_campaign`, `utm_content`), and one of `liveId` / `conversationId` when relevant.

| Event | When | Extra fields |
|---|---|---|
| `product_view` | a product page is opened | `sku` |
| `add_to_cart` | an item is added from any surface | `sku`, `qty`, `surface` (`store|chat|live`) |
| `checkout_started` | the checkout page is opened with a non-empty cart | `cartValueVnd` |
| `order_created` | the order row is created | `orderId` |
| `order_completed` | staff mark the order completed | `orderId` |
| `live_join` | a visitor joins a live session | `liveId` |
| `live_product_click` | a pinned product is opened / added | `liveId`, `sku` |
| `chat_question` | a visitor sends a chat question | `conversationId`, `sku?` |

`order_created` and `order_completed` are **different events**; the funnel shows both. A click on a "Buy on Shopee" button is
recorded as `shopee_click` and is never a purchase.

**Who writes what.** The browser (and chat / live) may send every event above **except** `order_created` and `order_completed`:
the server writes those itself, in the same transaction as the order change, once per order. The server stamps the time, and decides
`isDemo` from the product (or the order's items); a browser's claim is only used for events that name no product.

**Attribution rule (order → source).** *Last touch within 7 days.* The web app remembers the most recent `utm_source` / `utm_campaign` /
`utm_content` the visitor arrived with, for 7 days, and sends it with the checkout. The server stores it on the order (`utm_*`,
lower-cased source). No UTM in the window → the order is **direct**. Each order has exactly one source, so it appears in exactly one row
of the by-source table. Attribution only labels an order; it never changes an amount. First touch and coupon codes are not used yet.

**How the dashboard counts.** Page events count distinct *sessions* (never summed into "people"); `order_*` steps count distinct
orders; the two units are shown as such. Revenue is the total of orders completed in the period. A ratio with a zero denominator is shown
as "cannot be computed", never 0. A step with no data while later steps have data is marked as a tracking gap; the funnel is not bridged.
Days are Vietnam calendar days (UTC+7).

### Order lifecycle (Phase 2)

```
new ──► confirmed ──► shipping ──► completed
 └────────┴───────────────┴──────► cancelled      (stock released exactly once)
```

Payment is a separate record (`cod`: `pending → collected`), so "completed" and "paid" can differ. Counted toward revenue: `completed`.

### Logs written by chat and live (read by the dashboard)

- **Chat:** `conversationId`, `questionId`, `sku?`, `receivedAt`, `answeredAt`, `intent`, `outcome`
  (`answered|clarified|unanswered|handed_off|error`), `autoResolved`, `reviewedCorrect?` (null = not reviewed), `cardClicked`, `costVnd?`.
- **Live:** `liveId`, `questionId`, `sku?`, `receivedAt`, `startedPlayingAt?`, `outcome`, `intervention?`, `interruption?`, `costVnd?`.
  Latency = `startedPlayingAt − receivedAt`, measured on the visitor's side where possible.

"Answered", "resolved without a human" and "correct" are three different numbers; do not merge them.
