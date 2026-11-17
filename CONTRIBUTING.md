# Contributing

How we work on SnackStream. Setup and commands are in the [README](README.md); design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **Branches and commits.** `dev` is the default branch where work is integrated; `main` holds stable, demo-ready code. Both must stay
  green. Branch from `dev` as `feat/<module>-<what>`, open a pull request **into `dev`** (squash merge), get one review. To release,
  open a pull request `dev` → `main` and merge it with a **merge commit, not squash** (squashing makes the two branches drift apart),
  then tag it (`v0.1.0`). Urgent fix on `main`: branch from `main`, merge into `main`, then merge `main` back into `dev`.
  Commits are imperative with a type prefix: `feat(catalog): add product list`, `fix(orders): release stock once`.
- **Migrations have one owner.** Alembic needs one linear history; two people creating migrations from the same parent produce
  two heads and break deploys. Describe the table or column in your PR and the schema owner adds the migration. Never edit a migration that is already
  on `dev` or `main`. Autogenerate is a draft: a rename looks like "drop + add" and would lose data, so read the file.
  `cd api; uv run alembic revision --autogenerate -m "add product tables" --rev-id 0002`
- **After changing a router or schema, regenerate the contract** and commit both files (CI fails if they are stale):
  `cd api; uv run python -m app.export_openapi openapi.json` then `cd web; npm run gen:types`.
- **Adding an endpoint.** Pydantic schemas with a `response_model`; logic in `service.py` (the router only parses and returns);
  expected failures are `raise AppError(status, "stable_code", "English message")` and the Vietnamese text goes in
  `web/src/lib/errors.ts`; admin routes use `require_role(...)` and, for writes, `require_csrf`; test the happy path, an auth failure
  and a validation failure.
- **Pull request checklist.** Tests added; model change has a migration and an updated [docs/ERD.md](docs/ERD.md); contract regenerated;
  loading / empty / error / out-of-stock states and phone width checked; no secrets, no real customer data, no `.env`.
- **Earlier prototype.** The first dashboard (Shopee-era) is kept on branch `legacy-dashboard` for reference.
