import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TrackOnMount } from "@/components/analytics/tracker";
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

function Accordion({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group border-b border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-[18px] text-[11px] font-medium uppercase tracking-[0.04em] [&::-webkit-details-marker]:hidden">
        {title}
        <span className="group-open:hidden">+</span>
        <span className="hidden group-open:inline">−</span>
      </summary>
      <div className="max-w-xl px-6 pb-5 text-xs leading-relaxed">{children}</div>
    </details>
  );
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
    <div className="grid md:min-h-[calc(100vh-34px)] md:grid-cols-2">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <div className="relative border-b border-line bg-canvas md:border-b-0 md:border-r">
        <nav aria-label="Đường dẫn" className="absolute left-6 top-[18px] z-10 text-[11px] font-medium uppercase tracking-[0.04em]">
          <Link href="/products" className="text-muted hover:text-ink">
            Cửa hàng /
          </Link>{" "}
          {p.category ? (
            <Link href={`/products?category=${p.category.slug}`} className="hover:underline">
              {p.category.name}
            </Link>
          ) : (
            p.name
          )}
        </nav>
        <div className="sticky top-[34px]">
          <ProductImage
            image={p.images[0]}
            name={p.name}
            priority
            sizes="(min-width: 768px) 50vw, 100vw"
            className="aspect-auto h-[70vh] min-h-[460px] bg-transparent md:h-[calc(100vh-34px)]"
          />
        </div>
        {p.images.length > 1 && (
          <ul className="grid grid-cols-4 border-t border-line">
            {p.images.slice(1, 5).map((img) => (
              <li key={img.id} className="border-r border-line last:border-r-0">
                <ProductImage image={img} name={p.name} sizes="12vw" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col">
        <div className="border-b border-line p-6">
          <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em]">{p.name}</h1>
          {p.description && <p className="mt-3.5 max-w-lg text-xs leading-relaxed">{p.description}</p>}
          {p.isDemo && (
            <div className="mt-4">
              <Badge tone="warn">Sản phẩm demo</Badge>
            </div>
          )}
        </div>

        <TrackOnMount event="product_view" sku={p.variants[0]?.sku} />
        <VariantPicker variants={p.variants} shopeeUrl={p.shopeeUrl} />

        <Accordion title="Thành phần" defaultOpen>
          {p.ingredients}
        </Accordion>
        <Accordion title="Bảo quản">{p.storage}</Accordion>
        <Accordion title="Dị ứng">
          Nếu bạn có dị ứng thực phẩm, hãy đối chiếu thành phần trên bao bì sản phẩm trước khi dùng.
        </Accordion>
      </div>
    </div>
  );
}
