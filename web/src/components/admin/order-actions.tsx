"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/form";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";
import { ORDER_ACTION_LABEL, type OrderStatus, type PaymentMethod } from "@/lib/shop";
import { useAdmin } from "./admin-shell";

/** The next steps the API says are possible for this order. Cancelling asks for a reason first. */
export function OrderActions({
  orderId,
  status,
  next,
  paymentMethod,
  paid,
}: {
  orderId: number;
  status: OrderStatus;
  next: OrderStatus[];
  paymentMethod: PaymentMethod;
  paid: boolean;
}) {
  const router = useRouter();
  const { csrf } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function go(to: OrderStatus) {
    if (to === "cancelled" && !window.confirm("Hủy đơn này? Hàng sẽ được trả lại kho và không thể hoàn tác.")) return;
    setBusy(true);
    setError("");
    const { error: failure } = await browserApi.POST("/api/admin/orders/{order_id}/status", {
      params: { path: { order_id: orderId } },
      body: { to, note },
      headers: adminHeaders(csrf),
    });
    setBusy(false);
    if (failure) return setError(errorText(failure));
    setNote("");
    router.refresh();
  }

  if (next.length === 0) {
    return (
      <p className="rounded-[20px] border border-line bg-canvas px-5 py-3.5 text-sm text-muted">
        {status === "cancelled" ? "Đơn đã hủy, không thể thay đổi nữa." : "Đơn đã hoàn tất."}
      </p>
    );
  }

  return (
    <section className="grid gap-3 rounded-[20px] border border-line bg-surface p-5" aria-label="Xử lý đơn">
      <h2 className="text-sm font-extrabold">Xử lý đơn</h2>
      {paymentMethod === "vnpay" && !paid && status === "new" && (
        <p className="text-xs text-muted">Đơn thanh toán online: chỉ xác nhận được sau khi cổng thanh toán báo đã nhận tiền.</p>
      )}
      <label className="grid gap-1.5 text-sm">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">Ghi chú (tùy chọn)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Ví dụ: đã gọi khách xác nhận"
          className="h-11 w-full rounded-xl border-2 border-line bg-surface px-3 text-sm focus:bg-canvas focus:outline-none"
        />
      </label>
      {error && <Status kind="error">{error}</Status>}
      <div className="flex flex-wrap gap-3">
        {next.map((to) => (
          <Button key={to} variant={to === "cancelled" ? "outline" : "primary"} disabled={busy} onClick={() => go(to)}>
            {ORDER_ACTION_LABEL[to]}
          </Button>
        ))}
      </div>
    </section>
  );
}
