"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { cn } from "@/lib/cn";
import type { ProductDetail } from "@/lib/catalog";
import { formatVnd } from "@/lib/format";
import { track } from "@/lib/track";

/** Choose a variant (size / pack) as cards, pick a quantity and put it in the cart. */
export function VariantPicker({ variants, shopeeUrl }: { variants: ProductDetail["variants"]; shopeeUrl: string }) {
  const { add, busy, error } = useCart();
  const [selectedId, setSelectedId] = useState(variants[0]?.id);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];
  if (!selected) return null;

  const change = (next: number) => {
    setQty(Math.min(99, Math.max(1, next)));
    setAdded(false);
  };

  async function addToCart() {
    if (!selected) return;
    const ok = await add(selected.id, qty);
    setAdded(ok);
    if (ok) track("add_to_cart", { sku: selected.sku, qty, surface: "store" });
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <b className="text-4xl font-extrabold tracking-[-0.03em]">{formatVnd(selected.priceVnd)}</b>
        {selected.compareAtVnd ? <s className="text-base text-muted">{formatVnd(selected.compareAtVnd)}</s> : null}
        <span className="text-sm text-muted">Giá của quy cách đang chọn</span>
      </div>

      <fieldset className="grid gap-2.5">
        <legend className="mb-2.5 text-sm font-semibold">Quy cách</legend>
        {variants.map((v) => (
          <label
            key={v.id}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-4 rounded-[14px] border-2 px-5 py-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
              v.id === selected.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-ink",
            )}
          >
            <input
              type="radio"
              name="variant"
              value={v.id}
              checked={v.id === selected.id}
              onChange={() => {
                setSelectedId(v.id);
                setAdded(false);
              }}
              className="sr-only"
            />
            <span className="grid gap-0.5">
              <b className="text-base font-semibold">{v.name}</b>
              <span className="text-[13px] text-muted">
                {v.sku}
                {v.weightG ? ` · ${v.weightG} g` : ""}
              </span>
            </span>
            <span className="text-right text-[17px] font-extrabold">
              {formatVnd(v.priceVnd)}
              {v.compareAtVnd ? <s className="ml-2 text-sm font-normal text-muted">{formatVnd(v.compareAtVnd)}</s> : null}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-14 items-center overflow-hidden rounded-xl border-2 border-ink bg-surface">
          <button type="button" aria-label="Giảm" onClick={() => change(qty - 1)} className="h-full w-12 text-xl font-semibold transition-colors hover:bg-canvas">
            −
          </button>
          <output aria-live="polite" className="w-10 text-center font-semibold">
            {qty}
          </output>
          <button type="button" aria-label="Tăng" onClick={() => change(qty + 1)} className="h-full w-12 text-xl font-semibold transition-colors hover:bg-canvas">
            +
          </button>
        </div>
        <button
          type="button"
          onClick={addToCart}
          disabled={busy}
          className={cn(
            "flex h-14 min-w-0 flex-1 items-center justify-between gap-4 rounded-xl border-2 px-6 text-base font-semibold transition-colors disabled:opacity-60",
            added ? "border-ink bg-surface text-ink" : "border-accent bg-accent text-white hover:bg-accent-hover",
          )}
        >
          <span>{added ? "Đã thêm vào giỏ" : "Thêm vào giỏ"}</span>
          <span>{formatVnd(selected.priceVnd * qty)}</span>
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border-2 border-danger/25 bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-canvas px-5 py-3.5 text-sm">
        {added ? (
          <Link href="/checkout" className="border-b-2 border-accent font-semibold">
            Xem giỏ hàng và thanh toán →
          </Link>
        ) : (
          <b className="font-semibold">Miễn phí giao từ 300.000đ</b>
        )}
        {shopeeUrl ? (
          <a
            href={shopeeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("shopee_click", { sku: selected.sku })}
            className="border-b-2 border-accent font-semibold"
          >
            Mua trên Shopee ↗
          </a>
        ) : (
          <span className="text-muted">Thanh toán khi nhận hàng hoặc VNPay sandbox.</span>
        )}
      </div>
    </div>
  );
}
