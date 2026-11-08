"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { useCart } from "@/components/cart/cart-provider";
import { OrderSummary } from "@/components/orders/order-summary";
import { browserApi } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { errorText } from "@/lib/errors";
import { formatVnd } from "@/lib/format";
import { attribution, track } from "@/lib/track";
import { PAYMENT_METHOD_LABEL, type CheckoutOut, type PaymentMethod, type ShopConfig } from "@/lib/shop";

const schema = z.object({
  name: z.string().trim().min(1, "Nhập họ và tên").max(120, "Tối đa 120 ký tự"),
  phone: z
    .string()
    .trim()
    .refine((v) => /^(\+?84|0)\d{9,10}$/.test(v.replace(/[\s.-]/g, "")), "Số điện thoại chưa đúng, ví dụ 0901 234 567"),
  address: z.string().trim().min(1, "Nhập địa chỉ giao hàng").max(255, "Tối đa 255 ký tự"),
  province: z.string().trim().max(120),
  district: z.string().trim().max(120),
  ward: z.string().trim().max(120),
  note: z.string().max(500, "Tối đa 500 ký tự"),
  paymentMethod: z.enum(["cod", "vnpay"]),
});
type Values = z.infer<typeof schema>;

const cell = "relative block border-b border-r border-line [&:nth-child(2n)]:border-r-0";
const label = "absolute left-6 top-2.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted";
const field = "w-full bg-transparent px-6 pb-2.5 pt-7 text-[13px] focus:bg-canvas focus:outline-none";

export function CheckoutView() {
  const { cart, busy, error: cartError, setQty, remove, refresh } = useCart();
  const [config, setConfig] = useState<ShopConfig | null>(null);
  const [placed, setPlaced] = useState<CheckoutOut | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // One key per checkout attempt. It is kept when the outcome is unknown (network drop) so a retry cannot create a second order.
  const idemKey = useRef<string | null>(null);

  // Opening checkout with something to buy is one funnel step, counted once per visit to this page.
  const startedSent = useRef(false);
  const hasCart = !!cart && cart.subtotalVnd > 0;
  const cartValue = cart?.subtotalVnd ?? 0;
  useEffect(() => {
    if (!hasCart || startedSent.current) return;
    startedSent.current = true;
    track("checkout_started", { cartValueVnd: cartValue });
  }, [hasCart, cartValue]);

  useEffect(() => {
    void browserApi.GET("/api/shop/config").then(({ data }) => data && setConfig(data));
  }, []);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", phone: "", address: "", province: "", district: "", ward: "", note: "", paymentMethod: "cod" },
  });
  const method = useWatch({ control, name: "paymentMethod" });

  async function onSubmit(v: Values) {
    setFailure(null);
    idemKey.current ??= crypto.randomUUID();
    try {
      const { data, error } = await browserApi.POST("/api/orders", {
        params: { header: { "idempotency-key": idemKey.current } },
        body: {
          customer: { name: v.name, phone: v.phone },
          shipping: { address: v.address, ward: v.ward, district: v.district, province: v.province },
          note: v.note,
          paymentMethod: v.paymentMethod as PaymentMethod,
          attribution: attribution(),
        },
      });
      idemKey.current = null; // a real answer: the next attempt is a new one
      if (!data) {
        setFailure(errorText(error));
        return;
      }
      if (data.paymentUrl) {
        window.location.assign(data.paymentUrl); // on to the gateway
        return;
      }
      setPlaced(data);
      void refresh(); // the server emptied the cart; the top bar must show it
      window.scrollTo({ top: 0 });
    } catch {
      setFailure("Không kết nối được máy chủ. Bấm đặt hàng lần nữa, đơn sẽ không bị tạo trùng.");
    }
  }

  if (placed) return <Confirmation order={placed} />;

  const lines = cart?.items ?? [];
  const empty = cart !== null && lines.length === 0;
  const methods = config?.paymentMethods ?? ["cod"];
  const canOrder = !empty && cart !== null && !cart.hasUnavailable && cart.itemCount > 0;

  return (
    <div>
      <div className="flex h-10 items-center justify-between border-b border-line px-6 text-[11px] font-medium uppercase tracking-[0.04em]">
        <span>Giỏ hàng và thanh toán</span>
        <span className="text-muted">Không cần tài khoản</span>
      </div>

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="grid lg:grid-cols-[1fr_480px]">
        <div className="min-w-0 lg:border-r lg:border-line">
          {cart && cart.subtotalVnd > 0 && (
            <div className="border-b border-line px-6 py-3.5 text-xs">
              <p>
                {cart.freeShipRemainingVnd === 0
                  ? "Đơn của bạn được miễn phí giao hàng."
                  : `Mua thêm ${formatVnd(cart.freeShipRemainingVnd)} để được miễn phí giao hàng`}
              </p>
              <div className="mt-2.5 h-0.5 bg-hair">
                <div
                  className="h-0.5 bg-ink transition-[width] duration-500"
                  style={{ width: `${Math.min(100, Math.round((cart.subtotalVnd / cart.freeShipFromVnd) * 100))}%` }}
                />
              </div>
            </div>
          )}

          {cart === null && <p className="border-b border-line px-6 py-16 text-center text-xs text-muted">Đang tải giỏ hàng…</p>}

          {empty && (
            <div className="border-b border-line px-6 py-20 text-center">
              <p className="text-base font-medium">Giỏ hàng đang trống</p>
              <p className="mb-5 mt-1.5 text-xs text-muted">Thêm vài món để bắt đầu.</p>
              <Link href="/products" className="inline-flex h-11 items-center bg-ink px-7 text-[11px] font-medium uppercase tracking-[0.04em] text-white">
                Đến cửa hàng
              </Link>
            </div>
          )}

          {lines.map((l) => (
            <div key={l.variantId} className="grid grid-cols-[84px_1fr_auto] items-center gap-3 border-b border-line pr-4 text-xs sm:grid-cols-[110px_1fr_auto_auto] sm:gap-5 sm:pr-6">
              <div className="relative h-[110px] border-r border-line bg-canvas sm:h-[130px]">
                {l.image && <Image src={l.image.url} alt={l.productName} fill sizes="110px" unoptimized className="object-cover" />}
              </div>
              <div>
                <Link href={`/products/${l.productSlug}`} className="block text-[13px] font-medium hover:underline">
                  {l.productName}
                </Link>
                <span className="text-[11px] text-muted">
                  {l.variantName} · {formatVnd(l.unitPriceVnd)}
                </span>
                {!l.available && <span className="mt-1 block text-[11px] font-medium text-danger">Không còn bán, hãy xóa khỏi giỏ</span>}
                <br />
                <button type="button" onClick={() => remove(l.variantId)} className="mt-2 border-b border-current text-[11px] text-muted hover:text-ink">
                  Xóa
                </button>
              </div>
              <div className="flex h-8 items-center border border-line">
                <button type="button" aria-label="Giảm" disabled={busy || l.qty <= 1} onClick={() => setQty(l.variantId, l.qty - 1)} className="size-[30px] text-base hover:bg-ink hover:text-white disabled:opacity-30">
                  −
                </button>
                <output className="w-7 text-center">{l.qty}</output>
                <button type="button" aria-label="Tăng" disabled={busy || l.qty >= 99} onClick={() => setQty(l.variantId, l.qty + 1)} className="size-[30px] text-base hover:bg-ink hover:text-white disabled:opacity-30">
                  +
                </button>
              </div>
              <div className="hidden min-w-[90px] text-right font-medium sm:block">{formatVnd(l.lineTotalVnd)}</div>
            </div>
          ))}
          {cartError && (
            <p role="alert" className="border-b border-line px-6 py-3 text-xs text-danger">
              {cartError}
            </p>
          )}

          <h2 className="px-6 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.04em]">Thông tin nhận hàng</h2>
          <div className="grid border-l-0 border-t border-line sm:grid-cols-2">
            <label className={cell}>
              <span className={label}>Họ và tên</span>
              <input {...register("name")} autoComplete="name" aria-invalid={Boolean(errors.name)} className={field} />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </label>
            <label className={cell}>
              <span className={label}>Số điện thoại</span>
              <input {...register("phone")} inputMode="tel" autoComplete="tel" placeholder="09xx xxx xxx" aria-invalid={Boolean(errors.phone)} className={field} />
              {errors.phone && <FieldError>{errors.phone.message}</FieldError>}
            </label>
            <label className={cn(cell, "sm:col-span-2 sm:border-r-0")}>
              <span className={label}>Địa chỉ</span>
              <input {...register("address")} autoComplete="street-address" placeholder="Số nhà, tên đường" aria-invalid={Boolean(errors.address)} className={field} />
              {errors.address && <FieldError>{errors.address.message}</FieldError>}
            </label>
            <label className={cell}>
              <span className={label}>Tỉnh / thành</span>
              <input {...register("province")} autoComplete="address-level1" placeholder="TP. Hồ Chí Minh" className={field} />
            </label>
            <label className={cell}>
              <span className={label}>Quận / huyện</span>
              <input {...register("district")} autoComplete="address-level2" className={field} />
            </label>
            <label className={cell}>
              <span className={label}>Phường / xã</span>
              <input {...register("ward")} className={field} />
            </label>
            <label className={cn(cell, "sm:col-span-2 sm:border-r-0")}>
              <span className={label}>Ghi chú (tùy chọn)</span>
              <textarea {...register("note")} rows={2} placeholder="Ví dụ: gọi trước khi giao" className={cn(field, "min-h-[76px] resize-y")} />
              {errors.note && <FieldError>{errors.note.message}</FieldError>}
            </label>
          </div>

          <h2 className="px-6 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.04em]">Thanh toán</h2>
          <div className="border-t border-line">
            {methods.map((m) => (
              <label
                key={m}
                className={cn(
                  "flex cursor-pointer gap-4 border-b border-line px-6 py-[18px] text-xs transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ink",
                  method === m ? "bg-canvas" : "hover:bg-[#fafaf9]",
                )}
              >
                <input type="radio" value={m} {...register("paymentMethod")} className="sr-only" />
                <span aria-hidden className={cn("mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border border-ink", method === m && "after:size-2 after:rounded-full after:bg-ink")} />
                <span>
                  <b className="block text-[13px] font-medium">{PAYMENT_METHOD_LABEL[m]}</b>
                  <span className="mt-0.5 block leading-relaxed text-muted">
                    {m === "cod" ? "Trả tiền mặt cho người giao hàng." : "Thẻ ATM, QR ngân hàng. Môi trường thử nghiệm, không trừ tiền thật."}
                  </span>
                </span>
                {m === "vnpay" && <span className="ml-auto flex h-5 items-center self-start border border-ink px-2 text-[10px] font-medium">SANDBOX</span>}
              </label>
            ))}
            {method === "vnpay" && config && (
              <p className="border-b border-line px-6 py-4 text-[11px] leading-relaxed text-muted">
                Bạn sẽ được chuyển sang trang thanh toán thử của VNPay. Đơn được giữ {config.orderExpiryMinutes} phút, quá hạn sẽ tự hủy.
              </p>
            )}
          </div>
        </div>

        <aside className="lg:sticky lg:top-[34px] lg:self-start">
          <div className="border-b border-line p-6 text-xs">
            <Row label="Tạm tính" value={cart ? formatVnd(cart.subtotalVnd) : "—"} />
            <Row label="Phí giao hàng" value={cart ? (cart.shippingFeeVnd === 0 ? "Miễn phí" : formatVnd(cart.shippingFeeVnd)) : "—"} />
            <div className="mt-2.5 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-[11px] font-medium uppercase tracking-[0.04em]">Tổng cộng</span>
              <b className="text-[30px] font-light tracking-[-0.03em]">{cart ? formatVnd(cart.totalVnd) : "—"}</b>
            </div>
          </div>
          {failure && (
            <p role="alert" className="border-b border-line px-6 py-3 text-xs text-danger">
              {failure}
            </p>
          )}
          <button
            type="submit"
            disabled={!canOrder || isSubmitting || busy}
            className="flex h-[60px] w-full items-center justify-between bg-ink px-6 text-xs font-medium uppercase tracking-[0.04em] text-white transition-colors hover:bg-brand-hover disabled:opacity-40"
          >
            <span>{isSubmitting ? "Đang gửi…" : method === "vnpay" ? "Thanh toán VNPay (sandbox)" : "Đặt hàng"}</span>
            <span aria-hidden>→</span>
          </button>
          <p className="px-6 py-4 text-[11px] leading-relaxed text-muted">
            Giá và tổng tiền được máy chủ tính lại khi đặt hàng. Bằng việc đặt hàng, bạn đồng ý để shop liên hệ xác nhận qua số điện thoại.
          </p>
        </aside>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5">
      <span className="text-muted">{label}</span>
      <b className="font-medium">{value}</b>
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <span role="alert" className="block px-6 pb-2 text-[11px] text-danger">
      {children}
    </span>
  );
}

function Confirmation({ order }: { order: CheckoutOut }) {
  return (
    <div className="grid min-h-[calc(100vh-34px)] md:grid-cols-2">
      <div className="flex flex-col justify-between border-b border-line px-6 py-14 md:border-b-0 md:border-r">
        <div>
          <h1 className="text-[clamp(44px,6vw,92px)] font-light leading-[0.95] tracking-[-0.05em]">
            Đặt hàng
            <br />
            thành công
          </h1>
          <p className="mt-6 max-w-sm text-xs leading-relaxed">
            Shop sẽ gọi xác nhận trong giờ làm việc. Lưu lại mã đơn để tra cứu bất cứ lúc nào, không cần đăng nhập.
          </p>
        </div>
        <div className="mt-10">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">Mã đơn hàng</p>
          <p className="mt-2 select-all text-[26px] font-medium tracking-[0.02em]">{order.code}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/orders/lookup" className="inline-flex h-11 items-center bg-ink px-7 text-[11px] font-medium uppercase tracking-[0.04em] text-white">
              Tra cứu đơn
            </Link>
            <Link href="/products" className="inline-flex h-11 items-center px-7 text-[11px] font-medium uppercase tracking-[0.04em] shadow-[inset_0_0_0_1px_var(--color-ink)]">
              Tiếp tục mua sắm
            </Link>
          </div>
        </div>
      </div>
      <div className="bg-canvas">
        <OrderSummary order={order} />
      </div>
    </div>
  );
}
