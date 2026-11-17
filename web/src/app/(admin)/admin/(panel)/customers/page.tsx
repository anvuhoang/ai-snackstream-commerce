import { Search } from "lucide-react";
import type { Metadata } from "next";
import { CustomerToggle } from "@/components/admin/customer-toggle";
import { Pagination } from "@/components/store/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { serverApi } from "@/lib/api/server";
import { query } from "@/lib/catalog";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Khách hàng · Quản trị" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
type Search = { q?: string; page?: string };

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.min(10_000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));

  const api = await serverApi();
  const { data } = await api.GET("/api/admin/customers", { params: { query: { q, page, pageSize: PAGE_SIZE } } });
  if (!data) throw new Error("Could not load customers");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[clamp(34px,4vw,56px)] font-extrabold leading-[1.05] tracking-[-0.04em]">Khách hàng</h1>
        <p className="mt-2 text-xs text-muted">{data.total} tài khoản. Khách vãng lai đặt hàng trước khi có tài khoản không nằm trong danh sách này.</p>
      </div>

      <form action="/admin/customers" role="search" className="flex gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            name="q"
            defaultValue={q}
            placeholder="E-mail, tên, số điện thoại…"
            aria-label="Tìm khách hàng"
            className="h-10 w-72 rounded-xl border-2 border-line bg-surface pl-9 pr-3 text-sm focus:bg-canvas focus:outline-none"
          />
        </div>
        <Button type="submit" size="sm" variant="outline" className="h-10">
          Tìm
        </Button>
      </form>

      {data.items.length === 0 ? (
        <p className="rounded-[20px] border-2 border-dashed border-line p-12 text-center text-sm text-muted">
          {q ? "Không có khách khớp từ khoá." : "Chưa có khách nào đăng ký."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-line bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.04em] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Khách hàng</th>
                <th className="px-4 py-3 font-medium">Số điện thoại</th>
                <th className="px-4 py-3 text-right font-medium">Đơn</th>
                <th className="px-4 py-3 font-medium">E-mail</th>
                <th className="px-4 py-3 font-medium">Tài khoản</th>
                <th className="px-4 py-3 font-medium">Đăng ký lúc</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-b border-hair last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <span className="font-medium">{c.fullName}</span>
                    <span className="block text-xs text-muted">{c.email}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">{c.phone || "–"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.orderCount}</td>
                  <td className="px-4 py-3">
                    <Badge tone={c.emailVerified ? "ok" : "warn"}>{c.emailVerified ? "Đã xác nhận" : "Chưa xác nhận"}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={c.isActive ? "ok" : "danger"}>{c.isActive ? "Đang hoạt động" : "Đã khoá"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{formatDateTime(c.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <CustomerToggle id={c.id} email={c.email} isActive={c.isActive} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(p) => `/admin/customers${query({ q, page: p > 1 ? p : undefined })}`} />
    </div>
  );
}
