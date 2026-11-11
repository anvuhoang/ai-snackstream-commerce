# Roadmap

Eight phases. Each one ends in something a person can run and a test that proves it. Sizes are **relative effort**
(S < M < L), not calendar time — plan the calendar once you know how many people work in parallel.

Codes in brackets (A02, P03, N01 …) are the work items of the team's assignment sheet (`Phan_cong_Web_TMDT.pdf`).

```
P0 Foundation ──► P1 Catalog ──┬─► P2 Cart & orders ─► P3 Inventory & Odoo ─┐
                               │                                            ├─► P4 Events & analytics ─► P7 Hardening
                               ├─► P5 Chatbot  (needs P1 catalog API) ───────┤
                               └─► P6 AI Live  (needs P1 + P2 cart)  ────────┘
```

After P1, three lanes run in parallel: **An** P2 → P3 → P4, **Phong** P5, **Nguyen** P6. P4 consumes the logs P5 and P6 write.

## Definition of done (every phase)

- Tests pass in CI (`pytest`, `tsc`, `eslint`, `next build`), and new behaviour has its own tests.
- Schema changes ship as an Alembic migration; `test_migrations` stays green.
- `api/openapi.json` and `web/src/lib/api/schema.d.ts` regenerated and committed.
- Empty / loading / error / out-of-stock states exist for every new screen; usable at phone width.
- `docs/` updated where a contract changed; a short demo script for the phase.

---

## P0 · Foundation — **done** (size S)

**Goal:** a codebase three people can work in without stepping on each other.

Delivered: modular FastAPI app (`app/modules/*`, one owner each, created when its phase starts), settings, DB + Alembic with a drift test, admin login
(scrypt, session cookie, CSRF, rate limit), health/readiness, JSON logs with request id, one error shape; Next.js app with
route groups `(store)`, `(admin)`, `(live)`, same-origin API proxy (stream-safe), typed client generated from OpenAPI,
design tokens; Docker Compose; CI incl. "contract is up to date" checks.

**Known gaps (intentional):** login rate limiter lives in process memory (move to Redis before running several workers);
tests run on SQLite — PostgreSQL-only behaviour is tested from P1 with `@pytest.mark.postgres`.

---

## P1 · Catalog and storefront browsing — A01, A02 (size M) · An

**Goal:** a visitor can find and read about a product; staff can manage the catalog.

- **DB:** `category`, `product` (slug, name, description, ingredients, storage, status `draft|published|hidden`),
  `variant` (unique `sku`, name, price VND as integer, weight), `product_image`. Search is a substring match on an accent-folded `search_text`
  column (works on SQLite and PostgreSQL; `pg_trgm` can come later if the catalog outgrows it).
- **API:** public `GET /api/catalog/categories | products | products/{slug}` (published only); admin CRUD, image upload,
  publish / hide.
- **Web:** home, listing with search + filter, product detail (variants, price, verified ingredients and
  storage; the stock badge arrives with P3), admin product screens. Seed with a realistic snack catalog (6–10 SKUs).
- **Rules:** every sellable variant has its own SKU; a product cannot be published without verified ingredients and
  storage text; hiding a product never deletes it (order history must keep working).
- **Staging deploy (end of this phase):** `dev` deploys to a public URL (API + PostgreSQL on Render, web on Vercel), so teammates share one
  environment and payment gateways can call back later. See "Hosting notes".
- **Accept:** a customer sees only published items; unaccented search finds "banh trang"; a `@postgres` test covers search.
- **Unblocks:** Phong and Nguyen — the catalog API is the shared source of products and prices.

## P2 · Cart, checkout, orders — A03, A04 (size L) · An — **built** (branch `feat/orders`)

**Goal:** a guest can place a cash-on-delivery order; staff can process it.

- **DB:** `cart`, `cart_item`, `customer` snapshot on the order, `order`, `order_item` (price snapshot),
  `order_status_history`, `payment` (COD, stored separately from order status), `idempotency_key`.
- **API:** server-side cart (cookie id; shared by store, chat and live); checkout validates price and stock on the server
  and computes totals; **idempotent** order creation; public lookup by unguessable token + phone; admin list / detail /
  status transitions `new → confirmed → shipping → completed | cancelled`.
- **Web:** cart, checkout form (react-hook-form + zod), confirmation page with lookup link, admin orders.
- **Rules:** never trust client prices; order codes are random tokens, not counters; the "Buy on Shopee" button opens
  Shopee and never counts as a purchase.
- **Online payment (sandbox):** a `PaymentProvider` interface (COD and one gateway sandbox, e.g. VNPay test environment). Flow: create
  the payment → redirect the customer to the gateway → the customer returns **and** the gateway calls our server-to-server callback
  (IPN) → verify the signature → mark the payment `paid | failed`. The callback is the source of truth, not the browser return.
  Callbacks are idempotent (the same one may arrive twice). An unpaid order keeps its stock reserved only for N minutes, then the
  reservation is released and the order expires. Gateway keys live in server environment variables only. Every payment screen says
  "Sandbox — no real money is charged".
- **What shipped:** module `app/modules/orders` (migration `0003`), cart cookie `ss_cart`, `POST /api/orders` with `Idempotency-Key`,
  look-up by code + phone (rate limited), admin orders with guarded status changes, VNPay sandbox (signed URL, callback `GET /api/payments/vnpay/ipn`,
  read-only return `GET /api/payments/vnpay/return`), unpaid-order expiry, stock seam `orders/stock.py` for P3. Web: cart + checkout, result page,
  look-up page, admin orders. Settings: `SHIPPING_FEE_VND` (30.000), `FREE_SHIP_FROM_VND` (300.000), `ORDER_EXPIRY_MINUTES` (15), `VNPAY_*` (empty = COD only).
- **Still to do for the online flow:** run `python -m app.cli expire-orders` every minute or so (Render cron job); the API also expires orders when
  they are read, so it is housekeeping, not correctness. The VNPay callback was tested with signed test callbacks; a real sandbox payment needs the
  public staging URL, which VNPay can reach.
- **Accept:** submitting twice creates one order; a customer cannot guess another order; admin endpoints reject anonymous
  callers; totals match line items to the dong; a replayed or tampered gateway callback is rejected or ignored; an unpaid order
  expires and releases its stock exactly once.

## P3 · Inventory and Odoo — A05 (size L) · An — **built** (branch `feat/inventory`)

**Goal:** stock is correct under concurrency, and Odoo can be the source of on-hand quantity.

- **Design:** `StockProvider` interface with two implementations — own tables (`on_hand`, `reserved`) and Odoo JSON-RPC.
  The web reserves stock; Odoo (if used) owns on-hand. Odoo reads are cached with a TTL and show last-sync / last-error.
- **Reservation:** one conditional `UPDATE … WHERE available >= qty` inside the order transaction; released **exactly
  once** on cancel; a reconciliation job compares web orders with Odoo deliveries so nothing is deducted twice.
- **Policy to decide first:** how stock is shared with Shopee (fixed quota per channel vs. web-held reservations), and what
  the shop does when Odoo is unreachable (use cached stock up to N minutes, then show "contact us").
- **Dev environment:** this phase adds a throw-away Odoo service to `docker-compose.yml`, so work never waits for real credentials.
- **What shipped** (branch `feat/inventory`, migration `0004`): module `app/modules/inventory` with `stock_level` (`on_hand`, `reserved`, `source`),
  an append-only `stock_movement` log and `stock_sync_run`. `orders/stock.py` is now the seam to it: `reserve` at checkout (one conditional `UPDATE`,
  `409 out_of_stock` when short), `ship` when an order starts shipping, `release` once on cancel or expiry (a shipped parcel that is cancelled goes back on hand).
  A variant with no `stock_level` row is **not tracked** and sells without limit; the demo seed gives each demo variant 100. Odoo: read-only client for
  Odoo's JSON-2 API (`odoo.py`), `python -m app.cli sync-odoo` and `GET/POST /api/admin/inventory/sync` copy `qty_available` by SKU (Internal Reference)
  into rows marked `source = odoo`; a sync never sets a count below what open orders hold, a failed sync changes nothing and is recorded. For Odoo-owned
  counts, shipping only ends the reservation (Odoo's own delivery lowers on-hand), and the count cannot be edited in the web. Web: `/admin/inventory`
  (list, filters, receive / correct, sync panel) and a movement history per variant. Settings: `ODOO_URL`, `ODOO_DB`, `ODOO_API_KEY`, `ODOO_TIMEOUT_S`.
- **Decisions taken:** D1 → the real Odoo Online instance (no throw-away Docker service). D2 (Shopee quota) is still open.
- **Added later:** the public catalog now says what stock a variant has (`available`, `stockStatus` = ok / low / out / unknown, `stockUpdatedAt`; a card has
  `soldOut`), the product page shows "Hết hàng" / "Chỉ còn N" and disables the button, and the cart refuses an item that is out (`out_of_stock`). A count copied
  from Odoo that is older than `STOCK_STALE_MINUTES` (default 0 = never) is `unknown`: the shop shows "contact the shop" and refuses to add it (`stock_unknown`).
  The free-shipping threshold on the pages comes from the shop settings. `render.yaml` lists the VNPay and Odoo variables and has the two cron jobs
  (`expire-orders`, `sync-odoo`) ready to uncomment (Render cron is a paid feature); `docs/DEPLOY.md` section 3 explains them.
  A concurrency test for the last unit is in `api/tests/test_inventory_postgres.py`: it runs only with `POSTGRES_TEST_URL` pointing at a **throw-away** database.
- **Still to do:** run that PostgreSQL test (it has only been checked to skip without a database); write deliveries back to Odoo, so web orders are visible there and
  the web count is exact between syncs.
- **Accept:** two simultaneous requests for the last unit → exactly one succeeds (`@postgres` test); cancelling twice
  releases once; one real or test Odoo SKU syncs; admin sees sync status and can resync.

## P4 · Events and analytics dashboard — A06–A11 (size L) · An

**Goal:** the team can answer "which content, on which channel, with how many views, produced how many clicks, orders, at
what cost — and what evidence is missing?"

- **Events:** public, schema-validated, rate-limited intake for the names in `docs/ARCHITECTURE.md` (Contracts) (`product_view`,
  `add_to_cart`, `checkout_started`, `order_created`, `order_completed`, `live_join`, `live_product_click`, `chat_question`)
  with session id, source/campaign (UTM), real/demo flag.
- **Attribution:** order → campaign by stored UTM or coupon, with the rule written down (window, first vs. last touch).
- **Dashboard:** overview, web funnel (view → cart → checkout → created → **completed**, created and completed shown
  separately), external sources (TikTok / Facebook → Shopee, → web → Shopee, → web → buy on web), Shopee tabs fed by
  CSV import, AI performance (chat + live + AI video vs. human), data management (CSV/Excel import, manual entry with
  source, duplicate protection, real vs. demo, export).
- **Rules:** never sum views into "unique people"; never add an order that appears in two reports; show "cannot be
  computed" for a zero or missing denominator; CAC only when new customers are identifiable, otherwise cost per order.
- **What shipped:** events (`event`), the attribution rule (docs/ARCHITECTURE.md), and the dashboard at `/admin/analytics` with five tabs.
  **Tổng quan**: funnel, sources, products. **Kênh ngoài**: numbers that TikTok, Facebook and others report. **Shopee**: web "buy on Shopee" clicks and
  Shopee's own report side by side (never added). **Chatbot và Live**: counts from the events P5 and P6 will send; until they do the tab says "not collected"
  instead of showing 0. **Dữ liệu**: CSV import (`POST /api/admin/analytics/imports`), manual entry, history with undo (admins), and CSV export of the channel numbers
  and of the funnel. Tables `import_batch` and `channel_metric` (migration `0006`). CSV columns: `date`, `channel`, optional `content`, and at least one of
  `views`, `impressions`, `clicks`, `orders`, `revenue`, `cost` (Vietnamese names and `;` separators are read too, `1.250.000đ` is a number).
  Rules enforced: an empty cell is "not reported" and stored as nothing, never 0; a file with any bad row is refused whole; the same file (SHA-256) or the same
  value for the same day/channel/content/metric/demo flag is never stored twice (a repeat is skipped and counted, never overwritten); a ratio uses only the days
  that report both numbers; CTR and cost per order say "cannot be computed" for a zero denominator; reported orders are kept apart from the web's own.
- **Still to do for P4:** Excel (`.xlsx`) import (CSV only today); the AI-versus-human comparison needs the chat and live logs from P5 and P6 (content type,
  auto-resolved); CAC needs identifiable new customers, so only cost per order is shown.
- **Accept:** each filter changes tables and charts consistently; missing steps are labelled, not bridged; importing the
  same file twice is rejected; a unit test per formula.
- *The earlier dashboard prototype lives on branch `legacy-dashboard`; use it as a reference for formulas and screens, not as a dependency.*

## P5 · Chatbot — P01–P05 (size M) · Phong

**Goal:** a visitor asks about a product on the site and gets a correct, grounded answer.

- Widget on shopping pages; opened from a product page it sends the SKU. Product cards in answers link to the right SKU.
- Flow: classify intent + SKU → look up exactly the matching catalog / FAQ fields → compose the answer **only from what
  was looked up** → log. Never guess price, stock, allergens or dates; ask when ambiguous; show contact info on failure.
- Admin: bot on/off, FAQ management, unanswered questions, human-takeover state. Visitors cannot edit FAQ.
- Logs: conversation / question id, SKU, received / answered times, outcome, error, handoff, card click, reviewed-correct.
- **Accept:** a written expectation table (right, ambiguous, missing-data, service-down questions) with actual results;
  usable on mobile without covering the buy button; the dashboard reads the real logs.

## P6 · AI Live — N01–N04 (size L) · Nguyen

**Goal:** a second browser watches a live session, sends a comment, and hears the host answer.

- **Session model + admin:** create session, script, SKUs; start / end; pin product; hide comment; skip question; pause AI.
- **Realtime:** server-sent events carry state, comments, pinned product and host answers; comments are plain POSTs.
- **Host pipeline:** script → comment queue → catalog lookup → answer → Vietnamese speech (with lip-sync if feasible) → resume
  script. No overlapping speech, no duplicate answers; log the skipped ones. *Decide early:* short queued clips vs. a true
  stream (OBS → WebRTC/HLS) — clips are far easier to measure and debug.
- **Player page `/live`:** states not-started / playing / disconnected / ended; open a pinned product or add it to the shared cart.
- **Metrics:** latency from "visitor sent" to "visitor starts hearing the answer"; interventions, interruptions, cost.
- **Accept:** end-to-end demo with evidence; dashboard filters by session; steps still done by hand are listed honestly.

## P7 · Hardening and release (size M) · all

- **Load:** k6 flows (browse → cart → checkout), 200–500 concurrent SSE connections, the "last item" race, dashboard
  aggregation on ~500k rows. Fix what the numbers show (SQL aggregation / summary tables, indexes, caching).
- **Scale-out prerequisites:** move rate limiting and live fan-out to Redis before running more than one API worker.
- **Security:** review PII handling (name, phone, address — minimum fields, retention), CSP headers, admin lockout, backups.
- **Release:** `main` deploys to the production-like environment (Render + Vercel), rollback tried once, backup / restore drill for the
  database, runbook, secrets only in the hosts' environment settings.
- **Demo:** watch live → ask → hear the host → pinned item → cart → order → admin sees order, stock and metrics; chatbot
  advises on the same SKU.

---

## Open decisions (settle before the phase that needs them)

| # | Decision | Needed by | Suggested default |
|---|---|---|---|
| D1 | Odoo: real instance with credentials, or the Docker test instance? | P3 | Docker test instance first |
| D2 | Stock shared with Shopee: quota per channel or web-held reservations | P3 | Quota per channel for the first release |
| D3 | Live media: queued clips or true stream | P6 start | Queued clips |
| D4 | Shipping fee rule (flat, by weight, free over X) | P2 | Flat fee + free over a threshold |
| D5 | Real shop or coursework demo | P2 | **Decided:** demo. COD plus an online-payment *sandbox* (test money only, labelled as such on screen) |
| D6 | Hosting target | P1 (staging) | **Decided:** web on Vercel, API + PostgreSQL on Render. See "Hosting notes" below |

## Hosting notes (Vercel + Render)

- **Branches map to environments:** `dev` → staging, `main` → production-like. Vercel creates a preview per pull request.
- **Render** runs the API from `api/Dockerfile` (root directory `api`) with a managed PostgreSQL. Run `python -m app.cli migrate` as the
  pre-deploy command, never at app start in production. Free instances may sleep after inactivity (the first request is slow) and free
  databases have a limited lifetime — check the current plan limits before relying on them, and keep a backup of demo data.
- **Vercel** builds the web app from the `web` directory with `API_URL` pointing at the Render API. The browser still sees one origin,
  so the admin session cookie keeps working through the `/api` proxy.
- **Live is the exception:** server-sent events are long-lived, and serverless functions have execution-time limits, so the live page
  must **not** stream through Vercel. Either connect straight to the API's public URL (anonymous, token-based, CORS allowed for the
  web origin only) or host the web app on Render as well. Decide this at the start of P6.
- **Payment callbacks need a public HTTPS URL**, which is why the staging deploy is part of P1: the gateway cannot reach `localhost`.
- Set `APP_ENV=production` and a real `SECRET_KEY` on Render; the API refuses to start otherwise.
