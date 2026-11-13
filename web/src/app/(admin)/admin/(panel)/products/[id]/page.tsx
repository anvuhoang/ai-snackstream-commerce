import { ChevronLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImagesEditor } from "@/components/admin/images-editor";
import { ProductForm } from "@/components/admin/product-form";
import { StatusActions } from "@/components/admin/status-actions";
import { VariantsEditor } from "@/components/admin/variants-editor";
import { serverApi } from "@/lib/api/server";

export const metadata: Metadata = { title: "Sửa sản phẩm · Quản trị" };
export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(id) || id < 1) notFound();

  const api = await serverApi();
  const [product, categories] = await Promise.all([
    api.GET("/api/admin/catalog/products/{product_id}", { params: { path: { product_id: id } } }),
    api.GET("/api/admin/catalog/categories"),
  ]);
  if (product.response.status === 404) notFound();
  if (!product.data || !categories.data) throw new Error("Could not load the product");
  const p = product.data;

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href="/admin/products" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ChevronLeft className="size-4" /> Sản phẩm
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight">{p.name}</h1>
          {p.status === "published" && (
            <Link href={`/products/${p.slug}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
              Xem trên cửa hàng <ExternalLink className="size-4" />
            </Link>
          )}
        </div>
        <p className="font-mono text-xs text-muted">/products/{p.slug}</p>
      </div>

      <StatusActions product={p} />
      <ProductForm product={p} categories={categories.data} />
      <VariantsEditor product={p} />
      <ImagesEditor product={p} />
    </div>
  );
}
