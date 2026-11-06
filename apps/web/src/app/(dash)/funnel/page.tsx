import type { Metadata } from "next";
import Link from "next/link";
import { api, filterQuery, type SP } from "@/lib/api";
import type { FunnelData, Meta } from "@/lib/types";
import { fd, fp, fv } from "@/lib/format";
import { A, ContentCell, DistBadge, Empty, ExportBtn, Notice, Plat, R } from "@/components/ui";
import { Page } from "@/components/Page";
import { FunnelView } from "@/components/FunnelView";
import { ParamSelect } from "@/components/ParamSelect";
import { Reveal } from "@/components/Reveal";
import { PLATFORMS } from "@/lib/labels";

export const metadata: Metadata = { title: "Phễu & so sánh" };

export default async function FunnelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [d, meta] = await Promise.all([api<FunnelData>("/api/funnel", sp), api<Meta>("/api/meta")]);
  const qs = filterQuery(sp);
  const f = d.filters;
  const cmp = String(sp.cmp ?? "");
  const s = d.summary;
  const c1 = s?.clicksPer1000, o1 = s?.ordersPer1000;
  const pathHref = (p: string) => `/funnel${filterQuery(sp, { path: p, cmp: cmp || undefined, cmp_content: String(sp.cmp_content ?? "") || undefined })}`;

  return (
    <Page title="Phễu chuyển đổi & so sánh" lede="Chọn nền tảng, chiến dịch, SKU hoặc một nội dung ở thanh lọc để xem từng bước, tỷ lệ chuyển tiếp và mức rời đi. Bước nào nguồn không cung cấp sẽ được ghi rõ, không suy diễn.">
      <Reveal as="section" className="card">
        <div className="card-h">
          <div><h2>Đối tượng đang xem</h2>
            <p className="sub">{d.rows.length} nội dung{f.platform && ` · ${PLATFORMS[f.platform]}`}{f.campaign && ` · chiến dịch ${f.campaign}`}{f.sku && ` · SKU ${f.sku}`}{f.content && ` · ${f.content}`}
              {d.nAll !== d.rows.length && ` · đã loại ${d.nAll - d.rows.length} nội dung thuộc đường đi khác`}</p></div>
          <div className="presets" aria-label="Đường đi">
            <Link className={d.path === "direct" ? "on" : ""} href={pathHref("direct")}>Thẳng Shopee</Link>
            <Link className={d.path === "website" ? "on" : ""} href={pathHref("website")}>Qua website</Link>
          </div>
        </div>
        <div className="card-b">
          {d.rows.length === 0 ? <Empty title="Không có nội dung phù hợp" text="Đổi bộ lọc hoặc đường đi, hoặc nhập thêm dữ liệu." /> : (
            <>
              <Notice kind="info">Mỗi bước dùng nguồn riêng (xem dòng nhỏ dưới tên bước). Tỷ lệ giữa hai bước chỉ tính trên các nội dung có <b>cả hai</b> bước, nên có thể khác tỷ lệ giữa hai tổng ở trên.</Notice>
              {d.mixed && (
                <div style={{ marginTop: 10 }}><Notice kind="warn"><b>Phễu đang trộn quảng cáo và nội dung.</b> Bước đầu của quảng cáo là <i>hiển thị</i>, của video/live/bài là <i>lượt xem</i>, nên tỷ lệ bước 1 → 2 bị kéo theo quảng cáo. Dùng bộ lọc “Nguồn” (Tự nhiên / Quảng cáo trả phí) để tách.</Notice></div>
              )}
              <div style={{ marginTop: 14 }}><FunnelView steps={d.steps} /></div>
            </>
          )}
        </div>
      </Reveal>

      {s && (
        <Reveal as="section" className="card">
          <div className="card-h"><div><h2>Quy đổi trên 1.000 lượt xem</h2><p className="sub">Chỉ tính trên các nội dung có cùng phạm vi đo (cả tử số và lượt xem). Quảng cáo dùng hiển thị thay cho lượt xem nên tách riêng.</p></div></div>
          <div className="card-b">
            <div className="compare-grid">
              <div className="big-fact"><div className="l">Click trên 1.000 lượt xem</div><div className="v"><R r={c1} kind="dec" digits={1} /></div>
                <div className="s">{c1?.value != null ? <>Tương đương {fp(s.clickPerView.value)} click/lượt xem</> : c1?.reason}</div></div>
              <div className="big-fact"><div className="l">Đơn trên 1.000 lượt xem</div><div className="v"><R r={o1} kind="dec" digits={2} /></div>
                <div className="s">{o1?.value != null ? <>Tương đương {fp(s.orderPerView.value, 3)} đơn/lượt xem</> : o1?.reason}</div></div>
              <div className="big-fact"><div className="l">Đơn trên click</div><div className="v"><R r={s.orderPerClick} /></div><div className="s">Đơn được ghi nhận ÷ click tương ứng</div></div>
              <div className="big-fact"><div className="l">Chi phí trên đơn</div><div className="v"><R r={s.costPerOrder} kind="vnd" digits={0} /></div>
                <div className="s">{s.cac.value != null ? <>CAC: {fv(s.cac.value)}</> : "CAC không tính được: nguồn không cho biết khách mới"}</div></div>
            </div>
            {c1?.value != null && o1?.value != null && (
              <p className="note" style={{ margin: "14px 0 0" }}>Ví dụ: với 1.000 lượt xem, nội dung này tạo trung bình <b>{fd(c1.value, 1)}</b> click và <b>{fd(o1.value, 2)}</b> đơn được ghi nhận.</p>
            )}
          </div>
        </Reveal>
      )}

      <Reveal as="section" className="card">
        <div className="card-h">
          <div><h2>So sánh</h2><p className="sub">Đặt đối tượng ở trên cạnh một kỳ khác hoặc một nội dung khác, cùng đường đi.</p></div>
          <div className="row">
            <ParamSelect name="cmp" label="Kiểu so sánh" placeholder="Không so sánh" reset={["cmp_content"]}
              options={[{ value: "prev", label: "Với kỳ liền trước (cùng độ dài)" }, { value: "content", label: "Với nội dung khác…" }]} />
            {cmp === "content" && <ParamSelect name="cmp_content" label="Nội dung so sánh" placeholder="Chọn nội dung" options={meta.options.contents.map((c) => ({ value: c.code, label: `${c.code} · ${c.title.slice(0, 30)}` }))} />}
          </div>
        </div>
        <div className="card-b">
          {!d.compare.steps ? <Empty title="Chưa chọn đối tượng so sánh" text="Chọn “kỳ liền trước” hoặc một nội dung khác ở góc phải." /> : (
            <>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Bước</th><th className="n">Đối tượng đang xem</th><th className="n">{d.compare.label}</th><th className="n">Tỷ lệ chuyển (đang xem)</th><th className="n">Tỷ lệ chuyển ({d.compare.label})</th></tr></thead>
                <tbody>
                  {d.steps.map((a, i) => {
                    const b = d.compare.steps![i];
                    return (
                      <tr key={a.key}><td><b>{a.label}</b></td><td className="n"><A a={a.agg} /></td><td className="n"><A a={b.agg} /></td>
                        <td className="n">{a.rate ? <R r={a.rate} /> : "—"}</td><td className="n">{b.rate ? <R r={b.rate} /> : "—"}</td></tr>
                    );
                  })}
                  <tr><td><b>Đơn / 1.000 lượt xem</b></td><td className="n">{s ? <R r={s.ordersPer1000} kind="dec" /> : "—"}</td><td className="n">{d.compare.summary ? <R r={d.compare.summary.ordersPer1000} kind="dec" /> : "—"}</td><td /><td /></tr>
                  <tr><td><b>Click / 1.000 lượt xem</b></td><td className="n">{s ? <R r={s.clicksPer1000} kind="dec" digits={1} /> : "—"}</td><td className="n">{d.compare.summary ? <R r={d.compare.summary.clicksPer1000} kind="dec" digits={1} /> : "—"}</td><td /><td /></tr>
                  <tr><td><b>Chi phí / đơn</b></td><td className="n">{s ? <R r={s.costPerOrder} kind="vnd" digits={0} /> : "—"}</td><td className="n">{d.compare.summary ? <R r={d.compare.summary.costPerOrder} kind="vnd" digits={0} /> : "—"}</td><td /><td /></tr>
                </tbody></table></div>
              <p className="note" style={{ marginTop: 10 }}>Khác biệt nhỏ hoặc mẫu ít (dưới vài trăm lượt xem) chưa đủ để kết luận nội dung nào tốt hơn.</p>
            </>
          )}
        </div>
      </Reveal>

      {d.rows.length > 0 && (
        <Reveal as="section" className="card">
          <div className="card-h"><div><h2>Nội dung trong phạm vi</h2><p className="sub">Bấm tên để thu hẹp phễu vào một nội dung.</p></div><ExportBtn name="noi_dung" qs={qs} /></div>
          <div className="card-b flush tbl-wrap"><table className="tbl">
            <thead><tr><th>Nội dung</th><th>Nền tảng</th><th>Phân phối</th><th className="n">Xem / hiển thị</th><th className="n">Click</th><th className="n">Click / xem</th><th className="n">Đơn</th><th className="n">Đơn / click</th><th className="n">Đơn / 1.000 xem</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.code}><td><ContentCell r={r} qs={qs} /></td><td><Plat p={r.platform} /></td><td><DistBadge d={r.distribution} /></td>
                  <td className="n"><A a={r.exposure} /></td><td className="n"><A a={r.clicks} /></td><td className="n"><R r={r.ratios.clickPerView} /></td>
                  <td className="n"><A a={r.orders} /></td><td className="n"><R r={r.ratios.orderPerClick} /></td><td className="n"><R r={r.ratios.ordersPer1000} kind="dec" /></td></tr>
              ))}
            </tbody></table></div>
        </Reveal>
      )}
    </Page>
  );
}
