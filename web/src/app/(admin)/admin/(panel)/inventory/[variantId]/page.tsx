import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/api/server";
import { formatDateTime } from "@/lib/format";
import { MOVEMENT_LABEL } from "@/lib/inventory";

export const metadata: Metadata = { title: "Lịch sử kho · Quản trị" };
export const dynamic = "force-dynamic";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export default async function StockHistoryPage({ params }: { params: Promise<{ variantId: string }> }) {
  const id = Number.parseInt((await params).variantId, 10);
  if (!Number.isInteger(id) || id < 1) notFound();

  const api = await serverApi();
  const { data, response } = await api.GET("/api/admin/inventory/{variant_id}/movements", { params: { path: { variant_id: id } } });
  if (response.status === 404) notFound();
  if (!data) throw new Error("Could not load the stock history");

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href="/admin/inventory" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ChevronLeft className="size-4" /> Kho
        </Link>
        <h1 className="mt-2 text-2xl font-medium tracking-wide">Lịch sử tồn kho</h1>
        <p className="mt-1 text-xs text-muted">50 thay đổi gần nhất của biến thể này.</p>
      </div>

      {data.length === 0 ? (
        <p className="border border-dashed border-line p-12 text-center text-sm text-muted">Chưa có thay đổi nào.</p>
      ) : (
        <div className="overflow-x-auto border border-line bg-surface">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.04em] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Lúc</th>
                <th className="px-4 py-3 font-medium">Loại</th>
                <th className="px-4 py-3 text-right font-medium">Tồn kho</th>
                <th className="px-4 py-3 text-right font-medium">Giữ chỗ</th>
                <th className="px-4 py-3 font-medium">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className="border-b border-hair last:border-0">
                  <td className="px-4 py-3 text-xs text-muted">{formatDateTime(m.createdAt)}</td>
                  <td className="px-4 py-3">{MOVEMENT_LABEL[m.kind] ?? m.kind}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{m.deltaOnHand === 0 ? "—" : signed(m.deltaOnHand)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{m.deltaReserved === 0 ? "—" : signed(m.deltaReserved)}</td>
                  <td className="px-4 py-3 text-xs text-muted">{[m.orderCode, m.actorEmail, m.note].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
