# SnackStream Analytics

A dashboard that analyses sales performance across platforms (Shopee, TikTok, Facebook and the team's own website) for the course
project "AI-Automated Social Commerce & Livestream Storefront". The dashboard is the main feature; the customer-facing `/shop` page is secondary.

The user interface is in **Vietnamese**; code, comments and documentation are in English.

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Backend API | **Python 3.12+**, **FastAPI**, Uvicorn, Pydantic | The work is data-heavy (CSV/Excel intake, order reconciliation, metric maths) and Python has the best tooling for it; FastAPI gives a typed JSON API with little code |
| Database | **PostgreSQL** (SQLite fallback for quick local runs) | Constraints and `ON CONFLICT` upserts make duplicate protection and the "missing vs 0" states reliable |
| ORM / migrations | **SQLAlchemy 2**, **Alembic**, `psycopg` 3 | Versioned schema changes that the whole team can reproduce; migrations run on API start |
| File intake | `openpyxl` (Excel), Python `csv` | Row-level validation and error reports for CSV/XLSX uploads |
| Auth | Signed session cookie (`itsdangerous`), scrypt password hash, CSRF header | Simple admin login; secrets never reach the browser |
| Frontend | **Next.js 16** (App Router), **React 19**, **TypeScript** | Server components fetch data next to the API; type-checked against the API JSON |
| Styling | **Tailwind CSS 4** + a custom design system (CSS variables, light/dark theme, motion) | Consistent look; every animation respects `prefers-reduced-motion` |
| Charts / icons | **Recharts 3**, `lucide-react`, `nextjs-toploader` | Themed charts that follow the CSS color tokens; a table view for every chart |
| Integration | **Make.com** webhook (`POST /api/ingest/make`) | Matches the proposal's iPaaS layer; orders and logs can be pushed instead of imported |
| Testing | **pytest**, `httpx`, `tests/smoke.py`, `tsc`, ESLint | Formulas, import rules, migration and every endpoint are covered |
| Packaging | **Docker** + Docker Compose (`postgres:17`, api, web) | One command to run the whole system |

Deliberately not used: NestJS (it would duplicate FastAPI's role), LangChain/LangGraph and vector databases (the chatbot looks up structured
fields by intent, so RAG is unnecessary), WebSockets (the dashboard does not need live push).

## Architecture

```
apps/
  api/       FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL   (metric computation, data intake, JSON API)
  web/       Next.js 16 + TypeScript + Tailwind 4 + Recharts (dashboard UI + customer page /shop)
  chatbot/   Home for the chatbot module (see apps/chatbot/README.md)
docs/          Architecture notes
data_samples/  Sample CSV templates for each person who supplies data
```

The browser only talks to Next.js. Next.js proxies `/api/*` to FastAPI (same origin, so the session cookie works and API keys never reach the
browser). The `API_URL` variable of the Next.js process decides where FastAPI lives at runtime.

## Run in development (no Docker needed)

Requires Python 3.12+ and Node 22+.

```powershell
# 1) API (port 8000) — uses SQLite if DATABASE_URL is not set
cd apps/api
pip install -r requirements.txt
$env:SEED_DEMO="1"            # seed labelled demo data on first run (omit when using real data)
python -m uvicorn app.main:app --reload

# 2) Web (port 3000)
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000 and sign in with `admin` / `admin123` (dev only). Migrations run automatically when the API starts.

## Use PostgreSQL

```sql
CREATE USER snack_app WITH PASSWORD 'your-password';
CREATE DATABASE snackstream OWNER snack_app;
```

Put this in `apps/api/.env` (see `apps/api/.env.example`):
`DATABASE_URL=postgresql+psycopg://snack_app:your-password@localhost:5432/snackstream`.
Use a **separate** database; never write into Odoo's own database.

## Run with Docker

```powershell
copy .env.example .env      # then edit POSTGRES_PASSWORD, SECRET_KEY, ADMIN_PASSWORD
docker compose up --build   # web :3000, api :8000, postgres
```

## Deploy

Two services plus one PostgreSQL. You must set `APP_ENV=production`, `SECRET_KEY` and `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`, created with
`python -m app.security "your-password"`); the API refuses to start while any of them still has its default value. The session cookie gets the Secure flag automatically.
- **api**: `apps/api/Dockerfile`, variable `DATABASE_URL` (a provider's `postgres://` URL is accepted).
- **web**: `apps/web/Dockerfile`, variable `API_URL` pointing at the api's internal address.
- To get demo data on the first start, set `SEED_DEMO=1`, and remove it once real data is in.

## Screens

| Path | Content |
|---|---|
| `/` | Overview: KPIs, daily trends, platform comparison, best/worst content, source status, warnings |
| `/shopee` | 4 tabs: Shop & products, Live, Video, Ads |
| `/external` | TikTok/Facebook: the direct-to-Shopee path and the via-website path |
| `/funnel` | Funnel, step-to-step rates, per-1,000-views conversion, period/content comparison |
| `/ai` | Chatbot, AI Live, AI video, AI vs human vs hybrid comparison |
| `/products` | SKUs, prices, stock, Odoo status |
| `/data` | CSV/Excel import, manual entry, data coverage, import history, demo data |
| `/metrics` | Definition and formula of every metric |
| `/shop` | Customer page: 3 products + a Shopee buy button (records website events) |

## Data rules

- A missing value is **never** treated as 0. There are four states: has a value · no data yet (empty cell) · source does not provide it (`NA`) · not connected (`NC`).
- Ratios use only the contents that have **both** numerator and denominator, and show `n/N` when computed on a subset. A zero denominator shows "Không tính được" (cannot be computed).
- Orders are keyed by the Shopee order id and attributed to at most one content. The total comes from the orders table; orders that only appear in aggregate
  reports are shown per content (tagged "báo cáo" = report) and are never added to the total. Counted statuses: shipping, completed (`COUNTED_STATUSES`).
- Views from different platforms are never summed into "unique people". CAC is computed only when the source reveals new customers; otherwise cost per order is shown.
- Duplicate protection: file hash + upsert on natural keys. Strict mode (default): one bad row rejects the whole file.
- Demo data carries a `DEMO` label, can be deleted separately, and cannot be mixed with real data.

## Importing data

Templates: `data_samples/` or the `/data` page. Suggested order: `contents` → `metrics` → `orders` → `costs` → `ai_live` / `chat_logs` / `video_production`.
Make.com webhook: set `INGEST_TOKEN`, then call `POST /api/ingest/make` with an `X-Ingest-Token` header and a body like
`{"kind": "metrics", "rows": [...], "source_note": "..."}`.

## Tests

```powershell
cd apps/api; python -m pytest tests -q   # 18 tests: formulas, missing data, zero denominator, duplicate import, duplicate orders, migration
cd apps/api; python tests/smoke.py       # hits every endpoint against a temporary DB, checks login + CSRF
cd apps/web; npx tsc --noEmit; npx eslint src; npm run build
```

## Still pending

| Item | Waiting on | Notes |
|---|---|---|
| Run against a real PostgreSQL | An | Only tested on SQLite so far; run `pytest` and `smoke.py` with a Postgres `DATABASE_URL` |
| Shopee, TikTok, Facebook APIs | Viet to verify access | CSV/Excel import for now; no adapters yet |
| Odoo (SKUs, stock) | Chau | Demo products for now; CSV `products` import works |
| Chatbot logs | Phong | The dashboard receives them as `chat_logs` files |
| AI Live logs | Nguyen | Received as `ai_live` files |
| How to identify "new customers" (CAC) | Viet | Until then, cost per order is shown |
| Live viewers by source | Viet | Currently shown as "source does not provide it" |
