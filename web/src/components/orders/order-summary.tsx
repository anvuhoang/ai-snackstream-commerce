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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-danger-soft px-6 py-4 text-sm font-semibold text-danger">
          <span>{ORDER_STATUS_LABEL.cancelled}</span>
          {order.history.at(-1)?.note && <span className="font-normal">{order.history.at(-1)?.note}</span>}
        </div>
      ) : (
        <ol className="grid grid-cols-4 gap-2 border-b border-line p-4 sm:p-5" aria-label="Tiến trình đơn hàng">
          {ORDER_STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === reached ? "step" : undefined}
              className={cn(
                "rounded-xl px-3 py-3 text-xs font-semibold sm:px-4",
                i === reached ? "bg-accent text-white" : i < reached ? "bg-leaf-soft text-leaf" : "bg-canvas text-muted",
              )}
            >
              <b className="mb-1 block text-[11px] font-semibold opacity-80">0{i + 1}</b>
              {ORDER_STATUS_LABEL[s]}
            </li>
          ))}
        </ol>
      )}

      {order.items.map((i) => (
        <div key={i.sku} className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <div className="grid gap-0.5">
            <b className="text-[15px] font-semibold">{i.productName}</b>
            <span className="text-[13px] text-muted">
              {i.variantName} · SL {i.qty} · {formatVnd(i.unitPriceVnd)}
            </span>
          </div>
          <b className="font-extrabold">{formatVnd(i.lineTotalVnd)}</b>
        </div>
      ))}

      <dl className="grid grid-cols-[120px_1fr] text-sm">
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
            <dt className="border-b border-line px-6 py-3.5 text-muted last-of-type:border-b-0">{k}</dt>
            <dd className={cn("border-b border-line px-6 py-3.5", k === "Tổng tiền" && "text-lg font-extrabold")}>{v}</dd>
          </div>
        ))}
      </dl>
      {order.note && <p className="border-t border-line px-6 py-3.5 text-sm text-muted">Ghi chú: {order.note}</p>}
    </div>
  );
}
