import { formatDateTime, formatVnd } from "@/lib/format";
import { ORDER_STATUS_LABEL, ORDER_STEPS, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, type OrderOut } from "@/lib/shop";
import { cn } from "@/lib/cn";

/** Progress line, recipient, items and total of one order. Used by the confirmation page and the order look-up. */
export function OrderSummary({ order }: { order: OrderOut }) {
  const cancelled = order.status === "cancelled";
  const reached = ORDER_STEPS.indexOf(order.status);
  const payment = order.payments[order.payments.length - 1];
  const address = [order.shipAddress, order.shipWard, order.shipDistrict, order.shipProvince].filter(Boolean).join(", ");

  return (
    <div className="bg-surface">
      {cancelled ? (
        <div className="flex items-center justify-between border-b border-line bg-ink px-6 py-4 text-[11px] font-medium uppercase tracking-[0.04em] text-white">
          <span>{ORDER_STATUS_LABEL.cancelled}</span>
          {order.history.at(-1)?.note && <span className="font-normal normal-case tracking-normal opacity-80">{order.history.at(-1)?.note}</span>}
        </div>
      ) : (
        <ol className="grid grid-cols-4 border-b border-line bg-surface" aria-label="Tiến trình đơn hàng">
          {ORDER_STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === reached ? "step" : undefined}
              className={cn(
                "border-r border-line px-3 py-3.5 text-[10px] font-medium uppercase tracking-[0.04em] last:border-r-0 sm:px-6",
                i === reached ? "bg-ink text-white" : i < reached ? "text-ink" : "text-[#a8a8a4]",
              )}
            >
              <b className="mb-1.5 block text-[11px] font-medium">0{i + 1}</b>
              {ORDER_STATUS_LABEL[s]}
            </li>
          ))}
        </ol>
      )}

      {order.items.map((i) => (
        <div key={i.sku} className="flex items-center justify-between gap-4 border-b border-line px-6 py-4 text-xs">
          <div>
            <b className="block text-[13px] font-medium">{i.productName}</b>
            <span className="text-[11px] text-muted">
              {i.variantName} · SL {i.qty} · {formatVnd(i.unitPriceVnd)}
            </span>
          </div>
          <b className="font-medium">{formatVnd(i.lineTotalVnd)}</b>
        </div>
      ))}

      <dl className="grid grid-cols-[130px_1fr] text-xs">
        {[
          ["Người nhận", `${order.customerName} · ${order.customerPhone}`],
          ["Giao đến", address],
          ["Thanh toán", `${PAYMENT_METHOD_LABEL[order.paymentMethod]}${payment ? ` · ${PAYMENT_STATUS_LABEL[payment.status]}` : ""}`],
          ["Tạm tính", formatVnd(order.subtotalVnd)],
          ["Phí giao", order.shippingFeeVnd === 0 ? "Miễn phí" : formatVnd(order.shippingFeeVnd)],
          ["Tổng tiền", formatVnd(order.totalVnd)],
          ["Đặt lúc", formatDateTime(order.createdAt)],
        ].map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="border-b border-line px-6 py-3.5 text-muted">{k}</dt>
            <dd className={cn("border-b border-line px-6 py-3.5", k === "Tổng tiền" && "font-medium")}>{v}</dd>
          </div>
        ))}
      </dl>
      {order.note && <p className="border-b border-line px-6 py-3.5 text-xs text-muted">Ghi chú: {order.note}</p>}
    </div>
  );
}
