"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, Info, Sparkles, Trash2, Upload } from "lucide-react";
import { useApp } from "./context";
import type { DataOverview, ImportResult } from "@/lib/types";
import { fi } from "@/lib/format";
import { METRIC_KEYS } from "@/lib/labels";

async function post(path: string, csrf: string, body?: BodyInit, json = false) {
  const res = await fetch(path, { method: "POST", body, headers: { "X-CSRF-Token": csrf, ...(json ? { "Content-Type": "application/json" } : {}) } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function Msg({ kind, children }: { kind: "ok" | "err" | "info"; children: React.ReactNode }) {
  const Icon = kind === "ok" ? CheckCircle2 : kind === "info" ? Info : AlertTriangle;
  return <div className={`alert ${kind}`}><Icon size={16} /><div>{children}</div></div>;
}

export function ImportPanel({ specs }: { specs: DataOverview["specs"] }) {
  const { me } = useApp();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [fail, setFail] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setRes(null); setFail("");
    const fd = new FormData(e.currentTarget);
    fd.set("strict", fd.get("strict") ? "true" : "false");
    fd.set("is_demo", fd.get("is_demo") ? "true" : "false");
    const r = await post("/api/data/import", me.csrf, fd);
    setBusy(false);
    if (!r.ok) { setFail(r.data.detail ?? "Không nhập được."); return; }
    setRes(r.data as ImportResult);
    if ((r.data as ImportResult).ok) { form.current?.reset(); router.refresh(); }
  }

  return (
    <section className="card" id="import">
      <div className="card-h"><div><h2>Nhập file CSV / Excel</h2><p className="sub">Thứ tự gợi ý: danh mục nội dung → số liệu → đơn hàng → chi phí → log AI.</p></div></div>
      <div className="card-b">
        <form ref={form} onSubmit={submit} className="stack">
          <label className="fld"><span>Loại dữ liệu</span>
            <select className="ctl" name="kind" required style={{ maxWidth: "none" }}>{specs.map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}</select></label>
          <label className="fld"><span>File (.csv hoặc .xlsx, tối đa 5 MB)</span><input className="ctl" type="file" name="file" accept=".csv,.xlsx,.xlsm" required style={{ paddingTop: 6 }} /></label>
          <label className="fld"><span>Ghi chú nguồn (vd. “Báo cáo Shopee Live tuần 43, Việt xuất 30/10”)</span><input className="ctl" name="source_note" maxLength={300} /></label>
          <label className="row"><input type="checkbox" name="strict" defaultChecked /> <span><b>Nghiêm ngặt:</b> sai một dòng thì không nhập dòng nào</span></label>
          <label className="row"><input type="checkbox" name="is_demo" /> <span>Đánh dấu là dữ liệu <b>demo</b></span></label>
          <div><button className="btn primary" type="submit" disabled={busy}><Upload size={16} /> {busy ? "Đang nhập…" : "Nhập dữ liệu"}</button></div>
        </form>

        {fail && <div style={{ marginTop: 14 }}><Msg kind="err">{fail}</Msg></div>}
        {res && (
          <div className="stack" style={{ marginTop: 14 }}>
            {res.duplicate ? <Msg kind="info"><b>Bỏ qua: file trùng.</b> {res.message}</Msg>
              : res.rejected || (res.message && !res.ok) ? <Msg kind="err"><b>Không nhập được “{res.file}”.</b> {res.message}</Msg>
              : <Msg kind="ok"><b>Đã nhập {fi(res.ok)} dòng</b> từ “{res.file}” (lô #{res.batchId}){res.nErrors ? `; bỏ qua ${res.nErrors} dòng lỗi` : ""}.</Msg>}
            {res.warnings.map((w) => <Msg key={w} kind="info">{w}</Msg>)}
            {res.errors.length > 0 && (
              <>
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th className="n">Dòng</th><th>Lỗi</th></tr></thead>
                  <tbody>{res.errors.map((e, i) => <tr key={i}><td className="n">{e.row}</td><td>{e.message}</td></tr>)}</tbody></table></div>
                {res.nErrors > res.errors.length && <p className="note">Hiển thị {res.errors.length}/{res.nErrors} lỗi đầu tiên.</p>}
                {res.batchId && <p><a className="btn sm" href={`/api/data/batch/${res.batchId}/errors.csv`}><Download size={16} /> Tải danh sách lỗi</a></p>}
              </>
            )}
          </div>
        )}

        <hr className="hr" style={{ margin: "16px 0" }} />
        <div className="note" style={{ marginBottom: 8 }}><b>File mẫu</b> (có sẵn tiêu đề và một dòng ví dụ):</div>
        <div className="row">{specs.map((s) => <a key={s.kind} className="btn sm" href={`/api/data/template/${s.kind}.csv`}><Download size={16} /> {s.kind}</a>)}</div>
        <details style={{ marginTop: 14 }}>
          <summary className="note" style={{ cursor: "pointer" }}>Quy ước ô dữ liệu</summary>
          <div className="stack note" style={{ marginTop: 8, color: "var(--text-2)" }}>
            <div>• Số: dùng dấu chấm thập phân, không dùng dấu ngăn cách nghìn (<code>1250</code>, không phải <code>1.250</code>).</div>
            <div>• Ngày: <code>YYYY-MM-DD</code> hoặc <code>DD/MM/YYYY</code>.</div>
            <div>• Cột số liệu: ô <b>trống</b> = chưa có dữ liệu (không ghi đè số đã có) · <code>NA</code> = nguồn không cung cấp · <code>NC</code> = chưa kết nối · <code>0</code> = giá trị thật bằng 0.</div>
            <div>• Đơn có <code>content_code</code> thì phải ghi <code>attribution_method</code>. Mã đơn trùng sẽ <b>cập nhật</b> trạng thái, không tạo đơn mới.</div>
            <div>• Không trộn demo với thật: file thật không được tham chiếu mã nội dung demo.</div>
          </div>
        </details>
      </div>
    </section>
  );
}

export function DemoPanel() {
  const { me, meta, today } = useApp();
  void today;
  const router = useRouter();
  const [msg, setMsg] = useState<{ kind: "ok" | "info" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(path: string) {
    if (path.includes("clear") && !confirm("Xóa toàn bộ dữ liệu demo? Dữ liệu thật được giữ nguyên.")) return;
    setBusy(true);
    const r = await post(path, me.csrf);
    setBusy(false);
    setMsg({ kind: r.ok ? (r.data.ok ? "ok" : "info") : "err", text: r.data.message ?? r.data.detail ?? "Lỗi" });
    router.refresh();
  }
  return (
    <section className="card">
      <div className="card-h"><div><h2>Dữ liệu demo</h2><p className="sub">Hiện có {meta.counts.demo} nội dung demo, {meta.counts.real} nội dung thật.</p></div></div>
      <div className="card-b stack">
        <p className="note" style={{ margin: 0, color: "var(--text-2)" }}>Bộ demo có đủ hai luồng (thẳng Shopee, qua website), quảng cáo báo cáo tổng hợp, chỉ số nguồn không cung cấp và đơn không rõ nguồn. Mọi bản ghi mang nhãn <span className="badge demo">DEMO</span> và xóa riêng được.</p>
        <div className="row">
          <button className="btn" disabled={busy || meta.counts.demo > 0} onClick={() => run("/api/data/seed")}><Sparkles size={16} /> Nạp dữ liệu demo</button>
          <button className="btn danger" disabled={busy || meta.counts.demo === 0} onClick={() => run("/api/data/clear-demo")}><Trash2 size={16} /> Xóa dữ liệu demo</button>
        </div>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      </div>
    </section>
  );
}

export function ManualPanel({ codes }: { codes: string[] }) {
  const { me, today } = useApp();
  const router = useRouter();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const r = await post("/api/data/manual", me.csrf, JSON.stringify({
      contentCode: fd.get("content_code"), day: fd.get("day"), metricKey: fd.get("metric_key"), value: fd.get("value") ?? "", sourceNote: fd.get("source_note"),
    }), true);
    setBusy(false);
    setMsg({ kind: r.ok ? "ok" : "err", text: r.ok ? r.data.message : (typeof r.data.detail === "string" ? r.data.detail : "Dữ liệu không hợp lệ.") });
    if (r.ok) router.refresh();
  }
  return (
    <section className="card" id="manual">
      <div className="card-h"><div><h2>Nhập tay có nguồn</h2><p className="sub">Cho số liệu chưa có cách lấy tự động. Bắt buộc ghi nguồn.</p></div></div>
      <div className="card-b">
        <form onSubmit={submit} className="stack">
          <div className="two-col-form">
            <label className="fld"><span>Nội dung</span><input className="ctl" name="content_code" list="codes" required placeholder="vd. SV-001" />
              <datalist id="codes">{codes.map((c) => <option key={c} value={c} />)}</datalist></label>
            <label className="fld"><span>Ngày</span><input className="ctl" type="date" name="day" defaultValue={today} max={today} required /></label>
            <label className="fld"><span>Chỉ số</span><select className="ctl" name="metric_key" style={{ maxWidth: "none" }}>{Object.entries(METRIC_KEYS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="fld"><span>Giá trị (trống = nguồn không cung cấp)</span><input className="ctl" name="value" inputMode="decimal" /></label>
          </div>
          <label className="fld"><span>Nguồn số liệu *</span><input className="ctl" name="source_note" required maxLength={300} placeholder="vd. Ảnh chụp Seller Centre ngày 30/10, Việt gửi" /></label>
          <div><button className="btn primary" type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu số liệu"}</button></div>
        </form>
        {msg && <div style={{ marginTop: 12 }}><Msg kind={msg.kind}>{msg.text}</Msg></div>}
      </div>
    </section>
  );
}
