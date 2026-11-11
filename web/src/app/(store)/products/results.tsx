import Link from "next/link";
import { Pagination } from "@/components/store/pagination";
import { ProductCard } from "@/components/store/product-card";
import { serverApi } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { query, SORTS, type SortKey } from "@/lib/catalog";

export const PAGE_SIZE = 12;

export type Filters = { q: string; category: string; sort: SortKey; page: number };

const pill =
  "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border-2 px-[18px] text-sm font-semibold transition-colors";

/** Category pills, sort and search, the card grid and paging. Async, so the page can stream it behind a skeleton. */
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
    <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap gap-2.5" aria-label="Danh mục">
        <Chip href={href({ category: "" })} active={!category}>
          Tất cả
        </Chip>
        {cats.data.map((c) => (
          <Chip key={c.id} href={href({ category: c.slug })} active={category === c.slug}>
            {c.name}
            <span className="text-xs font-medium opacity-70">{c.productCount}</span>
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[15px] text-muted">{total === 0 ? "Không có sản phẩm nào" : `${total} sản phẩm`}</span>
        <div className="flex flex-wrap items-center gap-2.5">
          {SORTS.map((s) => (
            <Link
              key={s.key}
              href={href({ sort: s.key === "newest" ? "" : s.key })}
              aria-current={sort === s.key ? "true" : undefined}
              className={cn(
                "inline-flex h-10 items-center rounded-full px-4 text-sm font-medium transition-colors",
                sort === s.key ? "bg-ink text-paper" : "text-muted hover:bg-canvas hover:text-ink",
              )}
            >
              {s.label}
            </Link>
          ))}
          <form action="/products" role="search" className="flex">
            {category && <input type="hidden" name="category" value={category} />}
            {sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
            <input
              name="q"
              defaultValue={q}
              maxLength={100}
              placeholder="Tìm sản phẩm"
              aria-label="Tìm sản phẩm"
              className="h-11 w-full min-w-48 rounded-xl border-2 border-line bg-surface px-4 text-[15px] placeholder:text-muted/70 focus:border-accent focus:outline-none sm:w-60"
            />
          </form>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {total === 0 ? "Không có sản phẩm nào" : `${total} sản phẩm`}
        {q && ` cho "${q}"`}
      </p>

      {items.length === 0 ? (
        <div className="rounded-[20px] border-2 border-dashed border-line px-4 py-20 text-center">
          <p className="text-lg font-semibold">{filtered ? "Không tìm thấy sản phẩm phù hợp" : "Chưa có sản phẩm nào đang bán"}</p>
          <p className="mt-1.5 text-sm text-muted">{filtered ? "Thử từ khóa khác hoặc bỏ bớt bộ lọc." : "Vui lòng quay lại sau."}</p>
          {filtered && (
            <Link href="/products" className="mt-5 inline-block border-b-2 border-accent text-sm font-semibold">
              Xóa bộ lọc
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
          {items.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(n) => href({ page: n })} />
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(pill, active ? "border-accent bg-accent text-white" : "border-ink hover:bg-canvas")}
    >
      {children}
    </Link>
  );
}
