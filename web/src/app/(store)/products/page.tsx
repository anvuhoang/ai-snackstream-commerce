import type { Metadata } from "next";
import Link from "next/link";
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
      <section className="bg-canvas">
        <div className="mx-auto grid w-full max-w-[1200px] gap-3 px-4 py-10 sm:px-8 sm:py-12">
          <span className="text-sm text-muted">
            <Link href="/" className="border-b border-muted">
              Trang chủ
            </Link>{" "}
            / Cửa hàng
          </span>
          <h1 className="text-[clamp(40px,6vw,60px)] font-extrabold leading-[1.05] tracking-[-0.04em]">Cửa hàng</h1>
          <p className="max-w-xl text-[17px] leading-relaxed text-muted">
            Bánh tráng, khô gà, khô bò, trái cây sấy và nhiều món ăn vặt đường phố. Thành phần của từng món được đối chiếu với bao bì thật.
          </p>
        </div>
      </section>

      {/* The intro above shows at once; the filters and results stream in behind a skeleton. */}
      <Suspense key={`${q}|${category}|${sort}|${page}`} fallback={<GridSkeleton />}>
        <Results q={q} category={category} sort={sort} page={page} />
      </Suspense>
    </>
  );
}
