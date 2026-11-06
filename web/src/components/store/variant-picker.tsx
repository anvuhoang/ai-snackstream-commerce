"use client";

import { ExternalLink, ShoppingBasket } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ProductDetail } from "@/lib/catalog";
import { Price } from "./price";

/** Choose a variant (size / pack); the price follows the choice. The cart arrives in Phase 2. */
export function VariantPicker({ variants, shopeeUrl }: { variants: ProductDetail["variants"]; shopeeUrl: string }) {
  const [selectedId, setSelectedId] = useState(variants[0]?.id);
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];
  if (!selected) return null;

  return (
    <div className="grid gap-5">
      <Price vnd={selected.priceVnd} compareAt={selected.compareAtVnd} size="lg" />

      {variants.length > 1 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Quy cách</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <label
                key={v.id}
                className={cn(
                  "cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand",
                  v.id === selected.id ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface hover:border-muted",
                )}
              >
                <input type="radio" name="variant" value={v.id} checked={v.id === selected.id} onChange={() => setSelectedId(v.id)} className="sr-only" />
                {v.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <div className="flex gap-1.5">
          <dt>Mã SKU:</dt>
          <dd className="font-mono text-ink">{selected.sku}</dd>
        </div>
        {selected.weightG ? (
          <div className="flex gap-1.5">
            <dt>Khối lượng:</dt>
            <dd className="text-ink">{selected.weightG} g</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled title="Giỏ hàng sẽ có ở giai đoạn 2">
          <ShoppingBasket className="size-5" /> Thêm vào giỏ
        </Button>
        {shopeeUrl && (
          <a
            href={shopeeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-6 text-base font-semibold hover:bg-canvas"
          >
            Mua trên Shopee <ExternalLink className="size-4" />
          </a>
        )}
      </div>
      <p className="text-xs text-muted">Giỏ hàng và thanh toán đang được xây dựng.</p>
    </div>
  );
}
