# Staging deploy

Staging gives the team one shared URL and, from P2, a public HTTPS address for payment callbacks.
Web runs on Vercel, the API and PostgreSQL on Render (decision D6).

## 1. API and database (Render)

1. Render → **New → Blueprint** → pick this repository and the `dev` branch. It reads `render.yaml`.
2. When asked, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (12+ characters). They create the first
   admin on the first start only; remove them afterwards if you like.
3. Wait for the deploy, then open `https://<service>.onrender.com/api/healthz`. It should answer `{"status":"ok"}`.

The blueprint migrates and seeds the demo catalog at start-up because the free tier has no shell. The seed is
idempotent and every demo row is labelled `is_demo`.

## 2. Web (Vercel)

1. Vercel → **Add New → Project** → this repository, **Root Directory** `web`.
2. Environment variable `API_URL` = the Render URL from step 1 (no trailing slash).
3. Deploy. The web app proxies `/api/*` to the API, so the admin session cookie stays same-origin.

## Limits to know about

- **Free tier sleeps.** Render's free web service stops after a period of inactivity, so the first request is slow.
  Free PostgreSQL instances are also time-limited. Check Render's current plan terms before a demo.
- **Uploads are not durable.** Product photos are stored on the API's local disk, which is wiped on every deploy and
  restart. Re-upload them after a deploy, or move to object storage (the `MediaStorage` interface in
  `api/app/core/storage.py` is the seam for that).
- **Live (SSE) in P6** must reach the API directly or be hosted on Render, because Vercel functions cap stream length.
