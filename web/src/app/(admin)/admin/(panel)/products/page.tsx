import { Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminOnly } from "@/components/admin/admin-only";
import { Pagination } from "@/components/store/pagination";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { serverApi } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { query, STATUS_LABEL, type ProductStatus } from "@/lib/catalog";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Sản phẩm · Quản trị" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const STATUSES: ProductStatus[] = ["draft", "published", "hidden"];
const TONE = { draft: "neutral", published: "ok", hidden: "warn" } as const;
type Search = { q?: string; status?: string; page?: string };

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const status = STATUSES.find((s) => s === sp.status);
  const page = Math.min(10_000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));

  const api = await serverApi();
  const { data } = await api.GET("/api/admin/catalog/products", { params: { query: { q, status, page, pageSize: PAGE_SIZE } } });
  if (!data) throw new Error("Could not load products");

  const href = (over: Partial<{ status: string; page: number }>) => `/admin/products${query({ q, status, page: undefined, ...over })}`;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Sản phẩm</h1>
          <p className="text-muted">{data.total} sản phẩm</p>
        </div>
        <AdminOnly>
          <Link href="/admin/products/new" className={buttonClass()}>
            <Plus className="size-4" /> Thêm sản phẩm
          </Link>
        </AdminOnly>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Lọc theo trạng thái">
          {[undefined, ...STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={href({ status: s ?? "" })}
              aria-current={status === s ? "true" : undefined}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-medium",
                status === s ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-muted hover:border-muted",
              )}
            >
              {s ? STATUS_LABEL[s] : "Tất cả"}
            </Link>
          ))}
        </div>
        <form action="/admin/products" role="search" className="flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Tìm theo tên, SKU…"
              aria-label="Tìm sản phẩm"
              className="h-10 w-64 rounded-lg border border-line bg-surface pl-9 pr-3 text-sm focus:border-brand"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-10">
            Tìm
          </Button>
        </form>
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line p-12 text-center text-muted">
          {q || status ? "Không có sản phẩm khớp bộ lọc." : "Chưa có sản phẩm nào. Hãy thêm sản phẩm đầu tiên."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Sản phẩm</th>
                <th className="px-4 py-3 font-semibold">Danh mục</th>
                <th className="px-4 py-3 font-semibold">Trạng thái</th>
                <th className="px-4 py-3 text-right font-semibold">Quy cách</th>
                <th className="px-4 py-3 font-semibold">Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <Link href={`/admin/products/${p.id}`} className="font-semibold hover:text-brand hover:underline">
                      {p.name}
                    </Link>
                    {p.isDemo && (
                      <Badge tone="warn" className="ml-2">
                        Demo
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{p.categoryName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.variantCount}</td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(p.updatedAt)}</td>
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
