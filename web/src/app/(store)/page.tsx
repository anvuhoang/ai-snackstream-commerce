import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ProductCard } from "@/components/store/product-card";
import { buttonClass } from "@/components/ui/button";
import { serverApi } from "@/lib/api/server";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

/** Dev-only wiring check: proves web -> API -> database is connected. Hidden in production builds. */
async function ApiStatus() {
  if (process.env.NODE_ENV === "production") return null;
  let ok = false;
  try {
    const api = await serverApi();
    const { response } = await api.GET("/api/readyz");
    ok = response.ok;
  } catch {
    ok = false;
  }
  return (
    <p className="mt-10 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
      <span className={cn("size-2 rounded-full", ok ? "bg-ok" : "bg-danger")} />
      {ok ? "API và cơ sở dữ liệu đã kết nối" : "Chưa kết nối được API"}
    </p>
  );
}

export default async function HomePage() {
  const api = await serverApi();
  // The home page still renders if the catalog cannot be reached; it just has nothing to list.
  const [products, categories] = await Promise.all([
    api.GET("/api/catalog/products", { params: { query: { pageSize: 8 } } }).catch(() => null),
    api.GET("/api/catalog/categories").catch(() => null),
  ]);
  const items = products?.data?.items ?? [];
  const cats = categories?.data ?? [];

  return (
    <>
      <section className="border-b border-line bg-gradient-to-b from-brand-soft to-canvas">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <span className="rounded-full bg-surface px-3 py-1 text-sm font-semibold text-brand shadow-sm">Đặc sản ăn vặt đường phố</span>
          <h1 className="mt-5 max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">Cay, giòn, ăn là nghiền.</h1>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Bánh tráng trộn, bò khô, khô gà lá chanh và nhiều món ăn vặt khác, chọn nhanh và xem rõ thành phần trước khi mua.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/products" className={buttonClass({ size: "lg" })}>
              Xem tất cả sản phẩm <ArrowRight className="size-5" />
            </Link>
            <Link href="/live" className={buttonClass({ size: "lg", variant: "outline" })}>
              Xem live
            </Link>
          </div>
          <ApiStatus />
        </div>
      </section>

      {cats.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-12">
          <h2 className="text-xl font-extrabold tracking-tight">Danh mục</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {cats.map((c) => (
              <Link
                key={c.id}
                href={`/products?category=${c.slug}`}
                className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium hover:border-brand hover:text-brand"
              >
                {c.name} <span className="text-muted">({c.productCount})</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-extrabold tracking-tight">Món mới</h2>
          <Link href="/products" className="text-sm font-semibold text-brand hover:underline">
            Xem tất cả
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line p-10 text-center text-muted">
            Chưa có sản phẩm nào đang bán. Vui lòng quay lại sau.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p, i) => (
              <ProductCard key={p.id} product={p} priority={i < 4} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
