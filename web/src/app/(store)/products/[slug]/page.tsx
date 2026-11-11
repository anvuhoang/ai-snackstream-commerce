import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TrackOnMount } from "@/components/analytics/tracker";
import { ProductImage } from "@/components/store/product-image";
import { VariantPicker } from "@/components/store/variant-picker";
import { Badge } from "@/components/ui/badge";
import { serverApi } from "@/lib/api/server";
import { categoryStyle } from "@/lib/category-style";
import { cn } from "@/lib/cn";

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
    <details open={defaultOpen} className="group border-t border-line last:border-b">
      <summary className="flex cursor-pointer list-none items-center justify-between py-5 text-base font-semibold [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-2xl font-medium leading-none text-accent group-open:hidden">+</span>
        <span className="hidden text-2xl font-medium leading-none text-accent group-open:inline">−</span>
      </summary>
      <div className="max-w-xl pb-5 text-[15px] leading-relaxed text-muted">{children}</div>
    </details>
  );
}

export default async function ProductPage({ params }: Props) {
  const p = await load((await params).slug);
  const prices = p.variants.map((v) => v.priceVnd);
  const style = categoryStyle(p.category?.slug);

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
    <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 pb-4 pt-6 sm:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <nav aria-label="Đường dẫn" className="text-sm text-muted">
        <Link href="/" className="border-b border-muted">
          Trang chủ
        </Link>{" "}
        /{" "}
        <Link href="/products" className="border-b border-muted">
          Cửa hàng
        </Link>{" "}
        / <span className="text-ink">{p.name}</span>
      </nav>

      <div className="grid items-start gap-8 md:grid-cols-2 lg:gap-14">
        <div className="grid gap-3.5 md:sticky md:top-24">
          <div className={cn("overflow-hidden rounded-[28px]", style.stage)}>
            <ProductImage image={p.images[0]} name={p.name} priority sizes="(min-width: 768px) 50vw, 100vw" className="bg-transparent" />
          </div>
          {p.images.length > 1 && (
            <ul className="flex gap-3">
              {p.images.slice(0, 5).map((img, i) => (
                <li key={img.id} className={cn("size-20 overflow-hidden rounded-[14px] border-[3px]", i === 0 ? "border-accent" : "border-transparent")}>
                  <ProductImage image={img} name={p.name} sizes="80px" className="size-full" />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-6">
          <div className="grid gap-3">
            {p.category && (
              <Link href={`/products?category=${p.category.slug}`} className={cn("w-fit rounded-full px-3 py-1.5 text-[13px] font-semibold", style.stage, style.label)}>
                {p.category.name}
              </Link>
            )}
            <h1 className="text-[clamp(32px,4.4vw,46px)] font-extrabold leading-[1.05] tracking-[-0.04em]">{p.name}</h1>
            {p.description && <p className="text-base leading-relaxed text-muted">{p.description}</p>}
            {p.isDemo && (
              <div>
                <Badge tone="warn">Sản phẩm demo</Badge>
              </div>
            )}
          </div>

          <TrackOnMount event="product_view" sku={p.variants[0]?.sku} />
          <VariantPicker variants={p.variants} shopeeUrl={p.shopeeUrl} />

          <div>
            <Accordion title="Thành phần" defaultOpen>
              {p.ingredients}
            </Accordion>
            <Accordion title="Bảo quản">{p.storage}</Accordion>
            <Accordion title="Dị ứng">Nếu bạn có dị ứng thực phẩm, hãy đối chiếu thành phần trên bao bì sản phẩm trước khi dùng.</Accordion>
          </div>
        </div>
      </div>
    </div>
  );
}
