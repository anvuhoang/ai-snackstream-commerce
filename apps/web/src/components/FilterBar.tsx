"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "./context";
import { DISTS, MODES, PLATFORMS } from "@/lib/labels";

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const diffDays = (a: string, b: string) => Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);

function Sel({ label, name, value, onPick, children }: { label: string; name: string; value: string; onPick: (name: string, v: string) => void; children: React.ReactNode }) {
  return (
    <label className="fld"><span>{label}</span>
      <select className="ctl" value={value} onChange={(e) => onPick(name, e.target.value)}>{children}</select>
    </label>
  );
}

export function FilterBar() {
  const { meta, today } = useApp();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const on = () => setStuck(window.scrollY > 120);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const get = (k: string) => sp.get(k) ?? "";
  const from = get("from") || addDays(today, -29);
  const to = get("to") || today;
  const nDays = diffDays(from, to) + 1;

  const push = (changes: Record<string, string>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) { if (v) q.set(k, v); else q.delete(k); }
    const s = q.toString();
    router.push(s ? `${path}?${s}` : path);
  };
  const href = (changes: Record<string, string>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) { if (v) q.set(k, v); else q.delete(k); }
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const mode = get("mode") || "all";

  return (
    <div className={`filterbar${stuck ? " stuck" : ""}`}>
      <div className="filter-form" style={{ display: "flex", flexWrap: "wrap", gap: "10px 12px", alignItems: "flex-end" }}>
        <div className="fld"><span>Khoảng thời gian</span>
          <div className="row" style={{ gap: 6 }}>
            <input className="ctl" type="date" value={from} max={today} aria-label="Từ ngày" onChange={(e) => e.target.value && push({ from: e.target.value })} />
            <span className="muted">→</span>
            <input className="ctl" type="date" value={to} max={today} aria-label="Đến ngày" onChange={(e) => e.target.value && push({ to: e.target.value === today ? "" : e.target.value })} />
          </div>
        </div>
        <div className="fld"><span>Nhanh</span>
          <div className="presets">
            {[7, 14, 30, 60].map((n) => (
              <Link key={n} href={href({ from: addDays(today, -(n - 1)), to: "" })} className={to === today && nDays === n ? "on" : ""} scroll={false}>{n}N</Link>
            ))}
          </div>
        </div>
        <Sel label="Nền tảng" name="platform" value={get("platform")} onPick={(k, v) => push({ [k]: v })}><option value="">Tất cả</option>{Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Sel>
        <Sel label="Nguồn" name="dist" value={get("dist")} onPick={(k, v) => push({ [k]: v })}><option value="">Tự nhiên + trả phí</option>{Object.entries(DISTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Sel>
        <Sel label="Chiến dịch" name="campaign" value={get("campaign")} onPick={(k, v) => push({ [k]: v })}><option value="">Tất cả</option>{meta.options.campaigns.map((c) => <option key={c} value={c}>{c}</option>)}</Sel>
        <Sel label="SKU" name="sku" value={get("sku")} onPick={(k, v) => push({ [k]: v })}><option value="">Tất cả</option>{meta.options.skus.map((s) => <option key={s.sku} value={s.sku}>{s.sku}</option>)}</Sel>
        <Sel label="Nội dung / phiên live" name="content" value={get("content")} onPick={(k, v) => push({ [k]: v })}><option value="">Tất cả</option>
          {meta.options.contents.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.title.slice(0, 34)}</option>)}</Sel>
        <div className="fld"><span>Loại dữ liệu</span>
          <div className="mode-switch">
            {Object.entries(MODES).map(([k, v]) => <Link key={k} href={href({ mode: k === "all" ? "" : k })} className={mode === k ? "on" : ""} scroll={false}>{v}</Link>)}
          </div>
        </div>
        <div className="fld"><span>&nbsp;</span><Link className="btn" href={path} scroll={false}>Đặt lại</Link></div>
      </div>
    </div>
  );
}
