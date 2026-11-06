import type { Metadata } from "next";
import Link from "next/link";
import { Upload } from "lucide-react";
import { api } from "@/lib/api";
import type { Product } from "@/lib/types";
import { dmyHm, fv } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/labels";
import { DemoTag, Empty, ExtLink, Notice, Stock } from "@/components/ui";
import { Page } from "@/components/Page";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = { title: "Sản phẩm & SKU" };
const SRC: Record<string, string> = { demo: "Demo", csv: "CSV/Excel", odoo: "Odoo" };

export default async function ProductsPage() {
  const d = await api<{ products: Product[]; odoo: { api: string; note: string } }>("/api/products");
  return (
    <Page title="Sản phẩm & SKU" lede="Danh sách SKU, giá, tồn kho và nguồn dữ liệu. Đọc từ Odoo khi kết nối; trong lúc chờ dùng dữ liệu thử có nhãn." filters={false}
      actions={<Link className="btn" href="/data#import"><Upload size={16} /> Nhập danh sách SKU</Link>}>
      <Notice kind="warn"><b>Odoo: {STATUS_LABEL[d.odoo.api === "connected" ? "value" : "not_connected"]}.</b> {d.odoo.note} Cấu trúc sản phẩm dùng các trường tương ứng với proposal (<code>x_spice_level</code>, <code>x_flavor</code>, <code>x_shelf_life</code>, <code>x_flash_sale_price</code>, <code>list_price</code>, <code>qty_available</code>).</Notice>
      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>{d.products.length} sản phẩm</h2></div></div>
        <div className="card-b flush tbl-wrap">
          {d.products.length === 0 ? <Empty title="Chưa có sản phẩm" text="Nhập CSV sản phẩm hoặc nạp dữ liệu demo ở mục Quản lý dữ liệu." /> : (
            <table className="tbl">
              <thead><tr><th>SKU</th><th>Sản phẩm</th><th className="n">Giá niêm yết</th><th className="n">Giá flash sale</th><th className="n">Tồn kho</th><th>Vị / mức cay</th><th>Hạn dùng</th><th>Nguồn</th><th>Cập nhật</th><th /></tr></thead>
              <tbody>
                {d.products.map((p) => (
                  <tr key={p.sku}>
                    <td><code>{p.sku}</code></td><td><b>{p.name}</b> <DemoTag demo={p.isDemo} /></td>
                    <td className="n">{fv(p.price)}</td><td className="n">{p.flashPrice ? fv(p.flashPrice) : "—"}</td>
                    <td className="n"><Stock v={p.stock} /></td>
                    <td>{p.flavor || "—"}<div className="note">{p.spiceLevel}</div></td><td>{p.shelfLife || "—"}</td>
                    <td><span className="badge">{SRC[p.source] ?? p.source}</span></td><td className="num note">{dmyHm(p.updatedAt)}</td>
                    <td>{p.shopeeUrl && <ExtLink href={p.shopeeUrl}>Shopee</ExtLink>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>
    </Page>
  );
}
