import Link from "next/link";
import { Pagination } from "@/components/store/pagination";
import { ProductCard } from "@/components/store/product-card";
import { serverApi } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { query, SORTS, type SortKey } from "@/lib/catalog";

export const PAGE_SIZE = 12;

export type Filters = { q: string; category: string; sort: SortKey; page: number };

const tab = "flex h-10 shrink-0 items-center border-r border-line px-5 text-[11px] font-medium uppercase tracking-[0.04em] whitespace-nowrap transition-colors";

/** Category row, sort and search cells, the ruled grid and paging. Async, so the page can stream it behind a skeleton. */
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
      <div className="flex flex-wrap border-b border-line">
        <div className="flex min-w-0 flex-1 basis-[560px] overflow-x-auto" aria-label="Danh mục">
          <Chip href={href({ category: "" })} active={!category}>
            Tất cả
          </Chip>
          {cats.data.map((c) => (
            <Chip key={c.id} href={href({ category: c.slug })} active={category === c.slug}>
              {c.name}
              <span className="ml-1.5 opacity-50">{c.productCount}</span>
            </Chip>
          ))}
        </div>
        <div className="ml-auto flex border-l border-line">
          {SORTS.map((s) => (
            <Chip key={s.key} href={href({ sort: s.key === "newest" ? "" : s.key })} active={sort === s.key}>
              {s.label}
            </Chip>
          ))}
          <form action="/products" role="search" className="flex w-full min-w-56 sm:w-60">
            {category && <input type="hidden" name="category" value={category} />}
            {sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
            <input
              name="q"
              defaultValue={q}
              maxLength={100}
              placeholder="Tìm sản phẩm"
              aria-label="Tìm sản phẩm"
              className="h-10 w-full bg-transparent px-4 text-[11px] font-medium uppercase tracking-[0.04em] placeholder:text-muted focus:bg-canvas focus:outline-none"
            />
          </form>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {total === 0 ? "Không có sản phẩm nào" : `${total} sản phẩm`}
        {q && ` cho "${q}"`}
      </p>

      {items.length === 0 ? (
        <div className="border-b border-line px-4 py-20 text-center">
          <p className="text-base font-medium">{filtered ? "Không tìm thấy sản phẩm phù hợp" : "Chưa có sản phẩm nào đang bán"}</p>
          <p className="mt-1.5 text-xs text-muted">{filtered ? "Thử từ khóa khác hoặc bỏ bớt bộ lọc." : "Vui lòng quay lại sau."}</p>
          {filtered && (
            <Link href="/products" className="mt-5 inline-block border-b border-current text-xs font-medium">
              Xóa bộ lọc
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 border-l-0 lg:grid-cols-4 [&>*:nth-child(2n)]:border-r-0 lg:[&>*:nth-child(2n)]:border-r lg:[&>*:nth-child(4n)]:border-r-0">
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
    <Link href={href} aria-current={active ? "true" : undefined} className={cn(tab, active ? "bg-ink text-white" : "hover:bg-canvas")}>
      {children}
    </Link>
  );
}
