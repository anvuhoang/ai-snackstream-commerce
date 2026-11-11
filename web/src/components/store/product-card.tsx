import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ProductCard as Card } from "@/lib/catalog";
import { categoryStyle } from "@/lib/category-style";
import { cn } from "@/lib/cn";
import { formatVnd } from "@/lib/format";
import { ProductImage } from "./product-image";

/** One shop card: the photo on its group's colour, then group, name and price. The whole card is the link. */
export function ProductCard({ product, priority = false }: { product: Card; priority?: boolean }) {
  const style = categoryStyle(product.category?.slug);
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-18px_rgba(36,24,17,0.45)]"
    >
      <div className={cn("relative overflow-hidden", style.stage)}>
        <ProductImage
          image={product.image}
          name={product.name}
          seed={product.id}
          priority={priority}
          className={cn("bg-transparent transition-transform duration-500 ease-out group-hover:scale-105", product.soldOut && "opacity-60 grayscale")}
        />
        {product.isDemo && (
          <span className="absolute bottom-3 left-3">
            <Badge tone="warn">Demo</Badge>
          </span>
        )}
        {product.soldOut && (
          <span className="absolute right-3 top-3">
            <Badge tone="danger">Hết hàng</Badge>
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-5 pb-5 pt-4">
        {product.category && <span className={cn("text-xs font-semibold", style.label)}>{product.category.name}</span>}
        <b className="text-[17px] font-semibold leading-snug">{product.name}</b>
        <span className="mt-auto flex items-center justify-between gap-2 pt-3">
          <b className="text-lg font-extrabold">
            {product.variantCount > 1 ? <span className="mr-1 text-xs font-medium text-muted">từ</span> : null}
            {formatVnd(product.priceFromVnd)}
          </b>
          <span className="inline-flex h-10 items-center rounded-[10px] bg-ink px-4 text-sm font-semibold text-paper transition-colors group-hover:bg-accent">
            {product.variantCount > 1 ? "Chọn" : "Xem"}
          </span>
        </span>
      </div>
    </Link>
  );
}
