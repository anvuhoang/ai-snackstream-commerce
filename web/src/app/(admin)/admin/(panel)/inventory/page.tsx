import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StockAdjust } from "@/components/admin/stock-adjust";
import { StockSync } from "@/components/admin/stock-sync";
import { Pagination } from "@/components/store/pagination";
import { ProductImage } from "@/components/store/product-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { serverApi } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { query } from "@/lib/catalog";
import { formatDateTime } from "@/lib/format";
import { SOURCE_LABEL, STOCK_STATES, type StockState } from "@/lib/inventory";

export const metadata: Metadata = { title: "Kho · Quản trị" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
type Search = { q?: string; state?: string; page?: string };

export default async function AdminInventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const state: StockState | undefined = STOCK_STATES.find((s) => s.value && s.value === sp.state)?.value;
  const page = Math.min(10_000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));

  const api = await serverApi();
  const [{ data }, { data: sync }] = await Promise.all([
    api.GET("/api/admin/inventory", { params: { query: { q, state, page, pageSize: PAGE_SIZE } } }),
    api.GET("/api/admin/inventory/sync"),
  ]);
  if (!data || !sync) throw new Error("Could not load the stock");

  const href = (over: Partial<{ state: string; page: number }>) => `/admin/inventory${query({ q, state, page: undefined, ...over })}`;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[clamp(34px,4vw,56px)] font-extrabold leading-[1.05] tracking-[-0.04em]">Kho</h1>
        <p className="mt-2 text-xs text-muted">
          {data.total} biến thể · “Còn bán” = tồn kho trừ số đang giữ cho đơn chưa giao. Biến thể chưa theo dõi được bán không giới hạn.
        </p>
      </div>

      <StockSync status={sync} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Lọc theo tình trạng">
          {STOCK_STATES.map((s) => (
            <Link
              key={s.value ?? "all"}
              href={href({ state: s.value ?? "" })}
              aria-current={state === s.value ? "true" : undefined}
              className={cn(
                "inline-flex h-10 items-center rounded-full border-2 px-4 text-sm font-semibold transition-colors",
                state === s.value ? "border-accent bg-accent text-white" : "border-ink hover:bg-canvas",
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <form action="/admin/inventory" role="search" className="flex gap-2">
          {state && <input type="hidden" name="state" value={state} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              name="q"
              defaultValue={q}
              placeholder="SKU hoặc tên sản phẩm…"
              aria-label="Tìm trong kho"
              className="h-10 w-72 rounded-xl border-2 border-line bg-surface pl-9 pr-3 text-sm focus:bg-canvas focus:outline-none"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-10">
            Tìm
          </Button>
        </form>
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-[20px] border-2 border-dashed border-line p-12 text-center text-sm text-muted">Không có biến thể nào khớp bộ lọc.</p>
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-line bg-surface">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.04em] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Sản phẩm</th>
                <th className="px-4 py-3 font-medium">Nguồn</th>
                <th className="px-4 py-3 text-right font-medium">Tồn kho</th>
                <th className="px-4 py-3 text-right font-medium">Đang giữ</th>
                <th className="px-4 py-3 text-right font-medium">Còn bán</th>
                <th className="px-4 py-3 font-medium">Cập nhật</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.variantId} className="border-b border-hair align-top last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/admin/inventory/${r.variantId}`} className="hover:underline">
                      {r.sku}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ProductImage image={r.image} name={r.productName} className="size-12 shrink-0" sizes="48px" />
                      <span>
                        {r.productName}
                        <span className="block text-xs text-muted">{r.variantName}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{r.source ? SOURCE_LABEL[r.source] : <span className="text-muted">Chưa theo dõi</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.tracked ? r.onHand : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.tracked ? r.reserved : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.tracked ? (
                      <Badge tone={r.available <= 0 ? "danger" : r.available <= data.lowStockAt ? "warn" : "ok"}>{r.available}</Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{r.updatedAt ? formatDateTime(r.updatedAt) : "—"}</td>
                  <td className="px-4 py-3">
                    <StockAdjust variantId={r.variantId} source={r.source ?? null} onHand={r.onHand} reserved={r.reserved} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} hrefFor={(n) => href({ page: n })} />
    </div>
  );
}
