# apps/web

The SnackStream Analytics UI: Next.js (App Router) + TypeScript + Tailwind + Recharts. The interface text is in Vietnamese.

- Dashboard pages are server components that call the API through `src/lib/api.ts` (which forwards the raw `cookie` header).
- `src/app/api/[...path]/route.ts` proxies every `/api/*` request to FastAPI (`API_URL`).
- Shared building blocks: `src/components/ui.tsx` (rendering of metrics and missing data), `Kpi`, `ChartCard`, `FunnelView`, `FilterBar`.
- API types: `src/lib/types.ts`. Display labels: `src/lib/labels.ts` (mirrors `apps/api/app/config.py`).

```
npm install
npm run dev      # http://localhost:3000 (needs the API running at API_URL)
npm run build
```
