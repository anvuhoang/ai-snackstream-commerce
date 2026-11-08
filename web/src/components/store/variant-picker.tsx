"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { cn } from "@/lib/cn";
import type { ProductDetail } from "@/lib/catalog";
import { formatVnd } from "@/lib/format";
import { track } from "@/lib/track";

/** Choose a variant (size / pack) as ruled rows, pick a quantity and put it in the cart. */
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
    <div>
      <fieldset>
        <legend className="sr-only">Quy cách</legend>
        {variants.map((v) => (
          <label
            key={v.id}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-6 border-b border-line px-6 py-[18px] text-xs transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ink",
              v.id === selected.id ? "bg-canvas" : "hover:bg-[#fafaf9]",
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
            <span>
              <b className="block text-[13px] font-medium">{v.name}</b>
              <span className="text-[11px] text-muted">
                {v.sku}
                {v.weightG ? ` · ${v.weightG} g` : ""}
              </span>
            </span>
            <span className="text-right font-medium">
              {formatVnd(v.priceVnd)}
              {v.compareAtVnd ? <s className="ml-2 font-normal text-muted">{formatVnd(v.compareAtVnd)}</s> : null}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4 text-xs">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">Số lượng</span>
        <div className="flex h-8 items-center border border-line">
          <button type="button" aria-label="Giảm" onClick={() => change(qty - 1)} className="size-[30px] text-base hover:bg-ink hover:text-white">
            −
          </button>
          <output aria-live="polite" className="w-8 text-center">
            {qty}
          </output>
          <button type="button" aria-label="Tăng" onClick={() => change(qty + 1)} className="size-[30px] text-base hover:bg-ink hover:text-white">
            +
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={addToCart}
        disabled={busy}
        className={cn(
          "flex h-14 w-full items-center justify-between px-6 text-xs font-medium uppercase tracking-[0.04em] transition-colors disabled:opacity-60",
          added ? "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-ink)]" : "bg-ink text-white hover:bg-brand-hover",
        )}
      >
        <span>{added ? "Đã thêm vào giỏ" : "Thêm vào giỏ"}</span>
        <span>{formatVnd(selected.priceVnd * qty)}</span>
      </button>
      {error && (
        <p role="alert" className="border-b border-line px-6 py-3 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-4 border-b border-line px-6 py-4 text-[11px] leading-[1.7]">
        {added ? (
          <Link href="/checkout" className="border-b border-current font-medium">
            Xem giỏ hàng và thanh toán →
          </Link>
        ) : (
          <b className="font-medium">Miễn phí giao từ 300.000đ</b>
        )}
        {shopeeUrl ? (
          <a
            href={shopeeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("shopee_click", { sku: selected.sku })}
            className="border-b border-current"
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
