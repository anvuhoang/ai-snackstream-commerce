<div align="center">

# SnackStream

**An AI-integrated online shop for Vietnamese street snacks.**
Storefront · customer accounts · chatbot · AI live host · payments · back office · analytics

[![CI](https://github.com/anvuhoang/ai-snackstream-commerce/actions/workflows/ci.yml/badge.svg)](https://github.com/anvuhoang/ai-snackstream-commerce/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-modular_monolith-009688?logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

</div>

Customers browse a catalog, ask a chatbot, watch an AI live host and check out with cash on delivery or a VietQR payment.
Staff run the shop from a back office covering orders, stock, customers and analytics. The interface is Vietnamese; code and documentation are English.

## Quick start

```bash
git clone https://github.com/anvuhoang/ai-snackstream-commerce.git && cd ai-snackstream-commerce
cp .env.example .env              # Windows: copy .env.example .env  (set the two passwords inside)
docker compose up --build
```

| | |
|---|---|
| Shop | <http://localhost:3000> |
| Back office | <http://localhost:3000/admin> (sign in with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`) |
| API docs | <http://localhost:8000/api/docs> |

No Docker? See [Getting started](#getting-started). Nothing external is required to try it: payments, chatbot, live host and e-mail switch on only when you add their keys.

## Contents

[Features](#features) · [Architecture](#architecture) · [Tech stack](#tech-stack) · [Database design](#database-design) · [API](#api) ·
[Project structure](#project-structure) · [Getting started](#getting-started) · [Configuration](#configuration) ·
[Testing](#testing-and-quality) · [Deployment](#deployment) · [Security](#security) · [Contributing](#contributing) · [Documentation](#documentation)

## Features

| Area | What it does |
|---|---|
| **Storefront** | Product catalog with variants, search and categories, server-side cart, checkout, order tracking by order code and phone |
| **Customer accounts** | Register and sign in, e-mail verification, forgot/reset password, change password, profile with delivery address, own order history. Checkout needs an account |
| **Payments** | Cash on delivery and **payOS** (VietQR) with a signed webhook, expiring unpaid orders and exactly-once stock release |
| **Back office** | Products, variants and pictures, categories, orders and their lifecycle, customers (lock/unlock), inventory and stock movements, analytics, role-based access (`admin`, `staff`) |
| **Chatbot** | Gemini assistant that answers from the shop's own data. Retrieval-augmented (RAG): products, approved FAQs and policy files; price and stock are read live. Hand-off to a person, question logs and review |
| **AI live host** | Live page with an avatar host (Simli) speaking a reviewed script (ElevenLabs), answers to viewer questions through Make, one product per session, pinned item with add-to-cart |
| **Inventory** | Own stock ledger with reservations, optional **Odoo** sync, stale-count protection |
| **Analytics** | Funnel from product view to completed order, attribution by source (last touch, 7 days), live and chat metrics, channel imports |

## Architecture

The system is a **modular monolith**: one FastAPI application and one PostgreSQL database, split into modules with clear owners.
Order creation and stock reservation must share one database transaction, so there are no separate services to coordinate.

```mermaid
flowchart LR
    U([Browser]) -->|HTTPS| WEB

    subgraph VERCEL["Web - Vercel"]
        WEB["Next.js 16 · React 19<br/>Store · Account · Admin · Live"]
        PROXY["/api/* proxy<br/>same origin, streams SSE"]
        WEB --- PROXY
    end

    PROXY -->|HTTPS, cookie forwarded| API

    subgraph RENDER["API - Render (Docker)"]
        API["FastAPI<br/>auth · catalog · customers · orders<br/>inventory · analytics · chat · rag · live"]
        DB[("PostgreSQL 17")]
        API --> DB
    end

    API -->|pictures| CLD[("Cloudinary")]
    API -->|chat + embeddings| GEM["Gemini"]
    API -->|verification and reset mail| RES["Resend"]
    API <-->|payment link + signed webhook| PAY["payOS"]
    API -->|stock sync, product read| ODOO["Odoo"]
    API <-->|question webhook + callback| MAKE["Make"]
    MAKE --> ELV["ElevenLabs TTS"]
    API -->|avatar session| SIM["Simli"]
```

**Request flow.** The browser only ever talks to the web app. `/api/*` is proxied to the API (`web/src/app/api/[...path]/route.ts`),
so the signed session cookie is same-origin: no CORS, no exposed API address, and server-sent events stream through. Server components
call the API with the visitor's cookie forwarded.

**Modules** (`api/app/modules/<name>`, each with `models.py`, `schemas.py`, `service.py`, `router.py`):

| Module | Owns |
|---|---|
| `auth` | Back-office login, roles, CSRF |
| `customers` | Customer accounts, e-mail links, admin customer list |
| `catalog` | Categories, products, variants, pictures, demo seed |
| `orders` | Cart, checkout, order lifecycle, payments (COD, payOS) |
| `inventory` | Stock ledger, reservations, Odoo sync |
| `analytics` | Events, attribution, funnel, imports |
| `chat`, `rag` | Chatbot, FAQs, support queue, knowledge-base index and retrieval |
| `live` | Live sessions, SSE stream, host pipeline (Make, Simli, ElevenLabs) |
| `health` | Liveness probe |

Rules: routers stay thin and business logic lives in `service.py`; a module reads another module's data through its service; calls go one
way (`orders → inventory`, never back). More detail, authentication design, scaling notes and decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech stack

| Layer | Technology |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, React Hook Form + Zod, `openapi-fetch` typed client, Lucide icons |
| API | Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2 (sync), Alembic, `httpx`, Uvicorn |
| Database | PostgreSQL 17 (SQLite only for the fast unit-test run) |
| Contract | `api/openapi.json` exported from the API, turned into TypeScript types for the web app |
| AI and media | Google Gemini (chat, embeddings), Simli (avatar), ElevenLabs (text to speech), Make (workflow), Cloudinary (pictures) |
| Integrations | payOS (VietQR payments), Resend (e-mail), Odoo (stock, JSON-RPC) |
| Security | scrypt password hashing, signed `HttpOnly` session cookie, CSRF token on writes, in-process rate limiting, one-time hashed e-mail tokens |
| Tooling | uv, ruff, pytest, ESLint, Docker + Docker Compose, GitHub Actions |
| Hosting | Vercel (web), Render (API + PostgreSQL), Cloudinary (pictures) |

## Database design

25 tables in PostgreSQL, one linear Alembic history. The diagram shows every table and column. Per-module diagrams and the design
notes are in [docs/ERD.md](docs/ERD.md).

```mermaid
erDiagram
    cart ||--o{ cart_item : "contains"
    variant ||--o{ cart_item : "added as"
    import_batch ||--o{ channel_metric : "contains"
    customer ||--o{ customer_token : "receives"
    orders |o--o{ event : "tracked in"
    orders ||--o{ idempotency_key : "created once by"
    admin_user |o--o{ import_batch : "uploads"
    orders ||--o{ order_item : "contains"
    variant ||--o{ order_item : "sold as"
    orders ||--o{ order_status_history : "history"
    admin_user |o--o{ order_status_history : "performs"
    customer |o--o{ orders : "places"
    orders ||--o{ payment : "paid by"
    category |o--o{ product : "groups"
    product ||--o{ product_image : "has pictures"
    variant ||--o{ stock_level : "counted in"
    variant ||--o{ stock_movement : "changes recorded in"
    orders |o--o{ stock_movement : "reserves and releases"
    admin_user |o--o{ stock_movement : "performs"
    product ||--o{ variant : "has variants"
    admin_user {
        int id PK
        string email UK
        string password_hash
        string role
        bool is_active
        datetime created_at
        datetime updated_at
    }
    cart {
        int id PK
        string token UK
        datetime created_at
        datetime updated_at
    }
    cart_item {
        int id PK
        int cart_id FK
        int variant_id FK
        int qty
    }
    category {
        int id PK
        string slug UK
        string name
        int sort_order
        datetime created_at
        datetime updated_at
    }
    channel_metric {
        int id PK
        int batch_id FK
        date day
        string channel
        string content_code
        string metric
        bigint value
        bool is_demo
    }
    chat_faq {
        int id PK
        string question
        text answer
        bool approved
    }
    chat_log {
        int id PK
        string question_id UK
        string conversation_id
        text question
        text answer
        string sku
        text product_skus
        datetime received_at
        datetime answered_at
        int duration_ms
        string outcome
        string error_code
        bool reviewed_correct
        bool card_clicked
    }
    chat_settings {
        int id PK
        bool enabled
        text contact_text
    }
    chat_support {
        int id PK
        string conversation_id UK
        text message
        string state
        datetime created_at
    }
    customer {
        int id PK
        string email UK
        string password_hash
        string full_name
        string phone
        string ship_address
        string ship_ward
        string ship_district
        string ship_province
        bool is_active
        datetime email_verified_at
        datetime created_at
        datetime updated_at
    }
    customer_token {
        int id PK
        int customer_id FK
        string kind
        string token_hash UK
        datetime expires_at
        datetime used_at
        datetime created_at
    }
    event {
        int id PK
        string event_id UK
        string name
        string session_id
        datetime occurred_at
        bool is_demo
        string sku
        string source
        string campaign
        string content_code
        string surface
        int qty
        int cart_value_vnd
        int order_id FK
        string live_id
        string conversation_id
    }
    idempotency_key {
        int id PK
        string key UK
        string request_hash
        int order_id FK
        datetime created_at
    }
    import_batch {
        int id PK
        string kind
        string filename
        string sha256 UK
        bool is_demo
        int rows_total
        int values_imported
        int values_skipped
        int created_by FK
        datetime created_at
    }
    kb_chunk {
        int id PK
        string source_type
        string source_key
        string kind
        string sku
        string title
        text text
        string content_hash
        string embedder
        int dim
        text embedding
        datetime updated_at
    }
    order_item {
        int id PK
        int order_id FK
        int variant_id FK
        string sku
        string product_name
        string variant_name
        int unit_price_vnd
        int qty
        int line_total_vnd
    }
    order_status_history {
        int id PK
        int order_id FK
        string from_status
        string to_status
        int actor_id FK
        string note
        datetime created_at
    }
    orders {
        int id PK
        string code UK
        int customer_id FK
        string status
        string customer_name
        string customer_phone
        string ship_address
        string ship_ward
        string ship_district
        string ship_province
        string note
        int subtotal_vnd
        int shipping_fee_vnd
        int total_vnd
        string payment_method
        datetime expires_at
        string session_id
        string utm_source
        string utm_campaign
        string utm_content
        bool is_demo
        datetime created_at
        datetime updated_at
    }
    payment {
        int id PK
        int order_id FK
        string provider
        string status
        int amount_vnd
        string provider_ref
        text last_payload
        datetime paid_at
        datetime created_at
        datetime updated_at
    }
    product {
        int id PK
        string slug UK
        string name
        text description
        text ingredients
        text storage
        text allergens
        string spice_level
        text nutrition
        bool ingredients_verified
        string status
        int category_id FK
        string shopee_url
        bool is_demo
        text search_text
        datetime created_at
        datetime updated_at
    }
    product_image {
        int id PK
        int product_id FK
        string storage_key
        string alt
        int sort_order
        datetime created_at
        datetime updated_at
    }
    stock_level {
        int variant_id PK,FK
        int on_hand
        int reserved
        string source
        datetime synced_at
        datetime updated_at
    }
    stock_movement {
        int id PK
        int variant_id FK
        string kind
        int delta_on_hand
        int delta_reserved
        int order_id FK
        int actor_id FK
        string note
        datetime created_at
    }
    stock_sync_run {
        int id PK
        datetime started_at
        datetime finished_at
        bool ok
        int matched
        int changed
        text missing_skus
        string error
    }
    variant {
        int id PK
        int product_id FK
        string sku UK
        string name
        int price_vnd
        int compare_at_vnd
        int weight_g
        bool is_active
        int sort_order
        datetime created_at
        datetime updated_at
    }
```

Money is integer VND, order items snapshot the price at purchase, stock is a ledger (`stock_level` plus `stock_movement`), and a missing value
is `NULL` plus a status, never `0`.

## API

REST over JSON (camelCase fields, errors as `{"error": {"code", "message"}}`). **107 documented endpoints**, described by the committed
contract [`api/openapi.json`](api/openapi.json) and browsable as Swagger UI at `/api/docs` when the API runs. The full list with the purpose of
each endpoint is in [docs/API.md](docs/API.md).

| Area | Base path | Endpoints | Access |
|---|---|---|---|
| Catalog | `/api/catalog` | 3 | public |
| Cart, checkout, orders | `/api/cart`, `/api/orders`, `/api/shop`, `/api/account/orders` | 11 | public cart; checkout needs a customer account |
| Customer accounts | `/api/account` | 10 | register, sign-in and e-mail links public; the rest need a customer session |
| Chatbot | `/api/chat` | 4 | public, rate limited |
| AI live host (viewer side) | `/api/live` | 11 | public; Make callbacks need a shared token |
| Analytics events | `/api/events` | 1 | public |
| Back office: sign-in | `/api/admin/auth` | 3 | staff |
| Back office: catalog, orders, customers, inventory | `/api/admin/catalog`, `/orders`, `/customers`, `/inventory` | 24 | `admin` or `staff` read; writes `admin` + CSRF |
| Back office: analytics, chatbot, live host | `/api/admin/analytics`, `/chat`, `/live` | 38 | back-office session |
| Probes | `/api/healthz`, `/api/readyz` | 2 | public |

Writes use a signed session cookie plus an `X-CSRF-Token` header. Example:

```bash
curl http://localhost:8000/api/catalog/products?q=banh
curl -c jar -H "Content-Type: application/json" -d '{"email":"admin@example.com","password":"change-this-password"}' http://localhost:8000/api/admin/auth/login
```

## Project structure

```
api/                     FastAPI application
  app/core/              settings, database, security, mail, storage, logging, errors
  app/modules/<name>/    one package per module (see Architecture)
  alembic/versions/      database migrations (one linear history)
  tests/                 pytest suite (SQLite by default, PostgreSQL for `-m postgres`)
  openapi.json           API contract, regenerated and committed with every API change
web/                     Next.js application
  src/app/(home)         landing page          src/app/(store)   shop, checkout, account
  src/app/(auth)         login and register    src/app/(admin)   back office
  src/app/(live)         live page             src/app/api       same-origin proxy to the API
  src/components/        UI components         src/lib/          API client, formatting, error texts
docs/                    architecture, ERD, deployment, live and chatbot guides, roadmap
docker-compose.yml       db + api + web for local use
render.yaml              Render blueprint (API + PostgreSQL)
.github/workflows/       CI: lint, tests, migrations on PostgreSQL, contract checks, web build
```

## Getting started

### Prerequisites

Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node.js 22+, and optionally Docker Desktop for PostgreSQL or the all-in-one run.

### Option A: run with Docker (PostgreSQL included)

```bash
cp .env.example .env            # Windows: copy .env.example .env
# edit .env: set POSTGRES_PASSWORD and BOOTSTRAP_ADMIN_PASSWORD
docker compose up --build
```

Web: <http://localhost:3000> · back office: <http://localhost:3000/admin> · API docs: <http://localhost:8000/api/docs>

### Option B: run the API and web separately

```bash
# API (http://localhost:8000). Without DATABASE_URL it uses a local SQLite file, fine for a first try.
cd api
cp .env.example .env            # Windows: copy .env.example .env
uv sync
uv run uvicorn app.main:app --reload

# Web (http://localhost:3000), in a second terminal
cd web
npm install
npm run dev
```

On the first start the API applies migrations and creates the admin from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`.
Sign in at `/admin`. To use PostgreSQL instead of SQLite, start only the database (`docker compose up db`) and set `DATABASE_URL`
in `api/.env` (see the commented example in the file).

### Demo data

```bash
cd api
uv run python -m app.cli seed-catalog      # 30 labelled demo SKUs with pictures; safe to repeat
```

or set `SEED_DEMO_CATALOG=1`. Every demo row is flagged `is_demo`.

### Command line

```bash
uv run python -m app.cli migrate                      # apply migrations
uv run python -m app.cli create-admin you@example.com # create a back-office user
uv run python -m app.cli seed-catalog                 # demo catalog
uv run python -m app.cli reindex-kb                   # rebuild the chatbot's searchable passages
uv run python -m app.cli eval-rag                     # measure retrieval quality
uv run python -m app.cli sync-odoo                    # copy stock counts from Odoo
uv run python -m app.cli expire-orders                # cancel unpaid online orders whose time ran out
```

## Configuration

All settings are environment variables, documented line by line in the example files. Nothing is required to start locally.

| File | Used for |
|---|---|
| [`api/.env.example`](api/.env.example) | Running the API without Docker. Complete reference of every variable |
| [`.env.example`](.env.example) | Docker Compose (`db` + `api` + `web`) |
| `web` | One variable: `API_URL`, the address of the API (default `http://localhost:8000`; `http://api:8000` in Compose) |

| Group | Key variables | If left empty |
|---|---|---|
| Core | `APP_ENV`, `SECRET_KEY`, `DATABASE_URL` | SQLite file; production refuses a default `SECRET_KEY` |
| Admin | `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | no admin is created |
| Pictures | `CLOUDINARY_URL` | pictures saved to a local folder (lost on hosts with a temporary disk) |
| E-mail | `RESEND_API_KEY`, `MAIL_FROM`, `WEB_BASE_URL`, `REQUIRE_EMAIL_VERIFICATION` | links are only written to the log |
| Payments | `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL` | payOS off, cash on delivery stays |
| Shipping | `SHIPPING_FEE_VND`, `FREE_SHIP_FROM_VND`, `ORDER_EXPIRY_MINUTES` | 30,000 VND, free from 300,000 VND, 15 minutes |
| Stock | `ODOO_URL`, `ODOO_DB`, `ODOO_API_KEY`, `ODOO_LOGIN` | stock kept only in our own tables |
| Chatbot | `GEMINI_API_KEY`, `CHAT_ALL_SALE_PRODUCTS`, `CHAT_RAG_ENABLED`, `RAG_EMBEDDER` | chatbot unavailable |
| Live host | `LIVE_MAKE_*`, `LIVE_SIMLI_*`, `LIVE_CONTENT_ENABLED`, `ELEVENLABS_*` | live runs in mock mode or stays off |

Secrets belong in a private `.env` (ignored by Git) or the hosting dashboard, never in the repository.

## Testing and quality

```bash
cd api
uv run pytest                                   # fast suite on SQLite
POSTGRES_TEST_URL=postgresql+psycopg://snack:snack@localhost:5432/snackstream_test uv run pytest -m postgres
uv run ruff check . && uv run ruff format --check .

cd web
npm run typecheck && npm run lint && npm run build
```

Your own `api/.env` may hold real keys. Tests build their settings explicitly and must never use them, but if a live or mail test
behaves oddly, run it with the live and mail variables set to `false` or empty.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on every pull request: lint and format, the SQLite suite, the PostgreSQL
suite, migrations on PostgreSQL, a check that `openapi.json` and the generated web types are current, then type check, lint and build for the web app.

## Deployment

Web on **Vercel**, API and PostgreSQL on **Render** (`render.yaml` blueprint, migrations and demo seed run at start-up because the free
tier has no shell), pictures on **Cloudinary**. Step-by-step guide with every variable: [docs/DEPLOY.md](docs/DEPLOY.md).

Point both Render ("Branch") and Vercel ("Production Branch") at the same branch, normally `main`, so the live demo changes only when
the team merges there. Note that Render's free tier sleeps after inactivity, so the first request can take about a minute.

## Security

- Passwords use scrypt with a per-user salt and are rehashed on sign-in when the cost is raised. Login, register, password-reset and e-mail
  endpoints are rate limited.
- Sessions are signed, `HttpOnly`, `SameSite=Lax` cookies (`Secure` in production) rotated at sign-in; every write sends an `X-CSRF-Token`.
- E-mail verification and reset links are single-use, expire (24 h / 1 h) and are stored only as SHA-256 hashes. "Forgot password" answers the same for every address.
- payOS webhooks are accepted only with a valid checksum signature. Stock is reserved and released inside database transactions.
- Staff roles limit what each account can do; an admin can lock a customer account and it stops working immediately, even in an open session.
- Secrets live in environment variables. Provider keys for the chatbot and live host are server-side only and never use `NEXT_PUBLIC_`.

## Contributing

Pull requests are welcome. Branching, commit style, migrations, the API contract and the pull request checklist are in
[CONTRIBUTING.md](CONTRIBUTING.md). In short: branch from `dev`, keep CI green, regenerate `openapi.json` when the API changes, add a
migration and update [docs/ERD.md](docs/ERD.md) when a model changes, and never commit secrets.

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module rules, authentication, data rules, scaling notes, decisions, contracts between modules |
| [docs/ERD.md](docs/ERD.md) | Database diagrams per module, every column, design notes |
| [docs/API.md](docs/API.md) | Every endpoint grouped by area, with access rules |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Render, Vercel, Cloudinary, payOS, e-mail, live: step by step |
| [docs/LIVE_SIMLI_HOST.md](docs/LIVE_SIMLI_HOST.md) | AI live host setup, mock and real modes |
| [docs/LIVE_MAKE_PLAYBACK.md](docs/LIVE_MAKE_PLAYBACK.md) | Make webhook and callback contract |
| [docs/LIVE_PRODUCT_CONTENT.md](docs/LIVE_PRODUCT_CONTENT.md) | Product facts and scripts for the live host |
| [docs/CHAT_INTEGRATION.md](docs/CHAT_INTEGRATION.md) | How the chatbot is wired into the shop |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and open decisions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow, conventions, pull request checklist |
