import type { Metadata } from "next";
import { api, filterQuery, type SP } from "@/lib/api";
import type { Row, Step, Summary } from "@/lib/types";
import { fi, fp } from "@/lib/format";
import { targetState } from "@/lib/labels";
import { A, ContentCell, DistBadge, Empty, ExportBtn, LevelBadge, Plat, R } from "@/components/ui";
import { Page } from "@/components/Page";
import { Kpi, Kpis, KV } from "@/components/Kpi";
import { Reveal } from "@/components/Reveal";
import { FunnelView } from "@/components/FunnelView";

export const metadata: Metadata = { title: "Nguồn ngoài" };

type Ext = {
  direct: { rows: Row[]; summary: Summary | null };
  viaWeb: { rows: Row[]; summary: Summary | null; funnel: Step[] };
};

export default async function ExternalPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const d = await api<Ext>("/api/external", sp);
  const qs = filterQuery(sp);
  const sd = d.direct.summary;
  return (
    <Page title="Nguồn ngoài: TikTok & Facebook" lede="Hiệu quả kéo khách từ ngoài vào Shopee hoặc website. Khách không bắt buộc đi qua website; mỗi nội dung ghi rõ mức xác định được chuyển đổi."
      actions={<ExportBtn name="noi_dung" qs={qs} />}>
      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Mức xác định chuyển đổi</h2><p className="sub">Đọc kết quả theo đúng mức này, đừng suy diễn đơn hàng khi nguồn không theo dõi được.</p></div></div>
        <div className="card-b">
          <div className="row note" style={{ gap: 14 }}>
            <span><span className="badge">Biết đến</span> chỉ có lượt xem/tương tác</span>
            <span><span className="badge" data-k="click">Biết click</span> có click ra ngoài, không nối được đơn</span>
            <span><span className="badge" data-k="visit">Biết lượt đến</span> có lượt vào website kèm nguồn</span>
            <span><span className="badge" data-k="order">Xác định được đơn</span> nối được tới đơn (link affiliate, mã giảm giá…)</span>
          </div>
        </div>
      </Reveal>

      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Đường 1 · TikTok / Facebook → Shopee trực tiếp</h2><p className="sub">Click ra ngoài và đơn lấy từ link theo dõi (vd. Shopee Affiliate). Lượt đến Shopee và đơn chỉ hiện khi có dữ liệu đối chiếu.</p></div></div>
        {sd && (
          <div className="card-b">
            <Kpis>
              <Kpi index={0} label="Lượt xem" color="--s1" sub="Tổng theo từng nội dung, không phải người duy nhất"><KV a={sd.views} /></Kpi>
              <Kpi index={1} label="Click ra ngoài" color="--s1"><KV a={sd.clicks} /></Kpi>
              <Kpi index={2} label="Click / lượt xem"><KV r={sd.clickPerView} kind="pct" /></Kpi>
              <Kpi index={3} label="Đơn quy" color="--s2" sub="Theo link theo dõi"><KV a={sd.orders} /></Kpi>
              <Kpi index={4} label="Chi phí / đơn" sub="Gồm hoa hồng affiliate"><KV r={sd.costPerOrder} kind="vnd" digits={0} /></Kpi>
              <Kpi index={5} label="CAC" sub="Khi xác định được khách mới" tgt={targetState("cac", sd.cac.value)} tgtText="Mục tiêu ≤ 50.000đ"><KV r={sd.cac} kind="vnd" digits={0} /></Kpi>
            </Kpis>
          </div>
        )}
        <div className="card-b flush tbl-wrap">
          {d.direct.rows.length === 0 ? <Empty title="Chưa có nội dung đi thẳng Shopee" text="Nhập danh mục với destination = shopee và platform = tiktok/facebook." /> : (
            <table className="tbl">
              <thead><tr><th>Nội dung</th><th>Nền tảng</th><th>Phân phối</th><th>KOL / link</th><th>A/B</th><th className="n">Lượt xem</th><th className="n">Tương tác</th><th className="n">Click</th><th>Mức xác định</th><th className="n">Đơn</th><th className="n">Doanh thu</th><th className="n">Chi phí</th><th className="n">Đơn / 1.000 xem</th></tr></thead>
              <tbody>
                {d.direct.rows.map((r) => (
                  <tr key={r.code}>
                    <td><ContentCell r={r} qs={qs} />{r.url && <a className="note" href={r.url} target="_blank" rel="noopener noreferrer">Mở bài ↗</a>}</td>
                    <td><Plat p={r.platform} /></td><td><DistBadge d={r.distribution} /></td>
                    <td><div>{r.kol || "—"}</div>{r.trackingLink ? <code className="note">{r.trackingLink}</code> : <span className="note">Chưa có link theo dõi</span>}</td>
                    <td className="note">{r.experiment || "—"}<br /><b style={{ color: "var(--text)" }}>{r.variant}</b></td>
                    <td className="n"><A a={r.exposure} /></td><td className="n"><A a={r.engagements} /></td><td className="n"><A a={r.clicks} /></td>
                    <td><LevelBadge l={r.attributionLevel} /></td>
                    <td className="n"><b><A a={r.orders} /></b></td><td className="n"><A a={r.revenue} kind="vnd" /></td><td className="n"><A a={r.totalCost} kind="vnd" /></td>
                    <td className="n"><R r={r.ratios.ordersPer1000} kind="dec" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>

      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Đường 2 · TikTok / Facebook → Website nhóm → Shopee</h2><p className="sub">Lượt vào website có thông tin nguồn (UTM), xem sản phẩm và click sang Shopee do website nhóm tự ghi nhận. Đơn chỉ hiện khi xác định được (vd. mã giảm giá riêng).</p></div></div>
        {d.viaWeb.funnel.length > 0 && (
          <div className="card-b">
            <FunnelView steps={d.viaWeb.funnel} />
          </div>
        )}
        <div className="card-b flush tbl-wrap">
          {d.viaWeb.rows.length === 0 ? <Empty title="Chưa có nội dung đi qua website" text="Nhập danh mục với destination = website; website nhóm ghi nhận phiên có UTM tại /shop?utm_source=…&utm_content=MÃ_NỘI_DUNG." /> : (
            <table className="tbl">
              <thead><tr><th>Nội dung</th><th>Nền tảng</th><th>Phân phối</th><th className="n">Lượt xem / hiển thị</th><th className="n">Click ra web</th><th className="n">Phiên vào web</th><th className="n">Xem sản phẩm</th><th className="n">Click sang Shopee</th><th className="n">Click Shopee / phiên</th><th>Mức xác định</th><th className="n">Đơn</th><th className="n">Chi phí</th></tr></thead>
              <tbody>
                {d.viaWeb.rows.map((r) => (
                  <tr key={r.code}>
                    <td><ContentCell r={r} qs={qs} /></td><td><Plat p={r.platform} /></td><td><DistBadge d={r.distribution} /></td>
                    <td className="n"><A a={r.exposure} /></td><td className="n"><A a={r.clicks} /></td>
                    <td className="n">{fi(r.web.sessions)}</td><td className="n">{fi(r.web.product)}</td><td className="n">{fi(r.web.clickShopee)}</td>
                    <td className="n">{r.web.sessions ? fp((r.web.clickShopee / r.web.sessions) * 100) : <span className="na" data-s="undetermined" title="Mẫu số bằng 0">Không tính được</span>}</td>
                    <td><LevelBadge l={r.attributionLevel} /></td>
                    <td className="n"><A a={r.orders} /></td><td className="n"><A a={r.totalCost} kind="vnd" /></td>
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
