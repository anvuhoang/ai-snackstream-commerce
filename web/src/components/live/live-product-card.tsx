"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { ProductImage } from "@/components/store/product-image";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/browser";
import type { ProductDetail } from "@/lib/catalog";
import { formatVnd } from "@/lib/format";
import { liveCatalogError } from "@/lib/live/catalog";

// Parent keys this component by session/SKU so a stale lookup never labels another SKU.
export function LiveProductCard({ sku, ended }: { sku: string; ended: boolean }) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const cart = useCart();
  useEffect(() => {
    const controller = new AbortController();
    void browserApi.GET("/api/live/products/{sku}", {
      params: { path: { sku } }, signal: controller.signal,
    }).then(({ data, error }) => {
      if (controller.signal.aborted) return;
      if (data) setProduct(data);
      else setError(liveCatalogError(error));
    }).catch(() => {
      if (!controller.signal.aborted) setError("Không kết nối được dữ liệu sản phẩm.");
    });
    return () => controller.abort();
  }, [sku]);
  const variant = product?.variants.find(v => v.sku === sku);
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!product) return <p role="status" className="text-sm text-muted">Đang tải sản phẩm…</p>;
  if (!variant) return <p role="alert">Sản phẩm này hiện không còn bán.</p>;
  const blocked = ended || cart.busy || variant.stockStatus === "out" || variant.stockStatus === "unknown";
  // Leave room for the shop's floating chat without changing the shared launcher.
  return <aside data-testid="live-product-card" className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-xl border border-line p-3 lg:grid-cols-[72px_minmax(0,1fr)_auto] lg:pr-60">
    <ProductImage image={product.images[0]} name={product.name} sizes="72px" className="w-16 rounded-lg lg:w-18" />
    <div className="grid min-w-0 gap-1">
      <h3 className="font-semibold">{product.name}</h3>
      <p className="text-sm text-muted">{variant.name} · {variant.sku}</p>
      <p className="font-bold">{formatVnd(variant.priceVnd)} {variant.compareAtVnd ? <s className="text-sm font-normal text-muted">{formatVnd(variant.compareAtVnd)}</s> : null}</p>
      {product.isDemo && <p className="text-sm text-muted">Dữ liệu sản phẩm mẫu</p>}
      {variant.stockStatus === "out" && <p className="text-sm text-danger">Hết hàng</p>}
      {variant.stockStatus === "unknown" && <p className="text-sm text-muted">Liên hệ shop để xác nhận tồn kho</p>}
      {variant.stockStatus === "low" && <p className="text-sm text-muted">Chỉ còn {variant.available}</p>}
    </div>
    <div className="col-span-2 flex flex-wrap items-center gap-3 lg:col-span-1">
      <Link data-testid="live-product-link" href={`/products/${product.slug}`} className="border-b-2 border-accent font-semibold">Xem sản phẩm</Link>
      <Button data-testid="live-add-to-cart" type="button" disabled={blocked} onClick={async () => setAdded(await cart.add(variant.id, 1))}>
        {cart.busy ? "Đang thêm…" : added ? "Đã thêm vào giỏ" : "Thêm vào giỏ"}
      </Button>
    </div>
    {cart.error && <p role="alert" className="col-span-2 text-sm text-danger lg:col-span-3">{cart.error}</p>}
  </aside>;
}
