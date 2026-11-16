import type { Metadata } from "next";
import Link from "next/link";
import { LineChart } from "@/components/admin/line-chart";
import { Badge } from "@/components/ui/badge";
import { serverApi } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { addDays, todayVn } from "@/lib/analytics";
import { formatDateTime, formatVnd } from "@/lib/format";
import { ORDER_STATUS_LABEL } from "@/lib/shop";

export const metadata: Metadata = { title: "Quản trị" };
export const dynamic = "force-dynamic";

const RANGES = [7, 30] as const;
// One colour per measure everywhere on this page: created orders red, completed orders and their value blue, product views amber.
const RED = "#c8321c";
const BLUE = "#2b6cb0";
const AMBER = "#b8860b";
const TONE = { new: "brand", confirmed: "warn", shipping: "warn", completed: "ok", cancelled: "danger" } as const;

/** One failing section must not blank the whole page: a failed call becomes null and that section says so. */
async function safe<T>(call: Promise<{ data?: T }>): Promise<T | null> {
  try {
    return (await call).data ?? null;
  } catch {
    return null;
  }
}

function Tile({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const body = (
    <div className="grid h-full content-between gap-3 bg-surface p-5 transition-colors hover:bg-canvas">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      <div>
        <b className="block text-[30px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{value}</b>
        {note && <span className="mt-1.5 block text-xs text-muted">{note}</span>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Unavailable() {
  return (
    <p className="rounded-[20px] border-2 border-dashed border-line p-8 text-center text-sm text-muted" role="alert">
      Không tải được phần này. Tải lại trang để thử lại.
    </p>
  );
}

const count = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("vi-VN"));

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const DAYS = RANGES.find((d) => String(d) === sp.days) ?? 7;
  const api = await serverApi();
  const today = todayVn();
  const range = { from: addDays(today, -(DAYS - 1)), to: today, demo: "include" as const };

  const [stats, newOrders, shipping, low, out, support, logs, latest] = await Promise.all([
    safe(api.GET("/api/admin/analytics/overview", { params: { query: range } })),
    safe(api.GET("/api/admin/orders", { params: { query: { status: "new", page: 1, pageSize: 1 } } })),
    safe(api.GET("/api/admin/orders", { params: { query: { status: "shipping", page: 1, pageSize: 1 } } })),
    safe(api.GET("/api/admin/inventory", { params: { query: { state: "low", page: 1, pageSize: 1 } } })),
    safe(api.GET("/api/admin/inventory", { params: { query: { state: "out", page: 1, pageSize: 1 } } })),
    safe(api.GET("/api/admin/chat/support", { params: { query: { offset: 0, limit: 100 } } })),
    safe(api.GET("/api/admin/chat/logs", { params: { query: { offset: 0, limit: 100, needs_review: false } } })),
    safe(api.GET("/api/admin/orders", { params: { query: { page: 1, pageSize: 5 } } })),
  ]);

  const days = stats?.daily.map((d) => d.day) ?? [];
  const top = (stats?.topProducts ?? []).slice(0, 5);
  const topMax = Math.max(1, ...top.map((p) => p.viewers));
  const openSupport = support?.filter((s) => s.state === "requested").length;
  // The chatbot answered with the fixed "no data" reply: these are the questions the shop has no written answer for.
  const unanswered = logs?.items.filter((l) => l.outcome === "no_data").length;

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-[clamp(34px,4vw,56px)] font-extrabold leading-[1.05] tracking-[-0.04em]">Tổng quan</h1>
        <p className="mt-2 text-xs text-muted">Việc cần xử lý bây giờ và số liệu {DAYS} ngày gần nhất (giờ Việt Nam).</p>
      </div>

      <section aria-label="Cần xử lý" className="grid gap-3">
        <h2 className="text-sm font-extrabold">Cần xử lý</h2>
        <div className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          <Tile label="Đơn mới chờ xác nhận" value={count(newOrders?.total)} href="/admin/orders?status=new" />
          <Tile label="Đơn đang giao" value={count(shipping?.total)} href="/admin/orders?status=shipping" />
          <Tile label="Sắp hết hàng" value={count(low?.total)} href="/admin/inventory?state=low" />
          <Tile label="Hết hàng" value={count(out?.total)} href="/admin/inventory?state=out" />
          <Tile
            label="Khách xin hỗ trợ (chatbot)"
            value={count(openSupport)}
            note="Chưa có ai nhận"
            href="/admin/chat/manage"
          />
          <Tile
            label="Câu chatbot chưa trả lời được"
            value={count(unanswered)}
            note="Trong 100 câu gần nhất: shop chưa có dữ liệu để trả lời"
            href="/admin/chat"
          />
        </div>
      </section>

      <section aria-label={`${DAYS} ngày gần nhất`} className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold">{DAYS} ngày gần nhất</h2>
          <div className="flex items-center gap-4">
            <nav aria-label="Khoảng thời gian" className="flex gap-2">
              {RANGES.map((d) => (
                <Link
                  key={d}
                  href={`/admin?days=${d}`}
                  aria-current={d === DAYS ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border-2 px-4 text-sm font-semibold transition-colors",
                    d === DAYS ? "border-accent bg-accent text-white" : "border-ink hover:bg-canvas",
                  )}
                >
                  {d} ngày
                </Link>
              ))}
            </nav>
            <Link href="/admin/analytics" className="border-b border-current text-xs">
              Dashboard đầy đủ
            </Link>
          </div>
        </div>
        {stats ? (
          <>
            <div className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Giá trị đơn hoàn tất" value={formatVnd(stats.totals.revenueVnd)} note="Chưa chắc là tiền thực nhận" />
              <Tile label="Đơn đã tạo" value={count(stats.totals.ordersCreated)} />
              <Tile label="Đơn hoàn tất" value={count(stats.totals.ordersCompleted)} />
              <Tile label="Đơn hủy" value={count(stats.totals.ordersCancelled)} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <LineChart
                title="Giá trị đơn hoàn tất theo ngày"
                days={days}
                kind="area"
                unit="vnd"
                series={[{ key: "revenue", label: "Giá trị đơn hoàn tất", color: BLUE, values: stats.daily.map((d) => d.revenueVnd) }]}
              />
              <LineChart
                title="Đơn hàng theo ngày"
                days={days}
                kind="bars"
                series={[
                  { key: "created", label: "Đơn đã tạo", color: RED, values: stats.daily.map((d) => d.ordersCreated) },
                  { key: "completed", label: "Đơn hoàn tất", color: BLUE, values: stats.daily.map((d) => d.ordersCompleted) },
                ]}
              />
              <LineChart
                title="Phiên xem sản phẩm theo ngày"
                days={days}
                showTotals={false}
                note="Đếm theo phiên truy cập (một trình duyệt), không phải số người."
                series={[{ key: "viewers", label: "Phiên xem", color: AMBER, values: stats.daily.map((d) => d.viewers) }]}
              />
              <section aria-label="Sản phẩm được xem nhiều" className="rounded-[20px] border border-line bg-surface">
                <h2 className="border-b border-line px-5 py-3 text-sm font-extrabold">Sản phẩm được xem nhiều</h2>
                {top.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted">Chưa có lượt xem trong {DAYS} ngày qua.</p>
                ) : (
                  <ol className="grid gap-3 px-5 py-4">
                    {top.map((p) => (
                      <li key={p.sku} className="grid gap-1" title={`${p.productName}: ${p.viewers} phiên xem, ${p.carters} thêm giỏ`}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate font-medium">{p.productName}</span>
                          <b className="font-extrabold tabular-nums">{p.viewers}</b>
                        </div>
                        <div className="h-2 bg-canvas">
                          <div className="h-full min-w-[2px]" style={{ width: `${(p.viewers / topMax) * 100}%`, background: AMBER }} />
                        </div>
                        <span className="text-xs text-muted">{p.carters} phiên thêm giỏ</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </>
        ) : (
          <Unavailable />
        )}
      </section>

      <section aria-label="Đơn mới nhất" className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-extrabold">Đơn mới nhất</h2>
          <Link href="/admin/orders" className="border-b border-current text-xs">
            Tất cả đơn
          </Link>
        </div>
        {!latest ? (
          <p className="p-8 text-center text-sm text-muted">Không tải được đơn hàng.</p>
        ) : latest.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">Chưa có đơn nào.</p>
        ) : (
          <ul>
            {latest.items.map((o) => (
              <li key={o.id} className="border-b border-hair last:border-0">
                <Link href={`/admin/orders/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-canvas">
                  <span className="min-w-0">
                    <b className="block truncate text-sm">{o.code}</b>
                    <span className="block truncate text-xs text-muted">
                      {o.customerName} · {formatDateTime(o.createdAt)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-medium tabular-nums">{formatVnd(o.totalVnd)}</span>
                    <Badge tone={TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
