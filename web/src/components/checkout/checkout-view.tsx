"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { useCart } from "@/components/cart/cart-provider";
import { OrderSummary } from "@/components/orders/order-summary";
import { buttonClass } from "@/components/ui/button";
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

const card = "rounded-[20px] border border-line bg-surface p-5 sm:p-7";
const fieldBox = "grid gap-2 text-sm";
const label = "text-[13px] font-semibold";
const field =
  "w-full rounded-xl border-2 border-line bg-paper/60 px-4 text-[15px] placeholder:text-muted/70 focus:border-accent focus:bg-surface focus:outline-none aria-[invalid=true]:border-danger";

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
    <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 pb-4 pt-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[clamp(32px,5vw,46px)] font-extrabold leading-[1.05] tracking-[-0.04em]">Giỏ hàng và thanh toán</h1>
        <span className="rounded-full bg-leaf-soft px-3.5 py-2 text-sm font-semibold text-leaf">Không cần tài khoản</span>
      </div>

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="grid items-start gap-6 lg:grid-cols-[1fr_380px] lg:gap-8">
        <div className="grid min-w-0 gap-5">
          <section className={cn(card, "grid gap-5")}>
            {cart && cart.subtotalVnd > 0 && (
              <div className="grid gap-2.5">
                <p className="text-sm font-semibold">
                  {cart.freeShipRemainingVnd === 0 ? (
                    "Đơn của bạn được miễn phí giao hàng."
                  ) : (
                    <>
                      Mua thêm <b className="text-accent">{formatVnd(cart.freeShipRemainingVnd)}</b> để được miễn phí giao hàng
                    </>
                  )}
                </p>
                <div className="h-2.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full rounded-full bg-turmeric transition-[width] duration-500"
                    style={{ width: `${Math.min(100, Math.round((cart.subtotalVnd / cart.freeShipFromVnd) * 100))}%` }}
                  />
                </div>
              </div>
            )}

            {cart === null && <p className="py-10 text-center text-sm text-muted">Đang tải giỏ hàng…</p>}

            {empty && (
              <div className="py-12 text-center">
                <p className="text-lg font-semibold">Giỏ hàng đang trống</p>
                <p className="mb-5 mt-1.5 text-sm text-muted">Thêm vài món để bắt đầu.</p>
                <Link href="/products" className={buttonClass({ size: "lg" })}>
                  Đến cửa hàng
                </Link>
              </div>
            )}

            {lines.map((l) => (
              <div key={l.variantId} className="flex flex-wrap items-center gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0">
                <div className="relative size-[88px] shrink-0 overflow-hidden rounded-[14px] bg-canvas">
                  {l.image && <Image src={l.image.url} alt={l.productName} fill sizes="88px" unoptimized className="object-cover" />}
                </div>
                <div className="grid min-w-[160px] flex-1 gap-1">
                  <Link href={`/products/${l.productSlug}`} className="text-base font-semibold hover:underline">
                    {l.productName}
                  </Link>
                  <span className="text-sm text-muted">
                    {l.variantName} · {formatVnd(l.unitPriceVnd)}
                  </span>
                  {!l.available && <span className="text-[13px] font-semibold text-danger">Không còn bán, hãy xóa khỏi giỏ</span>}
                  <button type="button" onClick={() => remove(l.variantId)} className="w-fit border-b border-accent text-[13px] font-semibold text-accent">
                    Xóa
                  </button>
                </div>
                <div className="flex h-11 items-center overflow-hidden rounded-xl border-2 border-ink bg-surface">
                  <button type="button" aria-label="Giảm" disabled={busy || l.qty <= 1} onClick={() => setQty(l.variantId, l.qty - 1)} className="h-full w-10 text-lg font-semibold transition-colors hover:bg-canvas disabled:opacity-30">
                    −
                  </button>
                  <output className="w-8 text-center font-semibold">{l.qty}</output>
                  <button type="button" aria-label="Tăng" disabled={busy || l.qty >= 99} onClick={() => setQty(l.variantId, l.qty + 1)} className="h-full w-10 text-lg font-semibold transition-colors hover:bg-canvas disabled:opacity-30">
                    +
                  </button>
                </div>
                <b className="min-w-[92px] text-right text-[17px] font-extrabold">{formatVnd(l.lineTotalVnd)}</b>
              </div>
            ))}
            {cartError && (
              <p role="alert" className="rounded-xl border-2 border-danger/25 bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
                {cartError}
              </p>
            )}
          </section>

          <section className={cn(card, "grid gap-5")}>
            <h2 className="text-[22px] font-extrabold tracking-[-0.02em]">Thông tin nhận hàng</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={fieldBox}>
                <span className={label}>Họ và tên</span>
                <input {...register("name")} autoComplete="name" aria-invalid={Boolean(errors.name)} className={cn(field, "h-[52px]")} />
                {errors.name && <FieldError>{errors.name.message}</FieldError>}
              </label>
              <label className={fieldBox}>
                <span className={label}>Số điện thoại</span>
                <input {...register("phone")} inputMode="tel" autoComplete="tel" placeholder="09xx xxx xxx" aria-invalid={Boolean(errors.phone)} className={cn(field, "h-[52px]")} />
                {errors.phone && <FieldError>{errors.phone.message}</FieldError>}
              </label>
            </div>
            <label className={fieldBox}>
              <span className={label}>Địa chỉ</span>
              <input {...register("address")} autoComplete="street-address" placeholder="Số nhà, tên đường" aria-invalid={Boolean(errors.address)} className={cn(field, "h-[52px]")} />
              {errors.address && <FieldError>{errors.address.message}</FieldError>}
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={fieldBox}>
                <span className={label}>Tỉnh / thành</span>
                <input {...register("province")} autoComplete="address-level1" placeholder="TP. Hồ Chí Minh" className={cn(field, "h-[52px]")} />
              </label>
              <label className={fieldBox}>
                <span className={label}>Quận / huyện</span>
                <input {...register("district")} autoComplete="address-level2" className={cn(field, "h-[52px]")} />
              </label>
            </div>
            <label className={fieldBox}>
              <span className={label}>Phường / xã</span>
              <input {...register("ward")} className={cn(field, "h-[52px]")} />
            </label>
            <label className={fieldBox}>
              <span className={label}>Ghi chú (tùy chọn)</span>
              <textarea {...register("note")} rows={2} placeholder="Ví dụ: gọi trước khi giao" className={cn(field, "min-h-24 resize-y py-3")} />
              {errors.note && <FieldError>{errors.note.message}</FieldError>}
            </label>
          </section>

          <section className={cn(card, "grid gap-4")}>
            <h2 className="text-[22px] font-extrabold tracking-[-0.02em]">Thanh toán</h2>
            {methods.map((m) => (
              <label
                key={m}
                className={cn(
                  "flex cursor-pointer items-start gap-4 rounded-[14px] border-2 px-5 py-[18px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                  method === m ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-ink",
                )}
              >
                <input type="radio" value={m} {...register("paymentMethod")} className="sr-only" />
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2",
                    method === m ? "border-accent after:size-2.5 after:rounded-full after:bg-accent" : "border-ink",
                  )}
                />
                <span className="grid gap-0.5">
                  <b className="text-base font-semibold">{PAYMENT_METHOD_LABEL[m]}</b>
                  <span className="text-sm leading-relaxed text-muted">
                    {m === "cod" ? "Trả tiền mặt cho người giao hàng." : "Thẻ ATM, QR ngân hàng. Môi trường thử nghiệm, không trừ tiền thật."}
                  </span>
                </span>
                {m === "vnpay" && <span className="ml-auto self-center rounded-full bg-turmeric px-2.5 py-1 text-xs font-semibold">SANDBOX</span>}
              </label>
            ))}
            {method === "vnpay" && config && (
              <p className="text-[13px] leading-relaxed text-muted">
                Bạn sẽ được chuyển sang trang thanh toán thử của VNPay. Đơn được giữ {config.orderExpiryMinutes} phút, quá hạn sẽ tự hủy.
              </p>
            )}
          </section>
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-24">
          <div className={cn(card, "grid gap-3.5")}>
            <h2 className="text-xl font-extrabold tracking-[-0.02em]">Tóm tắt đơn hàng</h2>
            <Row label="Tạm tính" value={cart ? formatVnd(cart.subtotalVnd) : "—"} />
            <Row label="Phí giao hàng" value={cart ? (cart.shippingFeeVnd === 0 ? "Miễn phí" : formatVnd(cart.shippingFeeVnd)) : "—"} />
            <div className="flex items-baseline justify-between border-t-2 border-ink pt-4">
              <span className="font-semibold">Tổng cộng</span>
              <b className="text-[32px] font-extrabold tracking-[-0.03em]">{cart ? formatVnd(cart.totalVnd) : "—"}</b>
            </div>
            {failure && (
              <p role="alert" className="rounded-xl border-2 border-danger/25 bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
                {failure}
              </p>
            )}
            <button
              type="submit"
              disabled={!canOrder || isSubmitting || busy}
              className="flex h-[60px] w-full items-center justify-between rounded-xl bg-accent px-6 text-[17px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              <span>{isSubmitting ? "Đang gửi…" : method === "vnpay" ? "Thanh toán VNPay (sandbox)" : "Đặt hàng"}</span>
              <span aria-hidden>→</span>
            </button>
            <p className="text-[13px] leading-relaxed text-muted">
              Giá và tổng tiền được máy chủ tính lại khi đặt hàng. Bằng việc đặt hàng, bạn đồng ý để shop liên hệ xác nhận qua số điện thoại.
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[15px]">
      <span className="text-muted">{label}</span>
      <b className="font-semibold">{value}</b>
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <span role="alert" className="text-[13px] font-medium text-danger">
      {children}
    </span>
  );
}

function Confirmation({ order }: { order: CheckoutOut }) {
  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-10 sm:px-8 md:grid-cols-2 md:gap-14 md:py-16">
      <div className="flex flex-col justify-between gap-10">
        <div>
          <span className="rounded-full bg-leaf-soft px-3.5 py-2 text-sm font-semibold text-leaf">Đã nhận đơn</span>
          <h1 className="mt-5 text-[clamp(44px,6vw,80px)] font-extrabold leading-[0.98] tracking-[-0.05em]">
            Đặt hàng
            <br />
            <span className="text-accent">thành công</span>
          </h1>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-muted">
            Shop sẽ gọi xác nhận trong giờ làm việc. Lưu lại mã đơn để tra cứu bất cứ lúc nào, không cần đăng nhập.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-muted">Mã đơn hàng</p>
          <p className="mt-2 select-all text-[32px] font-extrabold tracking-[0.02em]">{order.code}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/orders/lookup" className={buttonClass({ size: "lg" })}>
              Tra cứu đơn
            </Link>
            <Link href="/products" className={buttonClass({ size: "lg", variant: "outline" })}>
              Tiếp tục mua sắm
            </Link>
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <OrderSummary order={order} />
      </div>
    </div>
  );
}
