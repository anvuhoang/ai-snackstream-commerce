"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";
import type { OrderOut } from "@/lib/shop";
import { OrderSummary } from "./order-summary";

const schema = z.object({
  code: z.string().trim().min(4, "Nhập mã đơn, ví dụ SS-XXXX-XXXX"),
  phone: z
    .string()
    .trim()
    .refine((v) => /^(\+?84|0)\d{9,10}$/.test(v.replace(/[\s.-]/g, "")), "Số điện thoại chưa đúng, ví dụ 0901 234 567"),
});
type Values = z.infer<typeof schema>;

const label = "absolute left-6 top-2.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted";
const field = "w-full bg-transparent px-6 pb-3 pt-7 text-sm focus:bg-canvas focus:outline-none";

export function LookupView() {
  const [order, setOrder] = useState<OrderOut | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { code: "", phone: "" } });

  async function onSubmit(v: Values) {
    setFailure(null);
    setOrder(null);
    try {
      const { data, error } = await browserApi.POST("/api/orders/lookup", { body: v });
      if (data) setOrder(data);
      else setFailure(errorText(error));
    } catch {
      setFailure("Không kết nối được máy chủ. Vui lòng thử lại.");
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-34px)] md:grid-cols-2">
      <div className="flex flex-col justify-between border-b border-line pt-14 md:border-b-0 md:border-r">
        <div className="px-6">
          <h1 className="text-[clamp(44px,6vw,92px)] font-light leading-[0.95] tracking-[-0.05em]">
            Tra cứu
            <br />
            đơn hàng
          </h1>
          <p className="mt-6 max-w-sm text-xs leading-relaxed">Nhập mã đơn và số điện thoại đã dùng khi đặt. Không cần tài khoản.</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-12 border-t border-line">
          <label className="relative block border-b border-line">
            <span className={label}>Mã đơn</span>
            <input {...register("code")} placeholder="SS-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" aria-invalid={Boolean(errors.code)} className={field} />
            {errors.code && <p role="alert" className="px-6 pb-2 text-[11px] text-danger">{errors.code.message}</p>}
          </label>
          <label className="relative block border-b border-line">
            <span className={label}>Số điện thoại</span>
            <input {...register("phone")} inputMode="tel" autoComplete="tel" placeholder="09xx xxx xxx" aria-invalid={Boolean(errors.phone)} className={field} />
            {errors.phone && <p role="alert" className="px-6 pb-2 text-[11px] text-danger">{errors.phone.message}</p>}
          </label>
          {failure && (
            <p role="alert" className="border-b border-line px-6 py-3.5 text-xs text-danger">
              {failure}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex h-14 w-full items-center justify-between bg-ink px-6 text-xs font-medium uppercase tracking-[0.04em] text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            <span>{isSubmitting ? "Đang tìm…" : "Tra cứu"}</span>
            <span aria-hidden>→</span>
          </button>
        </form>
      </div>

      <div className="bg-canvas">
        {order ? (
          <>
            <div className="flex items-start justify-between border-b border-line bg-surface px-6 py-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                Mã đơn hàng
                <b className="mt-1.5 block text-[22px] font-medium tracking-[0.02em] text-ink">{order.code}</b>
              </p>
            </div>
            <OrderSummary order={order} />
          </>
        ) : (
          <p className="border-b border-line px-6 py-6 text-xs leading-[1.7] text-muted">
            <b className="font-medium text-ink">Mã đơn ở đâu?</b>
            <br />
            Mã có dạng SS-XXXX-XXXX, hiển thị ngay sau khi đặt hàng thành công. Số điện thoại phải trùng với số bạn nhập lúc đặt.
          </p>
        )}
      </div>
    </div>
  );
}
