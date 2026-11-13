import type { Metadata } from "next";
import { CategoriesManager } from "@/components/admin/categories-manager";
import { serverApi } from "@/lib/api/server";

export const metadata: Metadata = { title: "Danh mục · Quản trị" };
export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const api = await serverApi();
  const { data } = await api.GET("/api/admin/catalog/categories");
  if (!data) throw new Error("Could not load categories");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Danh mục</h1>
        <p className="text-muted">Khách lọc sản phẩm theo danh mục. Danh mục không có sản phẩm đang bán sẽ không hiện ở cửa hàng.</p>
      </div>
      <CategoriesManager categories={data} />
    </div>
  );
}
