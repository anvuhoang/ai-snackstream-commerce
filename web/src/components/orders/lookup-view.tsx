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

const label = "text-[13px] font-semibold";
const field =
  "h-[52px] w-full rounded-xl border-2 border-line bg-surface px-4 text-[15px] placeholder:text-muted/70 focus:border-accent focus:outline-none aria-[invalid=true]:border-danger";

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
    <div className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-10 sm:px-8 md:grid-cols-2 md:gap-14 md:py-16">
      <div className="grid content-start gap-8">
        <div>
          <h1 className="text-[clamp(40px,6vw,72px)] font-extrabold leading-[1] tracking-[-0.05em]">
            Tra cứu
            <br />
            <span className="text-accent">đơn hàng</span>
          </h1>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-muted">Nhập mã đơn và số điện thoại đã dùng khi đặt. Không cần tài khoản.</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 rounded-[20px] border border-line bg-surface p-5 sm:p-7">
          <label className="grid gap-2">
            <span className={label}>Mã đơn</span>
            <input {...register("code")} placeholder="SS-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" aria-invalid={Boolean(errors.code)} className={field} />
            {errors.code && (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {errors.code.message}
              </p>
            )}
          </label>
          <label className="grid gap-2">
            <span className={label}>Số điện thoại</span>
            <input {...register("phone")} inputMode="tel" autoComplete="tel" placeholder="09xx xxx xxx" aria-invalid={Boolean(errors.phone)} className={field} />
            {errors.phone && (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {errors.phone.message}
              </p>
            )}
          </label>
          {failure && (
            <p role="alert" className="rounded-xl border-2 border-danger/25 bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
              {failure}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex h-14 w-full items-center justify-between rounded-xl bg-accent px-6 text-base font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            <span>{isSubmitting ? "Đang tìm…" : "Tra cứu"}</span>
            <span aria-hidden>→</span>
          </button>
        </form>
      </div>

      <div className="content-start">
        {order ? (
          <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
            <div className="border-b border-line px-6 py-5">
              <p className="text-sm font-semibold text-muted">
                Mã đơn hàng
                <b className="mt-1 block text-[26px] font-extrabold tracking-[0.02em] text-ink">{order.code}</b>
              </p>
            </div>
            <OrderSummary order={order} />
          </div>
        ) : (
          <p className="rounded-[20px] bg-canvas px-6 py-6 text-[15px] leading-[1.7] text-muted">
            <b className="font-semibold text-ink">Mã đơn ở đâu?</b>
            <br />
            Mã có dạng SS-XXXX-XXXX, hiển thị ngay sau khi đặt hàng thành công. Số điện thoại phải trùng với số bạn nhập lúc đặt.
          </p>
        )}
      </div>
    </div>
  );
}
