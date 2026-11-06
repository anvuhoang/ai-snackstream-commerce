import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProductForm } from "@/components/admin/product-form";
import { serverApi } from "@/lib/api/server";

export const metadata: Metadata = { title: "Thêm sản phẩm · Quản trị" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const api = await serverApi();
  const { data: categories } = await api.GET("/api/admin/catalog/categories");
  if (!categories) throw new Error("Could not load categories");

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href="/admin/products" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ChevronLeft className="size-4" /> Sản phẩm
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Thêm sản phẩm</h1>
        <p className="text-muted">Sản phẩm mới ở trạng thái nháp. Bạn có thể thêm ảnh và các quy cách khác sau khi tạo.</p>
      </div>
      <ProductForm categories={categories} />
    </div>
  );
}
