import type { Metadata } from "next";
import { api } from "@/lib/api";
import type { DataOverview } from "@/lib/types";
import { dmy, dmyHm, fi } from "@/lib/format";
import { KINDS, METRIC_KEYS, STATUS_LABEL } from "@/lib/labels";
import { Chip, Empty, Plat } from "@/components/ui";
import { Page } from "@/components/Page";
import { Reveal } from "@/components/Reveal";
import { DemoPanel, ImportPanel, ManualPanel } from "@/components/DataTools";

export const metadata: Metadata = { title: "Quản lý dữ liệu" };
const COLS = ["views", "impressions", "engagements", "clicks", "product_views", "add_to_cart", "watch_time_sec", "orders"] as const;

export default async function DataPage() {
  const d = await api<DataOverview>("/api/data/overview");
  return (
    <Page title="Quản lý dữ liệu" lede="Nhập CSV/Excel hoặc nhập tay có nguồn. Mỗi lần nhập được kiểm tra, ghi lô, chống nhập trùng và phân biệt dữ liệu thật với demo." filters={false}>
      <div className="grid-2">
        <ImportPanel specs={d.specs} />
        <div className="stack">
          <DemoPanel />
          <ManualPanel codes={d.contentCodes} />
        </div>
      </div>

      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Nguồn dữ liệu &amp; kết nối</h2><p className="sub">API chỉ được bật sau khi quyền và khả năng truy cập đã được xác minh. Webhook Make.com: <code>POST /api/ingest/make</code> với header <code>X-Ingest-Token</code>.</p></div></div>
        <div className="card-b flush tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Nguồn</th><th>Kết nối API</th><th className="n">Nội dung</th><th>Số liệu gần nhất</th><th>Ghi chú</th></tr></thead>
            <tbody>
              {d.sources.map((s) => (
                <tr key={s.key}><td><b>{s.name}</b></td>
                  <td>{s.api === "connected" ? <span className="badge ok">Đã kết nối</span> : <Chip status="not_connected" />}</td>
                  <td className="n">{s.platform ? s.nContents : "—"}</td>
                  <td className="num">{s.lastDate ? dmy(s.lastDate) : s.platform ? <Chip status="not_collected" /> : "—"}</td>
                  <td className="note">{s.note}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Độ phủ dữ liệu</h2><p className="sub">Số nội dung đã có từng chỉ số trên tổng số nội dung cùng loại. Ô gạch chéo = chưa có hoặc nguồn không cung cấp.</p></div></div>
        <div className="card-b flush tbl-wrap">
          {d.coverage.length === 0 ? <Empty title="Chưa có nội dung" text="Nhập danh mục nội dung trước." /> : (
            <table className="tbl">
              <thead><tr><th>Nhóm</th><th className="n">Nội dung</th>{COLS.map((k) => <th key={k} className="n">{k === "orders" ? "Xác định được đơn" : METRIC_KEYS[k]}</th>)}</tr></thead>
              <tbody>
                {d.coverage.map((g) => (
                  <tr key={`${g.platform}-${g.kind}`}>
                    <td><b><Plat p={g.platform} /></b> · {KINDS[g.kind] ?? g.kind}</td><td className="n">{g.n}</td>
                    {COLS.map((k) => {
                      const c = g.cells[k];
                      if (!c) return <td key={k} className="cov-cell"><span className="muted">—</span></td>;
                      const cls = c.known === c.total ? "full" : c.known === 0 ? "none" : "part";
                      return <td key={k} className={`cov-cell ${cls}`}><span className="pct">{c.known}/{c.total}</span>{cls === "none" && <small>{STATUS_LABEL[c.status] ?? ""}</small>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>

      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Lịch sử nhập (15 lô gần nhất)</h2></div></div>
        <div className="card-b flush tbl-wrap">
          {d.batches.length === 0 ? <Empty title="Chưa có lô nào" /> : (
            <table className="tbl">
              <thead><tr><th className="n">Lô</th><th>Thời điểm</th><th>Loại</th><th>File / cách nhập</th><th className="n">Dòng nhập</th><th className="n">Dòng lỗi</th><th>Nhãn</th><th>Nguồn</th><th /></tr></thead>
              <tbody>
                {d.batches.map((b) => (
                  <tr key={b.id}><td className="n">#{b.id}</td><td className="num">{dmyHm(b.createdAt)}</td><td><code>{b.kind}</code></td>
                    <td>{b.filename || "—"} <span className="badge">{b.method}</span></td><td className="n">{fi(b.rowsOk)}</td>
                    <td className="n">{b.rowsErr ? <span className="badge bad">{b.rowsErr}</span> : 0}</td>
                    <td>{b.isDemo ? <span className="badge demo">DEMO</span> : <span className="badge ok">Thật</span>}</td>
                    <td className="note" style={{ maxWidth: 280 }}>{b.sourceNote || "—"}</td>
                    <td>{b.rowsErr ? <a className="btn sm" href={`/api/data/batch/${b.id}/errors.csv`}>Lỗi</a> : null}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>
    </Page>
  );
}
