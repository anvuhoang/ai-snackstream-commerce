import type { Metadata } from "next";
import Link from "next/link";
import { api, filterQuery, type SP } from "@/lib/api";
import type { Agg, Overview, Ratio } from "@/lib/types";
import { dmy, fi } from "@/lib/format";
import { targetState } from "@/lib/labels";
import { A, Alerts, Chip, ContentCell, DistBadge, Empty, ExportBtn, Plat, R, Sec } from "@/components/ui";
import { Page } from "@/components/Page";
import { Kpi, Kpis, KV } from "@/components/Kpi";
import { ChartCard } from "@/components/ChartCard";
import { DemoBanner, ParamSelect } from "@/components/ParamSelect";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = { title: "Tổng quan" };

const isAgg = (x: Agg | Ratio): x is Agg => "status" in x;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const d = await api<Overview>("/api/overview", sp);
  const qs = filterQuery(sp);
  const s = d.summary;
  const t = d.totals;
  const ser = d.series;
  const tgt = (k: Parameters<typeof targetState>[0], v: number | null) => targetState(k, v);

  return (
    <Page title="Tổng quan toàn hệ thống" lede="Hiệu quả theo từng nền tảng, nội dung và chiến dịch. Mọi tỷ lệ đều ghi rõ mẫu số; số liệu thiếu được đánh dấu chứ không bị coi là 0."
      actions={<ExportBtn name="noi_dung" qs={qs} />}>
      <DemoBanner />

      <Sec>Tiếp cận · mỗi loại đo riêng, không cộng thành số người duy nhất</Sec>
      <Kpis>
        <Kpi index={0} label="Lượt xem video" color="--s2" sub="Shopee Video + TikTok" help="Lượt xem video của các nền tảng. Không phải số người xem duy nhất."><KV a={d.reach.video} /></Kpi>
        <Kpi index={1} label="Lượt xem phiên live" color="--s2" sub="Tổng lượt xem các phiên live" help="Mỗi phiên là một phạm vi đo riêng."><KV a={d.reach.live} /></Kpi>
        <Kpi index={2} label="Lượt xem bài đăng" color="--s3" sub="Facebook"><KV a={d.reach.post} /></Kpi>
        <Kpi index={3} label="Hiển thị quảng cáo" color="--s4" sub="Shopee Ads + Facebook Ads" help="Lượt hiển thị (impression) của quảng cáo, khác với lượt xem nội dung."><KV a={d.reach.impressions} /></Kpi>
      </Kpis>

      <Sec>Hành động &amp; đơn hàng</Sec>
      <Kpis>
        <Kpi index={0} label="Click ghi nhận" color="--s1" sub="Click ra ngoài / vào sản phẩm theo từng nguồn" help="Mỗi nguồn định nghĩa click khác nhau (link affiliate, nút sản phẩm, click quảng cáo)."><KV a={s.clicks} /></Kpi>
        <Kpi index={1} label="Phiên vào website" color="--s4" sub={`Xem SP: ${fi(d.web.productView)} · Click sang Shopee: ${fi(d.web.clickShopee)}`} help="Số phiên (session) duy nhất có sự kiện trên website nhóm."><KV a={{ value: d.web.pageView, status: "value", note: "", basis: "", nKnown: 1, nTotal: 1 }} /></Kpi>
        <Kpi index={2} label="Đơn hàng (đã khử trùng)" color="--s2" sub={`${fi(t.unattributed)} đơn chưa rõ nguồn · ${fi(t.notCounted)} đơn hủy/hoàn không tính`}
          help="Đếm theo mã đơn Shopee duy nhất, trạng thái được tính: đang giao, hoàn tất."><KV a={{ value: t.counted, status: "value", note: "", basis: "", nKnown: 1, nTotal: 1 }} /></Kpi>
        <Kpi index={3} label="Doanh thu" color="--s2" sub="Từ các đơn được tính"><KV a={{ value: t.revenue, status: "value", note: "", basis: "", nKnown: 1, nTotal: 1 }} kind="vnd" /></Kpi>
      </Kpis>
      {t.reportedUnreconciled > 0 && (
        <div className="alert info"><svg className="i" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.1" /></svg>
          <div>Có {fi(t.reportedUnreconciled)} đơn chỉ có trong báo cáo tổng hợp (không có mã đơn). Chúng hiển thị ở từng nội dung nhưng <b>không cộng vào tổng đơn</b> để tránh tính trùng.</div></div>
      )}

      <Sec>Chuyển đổi &amp; chi phí</Sec>
      <Kpis>
        <Kpi index={0} label="Click / lượt xem" sub="Click liên quan ÷ lượt xem nội dung" help="Không gồm quảng cáo (dùng CTR)."><KV r={s.clickPerView} kind="pct" /></Kpi>
        <Kpi index={1} label="Đơn / click" sub="Đơn được ghi nhận ÷ click tương ứng"><KV r={s.orderPerClick} kind="pct" /></Kpi>
        <Kpi index={2} label="Đơn / 1.000 lượt xem" sub="Chỉ tính nội dung có cả đơn và lượt xem"><KV r={s.ordersPer1000} kind="dec" /></Kpi>
        <Kpi index={3} label="CTR quảng cáo" sub="Click ÷ hiển thị quảng cáo" tgt={tgt("ctr", s.ctrAd.value)} tgtText="Mục tiêu 0,8–1,2%"><KV r={s.ctrAd} kind="pct" /></Kpi>
        <Kpi index={4} label="ROAS (quảng cáo trả phí)" sub="Doanh thu quy cho QC ÷ chi phí QC" tgt={tgt("roas", s.roas.value)} tgtText="Mục tiêu 2,8–4,5x"><KV r={s.roas} kind="x" /></Kpi>
        <Kpi index={5} label="Tổng chi phí ghi nhận" sub="Quảng cáo + hoa hồng + sản xuất + AI"><KV a={s.cost} kind="vnd" /></Kpi>
        <Kpi index={6} label="Chi phí / đơn" sub="Tổng chi phí ÷ đơn được quy" help="Dùng khi chưa xác định được khách hàng mới."><KV r={s.costPerOrder} kind="vnd" digits={0} /></Kpi>
        <Kpi index={7} label="CAC" sub="Chi phí thu hút ÷ khách mới xác định" help="Chỉ tính khi nguồn cho biết khách mới." tgt={tgt("cac", s.cac.value)} tgtText="Mục tiêu ≤ 50.000đ"><KV r={s.cac} kind="vnd" digits={0} /></Kpi>
      </Kpis>

      <Sec>Xu hướng theo ngày</Sec>
      <div className="grid-2">
        <ChartCard index={0} title="Lượt xem nội dung / ngày" sub="Không gồm hiển thị quảng cáo. Mỗi đường là một nền tảng, không cộng gộp." type="line" dates labels={ser.days}
          datasets={[{ label: "Shopee", color: "var(--c-shopee)", data: ser.views.shopee }, { label: "TikTok", color: "var(--c-tiktok)", data: ser.views.tiktok }, { label: "Facebook", color: "var(--c-facebook)", data: ser.views.facebook }]} />
        <ChartCard index={1} title="Click / ngày" sub="Click ghi nhận tại nguồn, theo nền tảng." type="line" dates labels={ser.days}
          datasets={[{ label: "Shopee", color: "var(--c-shopee)", data: ser.clicks.shopee }, { label: "TikTok", color: "var(--c-tiktok)", data: ser.clicks.tiktok }, { label: "Facebook", color: "var(--c-facebook)", data: ser.clicks.facebook }]} />
        <ChartCard index={2} title="Đơn hàng được tính / ngày" sub="Theo mã đơn duy nhất; không gồm đơn hủy/hoàn." type="bar" dates labels={ser.days} datasets={[{ label: "Đơn", color: "var(--s2)", data: ser.orders }]} />
        <ChartCard index={3} title="Chi phí ghi nhận / ngày" sub="Chi phí quảng cáo, hoa hồng, sản xuất và AI trong khoảng đã chọn." type="bar" kind="vnd" dates labels={ser.days} datasets={[{ label: "Chi phí", color: "var(--s1)", data: ser.cost }]} />
      </div>

      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>So sánh nền tảng</h2><p className="sub">Mỗi hàng đo theo phạm vi riêng của nền tảng đó. Cột “Đơn quy” chỉ gồm đơn gắn được vào nội dung.</p></div><ExportBtn name="nen_tang" qs={qs} /></div>
        <div className="card-b flush tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Nền tảng</th><th className="n">Nội dung</th><th className="n">Lượt xem</th><th className="n">Hiển thị QC</th><th className="n">Click</th><th className="n">Click / xem</th><th className="n">Đơn quy</th><th className="n">Doanh thu quy</th><th className="n">Chi phí</th><th className="n">Chi phí / đơn</th></tr></thead>
            <tbody>
              {d.platforms.filter((p) => p.key !== "website").map((p) => (
                <tr key={p.key}>
                  <td><b><Plat p={p.key} /></b></td><td className="n">{p.n}</td>
                  {p.summary ? (
                    <>
                      <td className="n"><A a={p.summary.views} /></td>
                      <td className="n">{p.summary.impressions.value != null || p.summary.impressions.nTotal ? <A a={p.summary.impressions} /> : "—"}</td>
                      <td className="n"><A a={p.summary.clicks} /></td><td className="n"><R r={p.summary.clickPerView} /></td>
                      <td className="n"><A a={p.summary.orders} /></td><td className="n"><A a={p.summary.revenue} kind="vnd" /></td>
                      <td className="n"><A a={p.summary.cost} kind="vnd" /></td><td className="n"><R r={p.summary.costPerOrder} kind="vnd" digits={0} /></td>
                    </>
                  ) : <td colSpan={8} className="muted">Chưa có nội dung trong phạm vi lọc</td>}
                </tr>
              ))}
              <tr>
                <td><b><Plat p="website" /></b></td><td className="n">—</td>
                <td colSpan={8} className="muted">Phiên có sự kiện: <b className="num">{fi(d.web.pageView)}</b> · xem sản phẩm: <b className="num">{fi(d.web.productView)}</b> · click sang Shopee: <b className="num">{fi(d.web.clickShopee)}</b> <span className="note">(sự kiện thật từ website nhóm)</span></td>
              </tr>
              <tr>
                <td><b>Chưa rõ nguồn</b></td><td className="n">—</td>
                <td colSpan={8} className="muted"><b className="num">{fi(t.unattributed)}</b> đơn trong tổng không gắn được vào nội dung nào (khách tự tìm, không có thông tin nguồn).</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal as="section" className="card">
        <div className="card-h">
          <div><h2>Nội dung hiệu quả cao &amp; thấp</h2><p className="sub">Xếp hạng theo chỉ số đang chọn. Chỉ gồm nội dung tính được chỉ số này. Gắn “mẫu nhỏ” khi dưới 1.000 lượt xem/hiển thị.</p></div>
          <ParamSelect name="rank" current={d.rank.key} label="Chỉ số xếp hạng" options={d.rank.options.map((o) => ({ value: o.key, label: o.label }))} />
        </div>
        <div className="card-b">
          {d.rank.top.length === 0 ? <Empty title="Chưa tính được chỉ số này" text="Thiếu dữ liệu tử số hoặc mẫu số ở mọi nội dung trong phạm vi lọc." /> : (
            <div className="grid-2">
              {([["Cao nhất", d.rank.top], ["Thấp nhất", d.rank.bottom]] as const).map(([title, list]) => (
                <div key={title}>
                  <div className="row" style={{ marginBottom: 6 }}><b>{title}</b></div>
                  {list.length === 0 ? <p className="note">Cần nhiều hơn 5 nội dung để so sánh nhóm thấp nhất.</p> : (
                    <div className="tbl-wrap"><table className="tbl">
                      <thead><tr><th>Nội dung</th><th className="n">{d.rank.label}</th><th className="n">Xem / hiển thị</th></tr></thead>
                      <tbody>
                        {list.map(({ row, value }) => (
                          <tr key={row.code}>
                            <td><ContentCell r={row} qs={qs} /><div style={{ marginTop: 4 }}><Plat p={row.platform} /> <DistBadge d={row.distribution} /></div></td>
                            <td className="n"><b>{isAgg(value) ? <A a={value} kind={d.rank.kind} /> : <R r={value} kind={d.rank.kind} />}</b></td>
                            <td className="n"><A a={row.exposure} />{row.exposure.value != null && row.exposure.value < 1000 && <> <span className="badge warn" title="Mẫu nhỏ, dễ dao động">mẫu nhỏ</span></>}</td>
                          </tr>
                        ))}
                      </tbody></table></div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Reveal>

      <div className="split">
        <Reveal as="section" className="card">
          <div className="card-h"><div><h2>Trạng thái nguồn dữ liệu</h2><p className="sub">Kết nối, thời điểm có số liệu gần nhất.</p></div><Link className="btn sm" href="/data">Quản lý dữ liệu</Link></div>
          <div className="card-b flush tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Nguồn</th><th>Kết nối API</th><th>Số liệu gần nhất</th><th>Ghi chú</th></tr></thead>
              <tbody>
                {d.sources.map((src) => (
                  <tr key={src.key}><td><b>{src.name}</b></td>
                    <td>{src.api === "connected" ? <span className="badge ok">Đã kết nối</span> : <Chip status="not_connected" />}</td>
                    <td className="num">{src.lastDate ? <>{dmy(src.lastDate)}{src.daysOld ? <span className="muted"> ({src.daysOld} ngày trước)</span> : null}</> : src.platform ? <Chip status="not_collected" /> : "—"}</td>
                    <td className="note">{src.note}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
        <Reveal as="section" className="card" index={1}>
          <div className="card-h"><div><h2>Cảnh báo dữ liệu</h2><p className="sub">Những gì còn thiếu bằng chứng.</p></div></div>
          <div className="card-b"><Alerts items={d.warnings} /></div>
        </Reveal>
      </div>
    </Page>
  );
}
