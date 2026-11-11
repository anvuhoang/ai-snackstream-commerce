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

## 3. Optional: online payment, Odoo and background jobs

These are all set as environment variables of the Render API service (the blueprint lists them with `sync: false`).

| Feature | Variables | Notes |
|---|---|---|
| **VNPay sandbox** | `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` | Register a test merchant at sandbox.vnpayment.vn. `VNPAY_RETURN_URL` is the **web** address plus `/checkout/result`. In the merchant page set the IPN URL to `https://<api>.onrender.com/api/payments/vnpay/ipn`. Empty = cash on delivery only. |
| **Odoo stock** | `ODOO_URL`, `ODOO_DB`, `ODOO_API_KEY` | A key made in Odoo (My Profile → Account Security → New API Key). Never commit it. Then press "Đồng bộ ngay" in `/admin/inventory`, or schedule `python -m app.cli sync-odoo`. |
| **Stale stock rule** | `STOCK_STALE_MINUTES` | A count copied from Odoo that is older than this shows "contact the shop" and cannot be added to a cart. `0` (default) = never expire. Set it only when `sync-odoo` runs on a schedule. |
| **Background jobs** | see the commented blocks in `render.yaml` | `expire-orders` every minute and `sync-odoo` every 10 minutes. Render cron needs a paid plan. Without them an unpaid order still expires the next time it is read. |

After the first deploy, open the web app and place one cash-on-delivery order, then one VNPay order, before a demo.

## Limits to know about

- **Free tier sleeps.** Render's free web service stops after a period of inactivity, so the first request is slow.
  Free PostgreSQL instances are also time-limited. Check Render's current plan terms before a demo.
- **Uploads are not durable.** Product photos are stored on the API's local disk, which is wiped on every deploy and
  restart. Re-upload them after a deploy, or move to object storage (the `MediaStorage` interface in
  `api/app/core/storage.py` is the seam for that).
- **Live (SSE) in P6** must reach the API directly or be hosted on Render, because Vercel functions cap stream length.
