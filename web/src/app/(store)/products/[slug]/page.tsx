import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImage } from "@/components/store/product-image";
import { VariantPicker } from "@/components/store/variant-picker";
import { Badge } from "@/components/ui/badge";
import { serverApi } from "@/lib/api/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const api = await serverApi();
  const { data, response } = await api.GET("/api/catalog/products/{slug}", { params: { path: { slug } } });
  if (response.status === 404) notFound();
  if (!data) throw new Error("Could not load the product");
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).slug);
  return { title: p.name, description: p.description.slice(0, 160) || undefined };
}

export default async function ProductPage({ params }: Props) {
  const p = await load((await params).slug);
  const prices = p.variants.map((v) => v.priceVnd);

  // Structured data so search engines can show the price. "<" is escaped so the text can never close the script tag.
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description,
    sku: p.variants[0]?.sku,
    image: p.images.map((i) => i.url),
    offers: { "@type": "AggregateOffer", priceCurrency: "VND", lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: p.variants.length },
  }).replace(/</g, "\\u003c");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <nav aria-label="Đường dẫn" className="flex flex-wrap items-center gap-1 text-sm text-muted">
        <Link href="/products" className="hover:text-ink">
          Sản phẩm
        </Link>
        {p.category && (
          <>
            <ChevronRight className="size-4" />
            <Link href={`/products?category=${p.category.slug}`} className="hover:text-ink">
              {p.category.name}
            </Link>
          </>
        )}
        <ChevronRight className="size-4" />
        <span className="text-ink">{p.name}</span>
      </nav>

      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div className="grid gap-3">
          <ProductImage image={p.images[0]} name={p.name} seed={p.id} priority sizes="(min-width: 768px) 50vw, 100vw" className="rounded-[var(--radius-card)] border border-line" />
          {p.images.length > 1 && (
            <ul className="grid grid-cols-4 gap-2">
              {p.images.slice(1, 5).map((img) => (
                <li key={img.id}>
                  <ProductImage image={img} name={p.name} sizes="12vw" className="rounded-lg border border-line" />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid content-start gap-6">
          <div>
            <div className="flex items-center gap-2">
              {p.category && <span className="text-sm text-muted">{p.category.name}</span>}
              {p.isDemo && <Badge tone="warn">Sản phẩm demo</Badge>}
            </div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{p.name}</h1>
            {p.description && <p className="mt-3 text-muted">{p.description}</p>}
          </div>

          <VariantPicker variants={p.variants} shopeeUrl={p.shopeeUrl} />

          <section aria-labelledby="ingredients" className="grid gap-4 border-t border-line pt-6">
            <div>
              <h2 id="ingredients" className="text-sm font-bold uppercase tracking-wide text-muted">
                Thành phần
              </h2>
              <p className="mt-1">{p.ingredients}</p>
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Bảo quản</h2>
              <p className="mt-1">{p.storage}</p>
            </div>
            <p className="text-xs text-muted">Nếu bạn có dị ứng thực phẩm, hãy đối chiếu thành phần trên bao bì sản phẩm trước khi dùng.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
