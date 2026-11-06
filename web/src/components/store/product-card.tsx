import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ProductCard as Card } from "@/lib/catalog";
import { Price } from "./price";
import { ProductImage } from "./product-image";

export function ProductCard({ product, priority = false }: { product: Card; priority?: boolean }) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="overflow-hidden">
        <ProductImage
          image={product.image}
          name={product.name}
          seed={product.id}
          priority={priority}
          className="transition duration-300 group-hover:scale-105"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-center gap-2 text-xs text-muted">
          {product.category && <span>{product.category.name}</span>}
          {product.isDemo && <Badge tone="warn">Demo</Badge>}
        </div>
        <h3 className="font-bold leading-snug group-hover:text-brand">{product.name}</h3>
        <div className="mt-auto pt-1">
          <Price vnd={product.priceFromVnd} compareAt={product.compareAtFromVnd} prefix={product.variantCount > 1 ? "Từ" : undefined} />
        </div>
      </div>
    </Link>
  );
}
