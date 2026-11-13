"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";

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
  const tone = state?.result === "paid" ? "bg-leaf-soft text-leaf" : state?.result === "failed" || state?.result === "invalid" ? "bg-danger-soft text-danger" : "bg-turmeric-soft text-warn";
  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-4 py-12 sm:px-8 md:py-20">
      <div className="grid max-w-2xl gap-6">
        <span className={`w-fit rounded-full px-3.5 py-2 text-sm font-semibold ${tone}`}>Kết quả thanh toán · Sandbox</span>
        <h1 className="text-[clamp(36px,5.5vw,72px)] font-extrabold leading-[1] tracking-[-0.05em]">{copy?.title ?? "Đang kiểm tra…"}</h1>
        {copy && <p className="max-w-md text-base leading-relaxed text-muted">{copy.text}</p>}
        {state?.orderCode && (
          <p className="text-sm font-semibold text-muted">
            Mã đơn hàng
            <b className="mt-1.5 block select-all text-[32px] font-extrabold tracking-[0.02em] text-ink">{state.orderCode}</b>
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Link href="/orders/lookup" className={buttonClass({ size: "lg" })}>
            Tra cứu đơn
          </Link>
          <Link href="/products" className={buttonClass({ size: "lg", variant: "outline" })}>
            Tiếp tục mua sắm
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted">Đây là môi trường thử nghiệm: không có tiền thật bị trừ.</p>
    </div>
  );
}
