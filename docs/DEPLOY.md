# Deploy

One shared URL for the team and a public HTTPS address for payment and live callbacks.
Web runs on Vercel, the API and PostgreSQL on Render (decision D6), product pictures on Cloudinary.

**Which branch deploys.** Render and Vercel deploy whatever branch they watch, and redeploy on every merge into it. Point both at the same
branch (normally `main`): Render → *Settings → Build & Deploy → Branch*, Vercel → *Settings → Git → Production Branch*. Other branches only
get a Vercel preview. Changing an environment variable on Render also triggers a redeploy.

## 1. API and database (Render)

1. Render → **New → Blueprint** → pick this repository and the branch to deploy (normally `main`). It reads `render.yaml`.
2. When asked, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (12+ characters). They create the first
   admin on the first start only; remove them afterwards if you like.
3. Wait for the deploy, then open `https://<service>.onrender.com/api/healthz`. It should answer `{"status":"ok"}`.

The blueprint migrates and seeds the demo catalog at start-up because the free tier has no shell. The seed is
idempotent and every demo row is labelled `is_demo`.

## 2. Web (Vercel)

1. Vercel → **Add New → Project** → this repository, **Root Directory** `web`.
2. Environment variable `API_URL` = the Render URL from step 1 (no trailing slash).
3. Deploy and copy the web address (`https://<project>.vercel.app`).
4. Back on Render, set `WEB_BASE_URL` to that address (no trailing slash) so links in e-mails point to the site. The web app proxies
   `/api/*` to the API, so the session cookie stays same-origin and no CORS setting is needed.

## 3. Optional features

These are all set as environment variables of the Render API service (the blueprint lists them with `sync: false`).

| Feature | Variables | Notes |
|---|---|---|
| **payOS** | `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL` | Real money. The three keys are on the payment channel at my.payos.vn. `PAYOS_RETURN_URL` is the **web** address plus `/checkout/result`, `PAYOS_CANCEL_URL` the web address plus `/checkout`. On my.payos.vn set the webhook to `https://<api>.onrender.com/api/payments/payos/webhook`. Empty = payOS is off. |
| **Pictures** | `CLOUDINARY_URL` | `cloudinary://<api_key>:<api_secret>@<cloud_name>` from the Cloudinary dashboard (*API Keys → API Environment variable*). Without it pictures sit on the API's temporary disk and disappear on every restart. The demo catalog pictures are uploaded automatically at start-up. |
| **E-mail** | `RESEND_API_KEY`, `MAIL_FROM`, `WEB_BASE_URL`, `REQUIRE_EMAIL_VERIFICATION` | Without a verified domain Resend delivers only to your own account address, so for a demo set `REQUIRE_EMAIL_VERIFICATION=false` and customers can still check out. |
| **Shipping** | `SHIPPING_FEE_VND`, `FREE_SHIP_FROM_VND` | Defaults are 30,000 VND and free from 300,000 VND. Set them if the shop uses other numbers. |
| **Chatbot** | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FREE_TIER_CONFIRMED`, `CHAT_ALL_SALE_PRODUCTS`, `CHAT_RAG_ENABLED`, `RAG_EMBEDDER` | With `CHAT_RAG_ENABLED=true` and `RAG_EMBEDDER=hash` the bot answers from the API's own database and needs no Odoo. The search index is built at start-up and refreshed when a product, category or FAQ is saved in the back office. Without RAG the bot reads products from Odoo and also needs `ODOO_LOGIN`. |
| **AI live host** | `LIVE_MAKE_*`, `LIVE_SIMLI_*`, `LIVE_CONTENT_ENABLED`, `ELEVENLABS_*` | Copy the values from your private `api/.env`. In the Make scenario set the two callbacks to `https://<api>.onrender.com/api/live/make-answer` and `/make-result` with the same callback token. Live keeps session state in memory, so run one instance. The Docker image already includes `ffprobe`. |
| **Odoo stock** | `ODOO_URL`, `ODOO_DB`, `ODOO_API_KEY` | A key made in Odoo (My Profile → Account Security → New API Key). Never commit it. Then press "Đồng bộ ngay" in `/admin/inventory`, or schedule `python -m app.cli sync-odoo`. |
| **Stale stock rule** | `STOCK_STALE_MINUTES` | A count copied from Odoo that is older than this shows "contact the shop" and cannot be added to a cart. `0` (default) = never expire. Set it only when `sync-odoo` runs on a schedule. |
| **Background jobs** | see the commented blocks in `render.yaml` | `expire-orders` every minute and `sync-odoo` every 10 minutes. Render cron needs a paid plan. Without them an unpaid order still expires the next time it is read. |

## 4. Check it

1. `https://<api>.onrender.com/api/healthz` answers.
2. The web app lists products with pictures.
3. Register, sign in, add to cart and place one cash-on-delivery order; it appears in `/admin`.
4. Upload a picture on a product in `/admin`; it shows on the shop.
5. Ask the chatbot about a product.
6. If payOS is on, place one small order and pay it (real money), then check the order turns paid.

The database on Render is new and empty apart from the demo seed: accounts made on your laptop do not exist there. Register again, and sign in
to `/admin` with the `BOOTSTRAP_ADMIN_*` values.

## Limits to know about

- **Free tier sleeps.** Render's free web service stops after a period of inactivity, so the first request is slow.
  Free PostgreSQL instances are also time-limited. Check Render's current plan terms before a demo.
- **Pictures need Cloudinary to last.** Without `CLOUDINARY_URL` they are written to the API's local disk, which is wiped on every deploy and
  restart. The `MediaStorage` interface in `api/app/core/storage.py` is the seam if you want a different object store.
- **Live (SSE)** must reach the API directly or be hosted on Render, because Vercel functions cap stream length. It also keeps state in memory, so run one API instance.
