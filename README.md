# SnackStream

An online shop for Vietnamese street snacks, with an admin back office, a chatbot, an AI live host and an analytics dashboard.
The interface is Vietnamese; code and documentation are English.

**Status:** Phase 0 (foundation) is done. See [docs/ROADMAP.md](docs/ROADMAP.md) for the phases, owners and open decisions, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit and what the modules must agree on.

## Stack

| | |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4 |
| API | FastAPI (modular monolith), SQLAlchemy 2, Alembic, Pydantic 2 |
| Database | PostgreSQL 17 (SQLite only for the fast unit-test run) |
| Contract | `api/openapi.json` exported from the API, turned into TypeScript types (`openapi-fetch`) |
| Tooling | uv, ruff, pytest, ESLint, Docker Compose, GitHub Actions |
| Planned | Redis (rate limit, live fan-out), Odoo (stock, JSON-RPC), object storage, Caddy (HTTPS) |

## Layout

```
api/                 FastAPI app: app/core, app/modules/<module>, alembic/, tests/, openapi.json
web/                 Next.js app: (store) shop, (admin) back office, (live) live page
docs/                ROADMAP.md, ARCHITECTURE.md
docker-compose.yml   db + api + web
```

## Run it

Needs Python 3.12+, [uv](https://docs.astral.sh/uv/) and Node 22+.

```powershell
# API -> http://localhost:8000   (a local SQLite file is used when DATABASE_URL is empty)
cd api
copy .env.example .env          # BOOTSTRAP_ADMIN_* creates the first admin
uv sync
uv run uvicorn app.main:app --reload

# Web -> http://localhost:3000   (shop)   and   /admin   (back office)
cd web
npm install
npm run dev
```

With Docker (includes PostgreSQL): `copy .env.example .env`, set `POSTGRES_PASSWORD`, then `docker compose up --build`.

Create an admin without the bootstrap variables: `uv run python -m app.cli create-admin you@example.com`.

## Check it

```powershell
cd api; uv run pytest; uv run ruff check .; uv run ruff format --check .
cd web; npm run typecheck; npm run lint; npm run build
```

## Working together

- **Branches and commits.** `dev` is the default branch where work is integrated; `main` holds stable, demo-ready code. Both must stay
  green. Branch from `dev` as `feat/<module>-<what>`, open a pull request **into `dev`** (squash merge), get one review. To release,
  open a pull request `dev` → `main` and merge it with a **merge commit, not squash** (squashing makes the two branches drift apart),
  then tag it (`v0.1.0`). Urgent fix on `main`: branch from `main`, merge into `main`, then merge `main` back into `dev`.
  Commits are imperative with a type prefix: `feat(catalog): add product list`, `fix(orders): release stock once`.
- **Migrations have one owner (An).** Alembic needs one linear history; two people creating migrations from the same parent produce
  two heads and break deploys. Describe the table or column in your PR and An adds the migration. Never edit a migration that is already
  on `dev` or `main`. Autogenerate is a draft: a rename looks like "drop + add" and would lose data, so read the file.
  `cd api; uv run alembic revision --autogenerate -m "add product tables" --rev-id 0002`
- **After changing a router or schema, regenerate the contract** and commit both files (CI fails if they are stale):
  `cd api; uv run python -m app.export_openapi openapi.json` then `cd web; npm run gen:types`.
- **Adding an endpoint.** Pydantic schemas with a `response_model`; logic in `service.py` (the router only parses and returns);
  expected failures are `raise AppError(status, "stable_code", "English message")` and the Vietnamese text goes in
  `web/src/lib/errors.ts`; admin routes use `require_role(...)` and, for writes, `require_csrf`; test the happy path, an auth failure
  and a validation failure.
- **Pull request checklist.** Tests added; model change has a migration; contract regenerated; loading / empty / error / out-of-stock
  states and phone width checked; no secrets, no real customer data, no `.env`.
- **Earlier prototype.** The first dashboard (Shopee-era) is kept on branch `legacy-dashboard` for reference.


## Chatbot tích hợp

Chatbot dùng chung backend `api/` và frontend `web/`, như các module sẵn có.
Không cần web chat riêng, iframe hoặc cổng 3001/8001.

Terminal backend từ thư mục gốc repository:
```powershell
cd api
.\.venv312\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Terminal frontend:
```powershell
cd web
npm.cmd run dev -- --webpack
```

Web: http://127.0.0.1:3000 — bấm nút chat ở góc phải.
Quản trị chatbot: http://127.0.0.1:3000/admin/chat
FAQ và hỗ trợ: http://127.0.0.1:3000/admin/chat/manage

Máy mới cần Python 3.12+, cài dependency trong `api/` (`uv sync` hoặc môi trường
Python tương đương) và `npm ci` trong `web/`. Copy `api/.env.example` thành `.env`
và điền Odoo/Gemini. Không đưa key, database và môi trường Python lên Git.
