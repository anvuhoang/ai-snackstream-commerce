import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/store/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { serverApi } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { query } from "@/lib/catalog";
import { formatDateTime, formatVnd } from "@/lib/format";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, type OrderStatus } from "@/lib/shop";

export const metadata: Metadata = { title: "Đơn hàng · Quản trị" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const STATUSES: OrderStatus[] = ["new", "confirmed", "shipping", "completed", "cancelled"];
const TONE = { new: "brand", confirmed: "warn", shipping: "warn", completed: "ok", cancelled: "danger" } as const;
const PAY_TONE = { pending: "warn", paid: "ok", failed: "danger", expired: "danger" } as const;
type Search = { q?: string; status?: string; page?: string };

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const status = STATUSES.find((s) => s === sp.status);
  const page = Math.min(10_000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));

  const api = await serverApi();
  const { data } = await api.GET("/api/admin/orders", { params: { query: { q, status, page, pageSize: PAGE_SIZE } } });
  if (!data) throw new Error("Could not load orders");

  const href = (over: Partial<{ status: string; page: number }>) => `/admin/orders${query({ q, status, page: undefined, ...over })}`;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[clamp(34px,4vw,56px)] font-extrabold leading-[1.05] tracking-[-0.04em]">Đơn hàng</h1>
        <p className="mt-2 text-xs text-muted">{data.total} đơn</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Lọc theo trạng thái">
          {[undefined, ...STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={href({ status: s ?? "" })}
              aria-current={status === s ? "true" : undefined}
              className={cn(
                "inline-flex h-10 items-center rounded-full border-2 px-4 text-sm font-semibold transition-colors",
                status === s ? "border-accent bg-accent text-white" : "border-ink hover:bg-canvas",
              )}
            >
              {s ? ORDER_STATUS_LABEL[s] : "Tất cả"}
            </Link>
          ))}
        </div>
        <form action="/admin/orders" role="search" className="flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Mã đơn, tên, số điện thoại…"
              aria-label="Tìm đơn hàng"
              className="h-10 w-72 rounded-xl border-2 border-line bg-surface pl-9 pr-3 text-sm focus:bg-canvas focus:outline-none"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-10">
            Tìm
          </Button>
        </form>
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-[20px] border-2 border-dashed border-line p-12 text-center text-sm text-muted">
          {q || status ? "Không có đơn khớp bộ lọc." : "Chưa có đơn hàng nào."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-line bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.04em] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Mã đơn</th>
                <th className="px-4 py-3 font-medium">Khách hàng</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 font-medium">Thanh toán</th>
                <th className="px-4 py-3 text-right font-medium">SL</th>
                <th className="px-4 py-3 text-right font-medium">Tổng tiền</th>
                <th className="px-4 py-3 font-medium">Đặt lúc</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id} className="border-b border-hair last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${o.id}`} className="font-medium tracking-wide hover:underline">
                      {o.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {o.customerName}
                    <span className="block text-xs text-muted">{o.customerPhone}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {PAYMENT_METHOD_LABEL[o.paymentMethod]}
                    {o.paymentStatus && (
                      <div className="mt-1">
                        <Badge tone={PAY_TONE[o.paymentStatus]}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Badge>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.itemCount}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatVnd(o.totalVnd)}</td>
                  <td className="px-4 py-3 text-xs text-muted">{formatDateTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} hrefFor={(n) => href({ page: n })} />
    </div>
  );
}
