import { Search } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { GridSkeleton } from "@/components/store/grid-skeleton";
import { Button } from "@/components/ui/button";
import { isSortKey } from "@/lib/catalog";
import { Results } from "./results";

export const metadata: Metadata = { title: "Sản phẩm" };
export const dynamic = "force-dynamic";

type Search = { q?: string; category?: string; sort?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const category = sp.category ?? "";
  const sort = isSortKey(sp.sort) ? sp.sort : "newest";
  const page = Math.min(10_000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-extrabold tracking-tight">Sản phẩm</h1>

      <form action="/products" className="mt-6 flex gap-2" role="search">
        {category && <input type="hidden" name="category" value={category} />}
        {sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Tìm sản phẩm, ví dụ: banh trang, kho ga…"
            aria-label="Tìm sản phẩm"
            className="h-11 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm focus:border-brand"
          />
        </div>
        <Button type="submit">Tìm</Button>
      </form>

      {/* The form above shows at once; the results stream in behind a skeleton. */}
      <Suspense key={`${q}|${category}|${sort}|${page}`} fallback={<div className="mt-8"><GridSkeleton /></div>}>
        <Results q={q} category={category} sort={sort} page={page} />
      </Suspense>
    </div>
  );
}
