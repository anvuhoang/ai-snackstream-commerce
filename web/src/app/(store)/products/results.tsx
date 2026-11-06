import Link from "next/link";
import { Pagination } from "@/components/store/pagination";
import { ProductCard } from "@/components/store/product-card";
import { serverApi } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { query, SORTS, type SortKey } from "@/lib/catalog";

export const PAGE_SIZE = 12;

export type Filters = { q: string; category: string; sort: SortKey; page: number };

/** Categories, sort links, result count, the grid and paging. Async, so the page can stream it behind a skeleton. */
export async function Results({ q, category, sort, page }: Filters) {
  const api = await serverApi();
  const [list, cats] = await Promise.all([
    api.GET("/api/catalog/products", { params: { query: { q, category, sort, page, pageSize: PAGE_SIZE } } }),
    api.GET("/api/catalog/categories"),
  ]);
  if (!list.data || !cats.data) throw new Error("Could not load the catalog");

  const { items, total } = list.data;
  const href = (over: Partial<{ category: string; sort: string; page: number }>) =>
    `/products${query({ q, category, sort: sort === "newest" ? undefined : sort, page: undefined, ...over })}`;
  const filtered = Boolean(q || category);

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Danh mục">
          <Chip href={href({ category: "" })} active={!category}>
            Tất cả
          </Chip>
          {cats.data.map((c) => (
            <Chip key={c.id} href={href({ category: c.slug })} active={category === c.slug}>
              {c.name}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Sắp xếp:</span>
          {SORTS.map((s) => (
            <Link
              key={s.key}
              href={href({ sort: s.key === "newest" ? "" : s.key })}
              className={cn("rounded-md px-2 py-1", sort === s.key ? "bg-ink font-semibold text-white" : "text-muted hover:text-ink")}
              aria-current={sort === s.key ? "true" : undefined}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-6 text-sm text-muted" aria-live="polite">
        {total === 0 ? "Không có sản phẩm nào" : `${total} sản phẩm`}
        {q && (
          <>
            {" "}
            cho &ldquo;{q}&rdquo;
          </>
        )}
      </p>

      {items.length === 0 ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line p-12 text-center">
          <p className="font-semibold">{filtered ? "Không tìm thấy sản phẩm phù hợp" : "Chưa có sản phẩm nào đang bán"}</p>
          <p className="mt-1 text-sm text-muted">{filtered ? "Thử từ khóa khác hoặc bỏ bớt bộ lọc." : "Vui lòng quay lại sau."}</p>
          {filtered && (
            <Link href="/products" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
              Xóa bộ lọc
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(n) => href({ page: n })} />
    </>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-4 py-1.5 text-sm font-medium",
        active ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-muted hover:border-muted",
      )}
    >
      {children}
    </Link>
  );
}
