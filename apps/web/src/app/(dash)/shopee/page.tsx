import type { Metadata } from "next";
import { api, filterQuery, type SP } from "@/lib/api";
import type { Agg, LiveSession, Product, Ratio, Row, Summary } from "@/lib/types";
import { dmy, fd, fi, fv } from "@/lib/format";
import { targetState } from "@/lib/labels";
import { A, AiBadge, Chip, ContentCell, Empty, ExportBtn, R, Stock } from "@/components/ui";
import { Page, Tabs } from "@/components/Page";
import { Kpi, Kpis, KV } from "@/components/Kpi";
import { ChartCard } from "@/components/ChartCard";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = { title: "Shopee" };

type Shop = { lines: { product: Product; visits: Agg; productViews: Agg; addToCart: Agg; atcRate: Ratio; orders: number; revenue: number; orderPerProductView: Ratio }[] };
type Live = { sessions: { row: Row; session: Pick<LiveSession, "durationMin" | "questionsReceived" | "questionsAnswered"> | null; ordersPer1000: Ratio }[] };
type Video = { videos: Row[] };
type Ads = { ads: Row[]; summary: Summary | null };

export default async function ShopeePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tab = (["shop", "live", "video", "ads"].includes(String(sp.tab)) ? String(sp.tab) : "shop") as "shop" | "live" | "video" | "ads";
  const d = await api<Record<string, unknown>>("/api/shopee", { ...sp, tab });
  const qs = filterQuery(sp);
  const tabs = [["shop", "Shop & sản phẩm"], ["live", "Shopee Live"], ["video", "Shopee Video"], ["ads", "Quảng cáo Shopee"]].map(([k, label]) => ({
    key: k, label, href: `/shopee${filterQuery(sp, { tab: k })}`,
  }));

  return (
    <Page title="Phân tích Shopee" lede="Gian hàng, Shopee Live, Shopee Video và quảng cáo. Chỉ số chưa lấy được vẫn có vị trí và ghi rõ lý do.">
      <Tabs tabs={tabs} active={tab} />
      {tab === "shop" && <ShopTab d={d as unknown as Shop} />}
      {tab === "live" && <LiveTab d={d as unknown as Live} qs={qs} />}
      {tab === "video" && <VideoTab d={d as unknown as Video} qs={qs} />}
      {tab === "ads" && <AdsTab d={d as unknown as Ads} qs={qs} />}
    </Page>
  );
}

function ShopTab({ d }: { d: Shop }) {
  const labels = d.lines.map((l) => l.product.sku);
  return (
    <>
      <div className="grid-2">
        <ChartCard index={0} title="Đơn theo SKU" sub="Lấy trực tiếp từ bảng đơn hàng (mã đơn duy nhất)." type="bar" horizontal labels={labels} datasets={[{ label: "Đơn được tính", color: "var(--s2)", data: d.lines.map((l) => l.orders) }]} />
        <ChartCard index={1} title="Doanh thu theo SKU" type="bar" horizontal kind="vnd" labels={labels} datasets={[{ label: "Doanh thu", color: "var(--s2)", data: d.lines.map((l) => l.revenue) }]} />
      </div>
      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>So sánh theo SKU</h2><p className="sub">Hành vi xem sản phẩm từ báo cáo gian hàng; đơn và doanh thu từ bảng đơn hàng.</p></div></div>
        <div className="card-b flush tbl-wrap">
          {d.lines.length === 0 ? <Empty title="Chưa có sản phẩm" text="Nhập danh sách SKU ở mục Quản lý dữ liệu." /> : (
            <table className="tbl">
              <thead><tr><th>SKU</th><th className="n">Lượt truy cập shop</th><th className="n">Xem sản phẩm</th><th className="n">Thêm giỏ</th><th className="n">Thêm giỏ / xem SP</th><th className="n">Đơn</th><th className="n">Doanh thu</th><th className="n">Đơn / xem SP</th><th className="n">Tồn kho</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.product.sku}>
                    <td><div className="cell-title"><b>{l.product.name}</b><span><code>{l.product.sku}</code> {l.product.isDemo && <span className="badge demo">DEMO</span>}</span></div></td>
                    <td className="n"><A a={l.visits} /></td><td className="n"><A a={l.productViews} /></td><td className="n"><A a={l.addToCart} /></td>
                    <td className="n"><R r={l.atcRate} /></td><td className="n"><b>{fi(l.orders)}</b></td><td className="n">{fv(l.revenue)}</td><td className="n"><R r={l.orderPerProductView} /></td>
                    <td className="n"><Stock v={l.product.stock} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>
    </>
  );
}

function LiveTab({ d, qs }: { d: Live; qs: string }) {
  return (
    <Reveal as="section" className="card">
      <div className="card-h"><div><h2>Từng phiên Shopee Live</h2><p className="sub">Đơn và doanh thu là phần nguồn ghi nhận cho phiên, không phải toàn bộ đơn của shop trong giờ live.</p></div><ExportBtn name="noi_dung" qs={qs} /></div>
      <div className="card-b flush tbl-wrap">
        {d.sessions.length === 0 ? <Empty title="Chưa có phiên live nào" text="Nhập danh mục (loại “live”) và số liệu theo ngày ở mục Quản lý dữ liệu." /> : (
          <table className="tbl">
            <thead><tr><th>Phiên</th><th>Nhóm</th><th>Thời gian</th><th className="n">Lượt xem</th><th className="n">Người xem theo nguồn</th><th className="n">Bình luận</th><th className="n">Tương tác</th><th className="n">Click SP</th><th className="n">Click / xem</th><th className="n">Đơn</th><th className="n">Đơn / 1.000 xem</th><th className="n">Doanh thu</th></tr></thead>
            <tbody>
              {d.sessions.map(({ row: r, session, ordersPer1000 }) => (
                <tr key={r.code}>
                  <td><ContentCell r={r} qs={qs} /></td><td><AiBadge g={r.aiGroup} /></td>
                  <td className="num">{dmy(r.publishedAt)}{session?.durationMin ? <div className="note">{fi(session.durationMin)} phút</div> : null}</td>
                  <td className="n"><A a={r.views} /></td>
                  <td className="n"><Chip status="not_provided" title="Cần Việt xác minh báo cáo Shopee có tách nguồn người xem không" /></td>
                  <td className="n"><A a={r.comments} /></td><td className="n"><A a={r.engagements} /></td><td className="n"><A a={r.clicks} /></td>
                  <td className="n"><R r={r.ratios.clickPerView} /></td><td className="n"><b><A a={r.orders} /></b></td><td className="n"><R r={ordersPer1000} kind="dec" /></td>
                  <td className="n"><A a={r.revenue} kind="vnd" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Reveal>
  );
}

function VideoTab({ d, qs }: { d: Video; qs: string }) {
  return (
    <Reveal as="section" className="card">
      <div className="card-h"><div><h2>Từng video Shopee Video</h2><p className="sub">Giữ chân = tổng thời gian xem ÷ lượt xem, chỉ hiện khi báo cáo có thời gian xem.</p></div><ExportBtn name="noi_dung" qs={qs} /></div>
      <div className="card-b flush tbl-wrap">
        {d.videos.length === 0 ? <Empty title="Chưa có video nào" text="Nhập danh mục (loại “video”) và số liệu theo ngày ở mục Quản lý dữ liệu." /> : (
          <table className="tbl">
            <thead><tr><th>Video</th><th>Nhóm</th><th>Biến thể A/B</th><th className="n">Lượt xem</th><th className="n">Tương tác</th><th className="n">Thời gian xem TB</th><th className="n">Click</th><th className="n">Click / xem</th><th className="n">Đơn</th><th className="n">Đơn / click</th><th className="n">Đơn / 1.000 xem</th></tr></thead>
            <tbody>
              {d.videos.map((r) => {
                const wt = r.watchTimeSec, v = r.views;
                return (
                  <tr key={r.code}>
                    <td><ContentCell r={r} qs={qs} /></td><td><AiBadge g={r.aiGroup} /></td><td className="note">{r.variant || "—"}</td>
                    <td className="n"><A a={v} /></td><td className="n"><A a={r.engagements} /></td>
                    <td className="n">{wt.value != null && v.value ? `${fd(wt.value / v.value, 1)} giây` : <Chip status={wt.value == null ? wt.status : "not_collected"} />}</td>
                    <td className="n"><A a={r.clicks} /></td><td className="n"><R r={r.ratios.clickPerView} /></td><td className="n"><b><A a={r.orders} /></b></td>
                    <td className="n"><R r={r.ratios.orderPerClick} /></td><td className="n"><R r={r.ratios.ordersPer1000} kind="dec" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Reveal>
  );
}

function AdsTab({ d, qs }: { d: Ads; qs: string }) {
  const s = d.summary;
  return (
    <>
      {s && (
        <Kpis>
          <Kpi index={0} label="Hiển thị" color="--s4"><KV a={s.impressions} /></Kpi>
          <Kpi index={1} label="Click" color="--s1"><KV a={s.clicks} /></Kpi>
          <Kpi index={2} label="CTR" sub="Click ÷ hiển thị" tgt={targetState("ctr", s.ctrAd.value)} tgtText="Mục tiêu 0,8–1,2%"><KV r={s.ctrAd} kind="pct" /></Kpi>
          <Kpi index={3} label="CPC" sub="Chi phí ÷ click" tgt={targetState("cpc", s.cpc.value)} tgtText="Mục tiêu 3.000–5.000đ"><KV r={s.cpc} kind="vnd" digits={0} /></Kpi>
          <Kpi index={4} label="Chi phí QC"><KV a={s.spend} kind="vnd" /></Kpi>
          <Kpi index={5} label="ROAS" sub="Doanh thu quy cho QC ÷ chi phí" tgt={targetState("roas", s.roas.value)} tgtText="Mục tiêu 2,8–4,5x"><KV r={s.roas} kind="x" /></Kpi>
        </Kpis>
      )}
      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Chiến dịch Shopee Ads</h2><p className="sub">So sánh biến thể A/B (từ khóa, tệp khách) cùng kỳ. Nhãn “báo cáo” nghĩa là số đơn tổng hợp, không có mã đơn để đối chiếu.</p></div><ExportBtn name="noi_dung" qs={qs} /></div>
        <div className="card-b flush tbl-wrap">
          {d.ads.length === 0 ? <Empty title="Chưa có chiến dịch quảng cáo" text="Nhập danh mục (loại “ad”), số liệu và chi phí ở mục Quản lý dữ liệu." /> : (
            <table className="tbl">
              <thead><tr><th>Chiến dịch</th><th>Thử nghiệm A/B</th><th className="n">Hiển thị</th><th className="n">Click</th><th className="n">CTR</th><th className="n">Chi phí</th><th className="n">CPC</th><th className="n">Đơn quy</th><th className="n">Doanh thu quy</th><th className="n">ROAS</th><th className="n">Chi phí / đơn</th></tr></thead>
              <tbody>
                {d.ads.map((r) => (
                  <tr key={r.code}>
                    <td><ContentCell r={r} qs={qs} /></td>
                    <td><div className="note">{r.experiment || "—"}</div><b>{r.variant}</b></td>
                    <td className="n"><A a={r.impressions} /></td><td className="n"><A a={r.clicks} /></td><td className="n"><R r={r.ratios.clickPerView} /></td>
                    <td className="n"><A a={r.spend} kind="vnd" /></td><td className="n"><R r={r.ratios.cpc} kind="vnd" digits={0} /></td>
                    <td className="n"><A a={r.orders} /></td><td className="n"><A a={r.revenue} kind="vnd" /></td>
                    <td className="n"><b><R r={r.ratios.roas} kind="x" /></b></td><td className="n"><R r={r.ratios.costPerOrder} kind="vnd" digits={0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>
    </>
  );
}
