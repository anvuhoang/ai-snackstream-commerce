import type { Metadata } from "next";
import { Suspense } from "react";
import { GridSkeleton } from "@/components/store/grid-skeleton";
import { isSortKey } from "@/lib/catalog";
import { Results } from "./results";

export const metadata: Metadata = { title: "Cửa hàng" };
export const dynamic = "force-dynamic";

type Search = { q?: string; category?: string; sort?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const category = sp.category ?? "";
  const sort = isSortKey(sp.sort) ? sp.sort : "newest";
  const page = Math.min(10_000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));

  return (
    <>
      <section className="border-b border-line px-4 py-12 sm:py-14 sm:pl-60 sm:pr-6">
        <h1 className="text-[11px] font-semibold uppercase tracking-[0.04em]">Mua SnackStream</h1>
        <p className="mt-4 max-w-lg text-xs leading-relaxed">
          Bánh tráng, khô gà, khô bò, trái cây sấy và nhiều món ăn vặt đường phố. Thành phần của từng món được đối chiếu với bao bì thật.
        </p>
      </section>

      {/* The intro above shows at once; the filters and results stream in behind a skeleton. */}
      <Suspense key={`${q}|${category}|${sort}|${page}`} fallback={<GridSkeleton />}>
        <Results q={q} category={category} sort={sort} page={page} />
      </Suspense>
    </>
  );
}
