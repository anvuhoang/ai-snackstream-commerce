"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Result = { result: "paid" | "failed" | "pending" | "invalid"; orderCode: string | null };

const COPY: Record<Result["result"], { title: string; text: string }> = {
  paid: { title: "Thanh toán thành công", text: "Cảm ơn bạn. Shop sẽ xác nhận đơn và liên hệ giao hàng." },
  pending: {
    title: "Đang chờ xác nhận thanh toán",
    text: "Cổng thanh toán chưa báo kết quả về cho shop. Hãy tra cứu đơn sau ít phút để xem trạng thái.",
  },
  failed: { title: "Thanh toán chưa thành công", text: "Đơn chưa được thanh toán. Bạn có thể đặt lại, hoặc chọn thanh toán khi nhận hàng." },
  invalid: { title: "Không xác minh được kết quả", text: "Đường dẫn trả về không hợp lệ. Nếu bạn đã thanh toán, hãy tra cứu đơn bằng mã đơn và số điện thoại." },
};

/** Where the gateway sends the customer's browser back to. It only asks the API what happened; the gateway's own callback is what records it. */
export function PaymentResult() {
  const [state, setState] = useState<Result | null>(null);

  useEffect(() => {
    // The gateway's query string is passed on untouched, so the API can verify its signature.
    fetch(`/api/payments/vnpay/return${window.location.search}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Result>) : Promise.reject()))
      .then(setState)
      .catch(() => setState({ result: "invalid", orderCode: null }));
  }, []);

  const copy = state ? COPY[state.result] : null;
  return (
    <div className="flex min-h-[calc(100vh-34px)] flex-col justify-between px-6 py-14 sm:pl-60">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">Kết quả thanh toán · Sandbox</p>
        <h1 className="mt-5 max-w-3xl text-[clamp(36px,5.5vw,84px)] font-light leading-[0.98] tracking-[-0.05em]">{copy?.title ?? "Đang kiểm tra…"}</h1>
        {copy && <p className="mt-6 max-w-md text-xs leading-relaxed">{copy.text}</p>}
        {state?.orderCode && (
          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
            Mã đơn hàng
            <b className="mt-2 block select-all text-[26px] font-medium tracking-[0.02em] text-ink">{state.orderCode}</b>
          </p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/orders/lookup" className="inline-flex h-11 items-center bg-ink px-7 text-[11px] font-medium uppercase tracking-[0.04em] text-white">
            Tra cứu đơn
          </Link>
          <Link href="/products" className="inline-flex h-11 items-center px-7 text-[11px] font-medium uppercase tracking-[0.04em] shadow-[inset_0_0_0_1px_var(--color-ink)]">
            Tiếp tục mua sắm
          </Link>
        </div>
      </div>
      <p className="mt-16 text-[11px] text-muted">Đây là môi trường thử nghiệm: không có tiền thật bị trừ.</p>
    </div>
  );
}
