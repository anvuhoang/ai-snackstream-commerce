import { Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminOnly } from "@/components/admin/admin-only";
import { Pagination } from "@/components/store/pagination";
import { ProductImage } from "@/components/store/product-image";
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
          <h1 className="text-[clamp(34px,4vw,56px)] font-extrabold leading-[1.05] tracking-[-0.04em]">Sản phẩm</h1>
          <p className="mt-2 text-xs text-muted">{data.total} sản phẩm</p>
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
                "inline-flex h-10 items-center rounded-full border-2 px-4 text-sm font-semibold transition-colors",
                status === s ? "border-accent bg-accent text-white" : "border-ink hover:bg-canvas",
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
              className="h-10 w-64 rounded-xl border-2 border-line bg-surface pl-9 pr-3 text-sm focus:bg-canvas focus:outline-none"
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
        <div className="overflow-x-auto rounded-[20px] border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.04em] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Sản phẩm</th>
                <th className="px-4 py-3 font-medium">Danh mục</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 text-right font-medium">Quy cách</th>
                <th className="px-4 py-3 font-medium">Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-b border-hair last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ProductImage image={p.image} name={p.name} className="size-12 shrink-0" sizes="48px" />
                      <span>
                        <Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        {p.isDemo && (
                          <Badge tone="warn" className="ml-2">
                            Demo
                          </Badge>
                        )}
                      </span>
                    </div>
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
