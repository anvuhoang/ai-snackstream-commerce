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
    <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
      <span className={cn("size-2 rounded-full", ok ? "bg-ok" : "bg-danger")} />
      {ok ? "API và cơ sở dữ liệu đã kết nối" : "Chưa kết nối được API"}
    </p>
  );
}

export default function HomePage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <span className="rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand">Đặc sản ăn vặt đường phố</span>
      <h1 className="mt-5 max-w-2xl text-5xl font-extrabold leading-[1.05] tracking-tight">Cay, giòn, ăn là nghiền.</h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        Cửa hàng đang được xây dựng. Danh mục sản phẩm, giỏ hàng và thanh toán sẽ lần lượt có mặt ở các giai đoạn tiếp theo.
      </p>
      <ApiStatus />
    </section>
  );
}
