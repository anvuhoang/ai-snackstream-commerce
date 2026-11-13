"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { ProductDetail } from "@/lib/catalog";
import { formatVnd } from "@/lib/format";

/** Choose a variant (size / pack) as ruled rows; the cart arrives in Phase 2, so the add button stays off for now. */
export function VariantPicker({ variants, shopeeUrl }: { variants: ProductDetail["variants"]; shopeeUrl: string }) {
  const [selectedId, setSelectedId] = useState(variants[0]?.id);
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];
  if (!selected) return null;

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
            <input type="radio" name="variant" value={v.id} checked={v.id === selected.id} onChange={() => setSelectedId(v.id)} className="sr-only" />
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

      <button
        type="button"
        disabled
        title="Giỏ hàng sẽ có ở giai đoạn 2"
        className="flex h-14 w-full items-center justify-between bg-ink px-6 text-xs font-medium uppercase tracking-[0.04em] text-white disabled:opacity-40"
      >
        <span>Thêm vào giỏ</span>
        <span>{formatVnd(selected.priceVnd)}</span>
      </button>
      <div className="flex flex-wrap justify-between gap-4 border-b border-line px-6 py-4 text-[11px] leading-[1.7]">
        <b className="font-medium">Giỏ hàng đang được xây dựng</b>
        {shopeeUrl ? (
          <a href={shopeeUrl} target="_blank" rel="noopener noreferrer" className="border-b border-current">
            Mua trên Shopee ↗
          </a>
        ) : (
          <span className="text-muted">Thanh toán sẽ có ở giai đoạn 2.</span>
        )}
      </div>
    </div>
  );
}
