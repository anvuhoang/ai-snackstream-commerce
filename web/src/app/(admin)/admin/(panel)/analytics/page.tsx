import type { Metadata } from "next";
import Link from "next/link";
import { FunnelGroup } from "@/components/admin/funnel";
import { Button } from "@/components/ui/button";
import { serverApi } from "@/lib/api/server";
import { addDays, DEMO_OPTIONS, formatPercent, isDate, sourceLabel, todayVn, type DemoFilter } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { formatVnd } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard · Quản trị" };
export const dynamic = "force-dynamic";

type Search = { from?: string; to?: string; demo?: string; source?: string };

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid content-between gap-3 bg-surface p-5">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      <div>
        <b className="block text-[30px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{value}</b>
        {note && <span className="mt-1.5 block text-xs text-muted">{note}</span>}
      </div>
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const today = todayVn();
  const to = isDate(sp.to) ? sp.to : today;
  const from = isDate(sp.from) ? sp.from : addDays(to, -29);
  const demo: DemoFilter = DEMO_OPTIONS.find((o) => o.value === sp.demo)?.value ?? "exclude";
  const source = (sp.source ?? "").trim().slice(0, 100);

  const api = await serverApi();
  const { data, error } = await api.GET("/api/admin/analytics/overview", {
    params: { query: { from, to, demo, source: source || undefined } },
  });
  const range = (days: number) => `/admin/analytics?from=${addDays(today, -(days - 1))}&to=${today}&demo=${demo}`;

  const input = "h-10 border border-line bg-surface px-3 text-sm focus:bg-canvas focus:outline-none";
  const sessions = data?.funnel.filter((s) => s.unit === "sessions") ?? [];
  const orders = data?.funnel.filter((s) => s.unit === "orders") ?? [];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[clamp(34px,4vw,56px)] font-extrabold leading-[1.05] tracking-[-0.04em]">Dashboard</h1>
        <p className="mt-2 max-w-3xl text-xs text-muted">
          Lượt xem được đếm theo <b className="font-medium text-ink">phiên truy cập</b> (một trình duyệt), không phải số người: một người dùng hai thiết bị là hai phiên. Ngày tính theo giờ Việt Nam.
        </p>
      </div>

      <form action="/admin/analytics" className="flex flex-wrap items-end gap-3 rounded-[20px] border border-line bg-surface p-4">
        <label className="grid gap-1 text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
          Từ ngày
          <input type="date" name="from" defaultValue={from} max={to} className={input} />
        </label>
        <label className="grid gap-1 text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
          Đến ngày
          <input type="date" name="to" defaultValue={to} min={from} className={input} />
        </label>
        <label className="grid gap-1 text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
          Dữ liệu
          <select name="demo" defaultValue={demo} className={input}>
            {DEMO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
          Nguồn (utm_source)
          <input name="source" defaultValue={source} placeholder="tiktok, facebook, direct…" className={cn(input, "w-52")} />
        </label>
        <Button type="submit" size="sm" className="h-10">
          Xem
        </Button>
        <span className="ml-auto flex gap-4 text-xs">
          <Link href={range(7)} className="border-b border-current">
            7 ngày
          </Link>
          <Link href={range(30)} className="border-b border-current">
            30 ngày
          </Link>
        </span>
      </form>

      {!data ? (
        <p className="rounded-[20px] border-2 border-dashed border-line p-12 text-center text-sm text-muted" role="alert">
          {(error as { error?: { code?: string } } | undefined)?.error?.code === "invalid_range"
            ? "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc."
            : (error as { error?: { code?: string } } | undefined)?.error?.code === "range_too_long"
              ? "Khoảng thời gian tối đa là 366 ngày."
              : "Không tải được số liệu. Vui lòng thử lại."}
        </p>
      ) : (
        <>
          <section aria-label="Chỉ số chính" className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Doanh thu" value={formatVnd(data.totals.revenueVnd)} note="Chỉ tính đơn đã hoàn tất" />
            <Tile label="Đơn đã tạo" value={data.totals.ordersCreated.toLocaleString("vi-VN")} />
            <Tile label="Đơn hoàn tất" value={data.totals.ordersCompleted.toLocaleString("vi-VN")} />
            <Tile
              label="Tỷ lệ hoàn tất"
              value={data.totals.completionRate === null ? "—" : formatPercent(data.totals.completionRate)}
              note={data.totals.completionRate === null ? "Không tính được: chưa có đơn nào được tạo" : "Hoàn tất ÷ đã tạo, cùng kỳ"}
            />
            <Tile
              label="Giá trị TB / đơn"
              value={data.totals.averageOrderVnd === null ? "—" : formatVnd(data.totals.averageOrderVnd)}
              note={data.totals.averageOrderVnd === null ? "Không tính được: chưa có đơn hoàn tất" : undefined}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <FunnelGroup title="Phễu truy cập" unitLabel="phiên" steps={sessions} />
            <FunnelGroup title="Phễu đơn hàng" unitLabel="đơn" steps={orders} />
          </div>
          <p className="-mt-3 text-xs text-muted">
            Hai phễu dùng hai đơn vị khác nhau nên không so thẳng với nhau. Tỷ lệ phiên → đơn không được tự suy ra, vì một phiên có thể đặt nhiều đơn và đơn có thể đến từ nguồn không theo dõi được.
          </p>

          <section className="overflow-x-auto rounded-[20px] border border-line bg-surface" aria-label="Theo nguồn">
            <h2 className="border-b border-line px-5 py-3 text-sm font-extrabold">Theo nguồn</h2>
            {data.bySource.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted">Chưa có dữ liệu trong khoảng này.</p>
            ) : (
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-line text-[10px] uppercase tracking-[0.04em] text-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Nguồn</th>
                    <th className="px-4 py-3 text-right font-medium">Phiên xem</th>
                    <th className="px-4 py-3 text-right font-medium">Phiên thêm giỏ</th>
                    <th className="px-4 py-3 text-right font-medium">Đơn tạo</th>
                    <th className="px-4 py-3 text-right font-medium">Đơn hoàn tất</th>
                    <th className="px-5 py-3 text-right font-medium">Doanh thu</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySource.map((r) => (
                    <tr key={r.source || "direct"} className="border-b border-hair last:border-0">
                      <td className="px-5 py-3 font-medium">{sourceLabel(r.source)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.viewers}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.carters}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.ordersCreated}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.ordersCompleted}</td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">{formatVnd(r.revenueVnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="border-t border-hair px-5 py-3 text-xs text-muted">
              Mỗi đơn thuộc đúng một nguồn: nguồn cuối cùng khách bấm vào trong 7 ngày trước khi đặt. Không có UTM thì tính là “Trực tiếp”.
            </p>
          </section>

          <section className="overflow-x-auto rounded-[20px] border border-line bg-surface" aria-label="Sản phẩm được xem nhiều">
            <h2 className="border-b border-line px-5 py-3 text-sm font-extrabold">Sản phẩm được xem nhiều</h2>
            {data.topProducts.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted">Chưa có dữ liệu trong khoảng này.</p>
            ) : (
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line text-[10px] uppercase tracking-[0.04em] text-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Sản phẩm</th>
                    <th className="px-4 py-3 text-right font-medium">Phiên xem</th>
                    <th className="px-4 py-3 text-right font-medium">Phiên thêm giỏ</th>
                    <th className="px-5 py-3 text-right font-medium">Bấm “Mua trên Shopee”</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p) => (
                    <tr key={p.sku} className="border-b border-hair last:border-0">
                      <td className="px-5 py-3">
                        {p.productName || p.sku}
                        <span className="block font-mono text-xs text-muted">{p.sku}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.viewers}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.carters}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{p.shopeeClicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="border-t border-hair px-5 py-3 text-xs text-muted">
              Tổng lượt bấm “Mua trên Shopee” trong kỳ: <b className="font-medium text-ink">{data.shopeeClicks}</b>. Đây chỉ là lượt chuyển sang Shopee, không bao giờ được tính là đơn của web.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
