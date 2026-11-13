import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ProductCard as Card } from "@/lib/catalog";
import { formatVnd } from "@/lib/format";
import { ProductImage } from "./product-image";

/** One ruled cell of the shop grid: name and price on top, the product below. The grid draws the outer lines. */
export function ProductCard({ product, priority = false }: { product: Card; priority?: boolean }) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col border-b border-r border-line bg-canvas transition-colors hover:bg-[#e8e8e5]"
    >
      <div className="flex justify-between gap-3 px-4 py-4 text-[11px] font-medium uppercase tracking-[0.04em]">
        <span>
          {product.name}
          <span className="opacity-50"> —</span>
        </span>
        <span className="shrink-0">
          {product.variantCount > 1 ? "Từ " : ""}
          {formatVnd(product.priceFromVnd)}
        </span>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <ProductImage
          image={product.image}
          name={product.name}
          seed={product.id}
          priority={priority}
          className="bg-transparent transition-transform duration-700 ease-out group-hover:-translate-y-2 group-hover:scale-105"
        />
        {product.isDemo && (
          <span className="absolute bottom-3 left-4">
            <Badge tone="warn">Demo</Badge>
          </span>
        )}
      </div>
    </Link>
  );
}
