import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderActions } from "@/components/admin/order-actions";
import { Badge } from "@/components/ui/badge";
import { serverApi } from "@/lib/api/server";
import { formatDateTime, formatVnd } from "@/lib/format";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/shop";

export const metadata: Metadata = { title: "Chi tiết đơn · Quản trị" };
export const dynamic = "force-dynamic";

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(id) || id < 1) notFound();

  const api = await serverApi();
  const { data: o, response } = await api.GET("/api/admin/orders/{order_id}", { params: { path: { order_id: id } } });
  if (response.status === 404) notFound();
  if (!o) throw new Error("Could not load the order");
  const address = [o.shipAddress, o.shipWard, o.shipDistrict, o.shipProvince].filter(Boolean).join(", ");

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ChevronLeft className="size-4" /> Đơn hàng
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium tracking-wide">{o.code}</h1>
          <Badge tone={o.status === "cancelled" ? "warn" : "brand"}>{ORDER_STATUS_LABEL[o.status]}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted">Đặt lúc {formatDateTime(o.createdAt)}</p>
      </div>

      <OrderActions orderId={o.id} status={o.status} next={o.nextStatuses} paymentMethod={o.paymentMethod} paid={o.payments.some((p) => p.status === "paid")} />

      <section className="border border-line bg-surface" aria-label="Sản phẩm">
        {o.items.map((i) => (
          <div key={i.sku} className="flex items-center justify-between gap-4 border-b border-hair px-5 py-3.5 text-sm last:border-0">
            <div>
              <b className="block font-medium">{i.productName}</b>
              <span className="text-xs text-muted">
                {i.variantName} · <span className="font-mono">{i.sku}</span> · {formatVnd(i.unitPriceVnd)} × {i.qty}
              </span>
            </div>
            <b className="font-medium tabular-nums">{formatVnd(i.lineTotalVnd)}</b>
          </div>
        ))}
        <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 border-t border-line px-5 py-4 text-sm">
          <dt className="text-muted">Tạm tính</dt>
          <dd className="text-right tabular-nums">{formatVnd(o.subtotalVnd)}</dd>
          <dt className="text-muted">Phí giao hàng</dt>
          <dd className="text-right tabular-nums">{o.shippingFeeVnd === 0 ? "Miễn phí" : formatVnd(o.shippingFeeVnd)}</dd>
          <dt className="font-medium">Tổng cộng</dt>
          <dd className="text-right text-lg font-medium tabular-nums">{formatVnd(o.totalVnd)}</dd>
        </dl>
      </section>

      <section className="grid gap-px border border-line bg-line sm:grid-cols-2" aria-label="Giao hàng và thanh toán">
        <div className="grid gap-1 bg-surface p-5 text-sm">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em]">Giao hàng</h2>
          <p className="font-medium">{o.customerName}</p>
          <a href={`tel:${o.customerPhone}`} className="w-fit border-b border-current">
            {o.customerPhone}
          </a>
          <p className="text-muted">{address}</p>
          {o.note && <p className="mt-1 text-xs">Ghi chú: {o.note}</p>}
        </div>
        <div className="grid gap-1 bg-surface p-5 text-sm">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em]">Thanh toán</h2>
          <p className="font-medium">{PAYMENT_METHOD_LABEL[o.paymentMethod]}</p>
          {o.payments.map((p, i) => (
            <p key={i} className="text-muted">
              {PAYMENT_STATUS_LABEL[p.status]} · {formatVnd(p.amountVnd)}
              {p.paidAt && ` · ${formatDateTime(p.paidAt)}`}
            </p>
          ))}
          {o.expiresAt && <p className="text-xs text-muted">Hết hạn thanh toán lúc {formatDateTime(o.expiresAt)}</p>}
        </div>
      </section>

      <section className="border border-line bg-surface p-5" aria-label="Lịch sử">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.04em]">Lịch sử</h2>
        <ol className="grid gap-2.5 text-sm">
          {[...o.history].reverse().map((h, i) => (
            <li key={i} className="grid grid-cols-[130px_1fr] gap-3">
              <time className="text-xs text-muted">{formatDateTime(h.createdAt)}</time>
              <span>
                <b className="font-medium">
                  {h.fromStatus === h.toStatus ? ORDER_STATUS_LABEL[h.toStatus] : h.fromStatus ? `${ORDER_STATUS_LABEL[h.fromStatus]} → ${ORDER_STATUS_LABEL[h.toStatus]}` : ORDER_STATUS_LABEL[h.toStatus]}
                </b>
                <span className="text-xs text-muted">
                  {" "}
                  · {h.actorEmail ?? "Hệ thống"}
                  {h.note && ` · ${h.note}`}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
