import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Info } from "lucide-react";
import type { Agg, Kind, Ratio, Row, Warning } from "@/lib/types";
import { fi, fmt } from "@/lib/format";
import { AIG, DISTS, LEVELS, PLATFORMS, STATUS_LABEL } from "@/lib/labels";

/** Missing-data status: always has text, never relies on color alone. */
export function Chip({ status, title, label }: { status: string; title?: string; label?: string }) {
  return (
    <span className="na" data-s={status} title={title || STATUS_LABEL[status] || ""}>
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Display one metric (Agg): the value, or a chip explaining why it is missing. */
export function A({ a, kind = "int", digits = 2 }: { a: Agg | null | undefined; kind?: Kind; digits?: number }) {
  if (!a) return <Chip status="not_collected" />;
  if (a.value == null) return <Chip status={a.status} title={a.note} />;
  return (
    <>
      {fmt(kind, a.value, digits)}
      {a.basis === "reported" && <> <span className="tag" title="Số liệu tổng hợp từ báo cáo nguồn, không đối chiếu được từng đơn">báo cáo</span></>}
      {a.nTotal > 1 && a.nKnown < a.nTotal && (
        <sup className="cov" title={`Chỉ ${a.nKnown} trên ${a.nTotal} nội dung có số liệu này`}>{a.nKnown}/{a.nTotal}</sup>
      )}
    </>
  );
}

/** Display one ratio (Ratio): a zero denominator or missing data shows "Không tính được" (cannot be computed). */
export function R({ r, kind = "pct", digits = 2 }: { r: Ratio | null | undefined; kind?: Kind; digits?: number }) {
  if (!r || r.value == null) return <span className="na" data-s="undetermined" title={r?.reason ?? ""}>Không tính được</span>;
  return (
    <>
      {fmt(kind, r.value, digits)}
      {r.nTotal > 1 && r.nUsed < r.nTotal && (
        <sup className="cov" title={`Tính trên ${r.nUsed} nội dung có đủ tử số và mẫu số (cùng phạm vi đo), trong ${r.nTotal} nội dung`}>{r.nUsed}/{r.nTotal}</sup>
      )}
    </>
  );
}

export const Plat = ({ p }: { p: string }) => (
  <span style={{ whiteSpace: "nowrap" }}><span className="pdot" style={{ ["--pc" as string]: `var(--c-${p})` }} />{PLATFORMS[p] ?? p}</span>
);
export const DemoTag = ({ demo }: { demo: boolean }) => (demo ? <span className="badge demo" title="Dữ liệu minh họa, không phải số liệu thật">DEMO</span> : null);
export const DistBadge = ({ d }: { d: string }) => <span className="badge" data-k={d}>{DISTS[d] ?? d}</span>;
export const AiBadge = ({ g }: { g: string }) => <span className="badge" data-k={g}>{AIG[g] ?? g}</span>;
export const LevelBadge = ({ l }: { l: string }) => <span className="badge" data-k={l}>{LEVELS[l] ?? l}</span>;

export function ContentCell({ r, qs = "" }: { r: Row; qs?: string }) {
  const base = new URLSearchParams(qs.replace(/^\?/, ""));
  for (const k of ["campaign", "sku", "platform", "dist"]) base.delete(k);
  base.set("content", r.code);
  return (
    <div className="cell-title">
      <Link href={`/funnel?${base}`} title="Xem phễu của nội dung này"><b>{r.title || r.code}</b></Link>
      <span><code>{r.code}</code>{r.sku && <> · {r.sku}</>}{r.campaign && <> · {r.campaign}</>} <DemoTag demo={r.isDemo} /></span>
    </div>
  );
}

export const Empty = ({ title, text }: { title: string; text?: string }) => (
  <div className="empty"><b>{title}</b>{text}</div>
);

export function Alerts({ items }: { items: Warning[] }) {
  return (
    <div className="alerts">
      {items.map((a, i) => (
        <div key={i} className={`alert ${a.level}`}>
          {a.level === "warn" ? <AlertTriangle size={16} /> : <Info size={16} />}<div>{a.text}</div>
        </div>
      ))}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "info" | "warn" | "ok" | "err"; children: ReactNode }) {
  const Icon = kind === "ok" ? CheckCircle2 : kind === "info" ? Info : AlertTriangle;
  return <div className={`alert ${kind}`}><Icon size={16} /><div>{children}</div></div>;
}

export function ExportBtn({ name, qs }: { name: string; qs: string }) {
  return <a className="btn sm" href={`/api/export/${name}.csv${qs}`}><Download size={16} /> Xuất CSV</a>;
}

export const ExtLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className="btn sm" href={href} target="_blank" rel="noopener noreferrer">{children} <ExternalLink size={14} /></a>
);

export function PageHead({ title, lede, actions }: { title: string; lede?: string; actions?: ReactNode }) {
  return (
    <header className="pagehead">
      <div><h1>{title}</h1>{lede && <p>{lede}</p>}</div>
      {actions && <div className="head-actions">{actions}</div>}
    </header>
  );
}

export const Sec = ({ children }: { children: ReactNode }) => <div className="sec-label">{children}</div>;

export function Stock({ v }: { v: number | null }) {
  if (v == null) return <Chip status="not_collected" />;
  if (v <= 0) return <span className="badge bad">Hết hàng</span>;
  if (v <= 20) return <span className="badge warn">Sắp hết · {v}</span>;
  return <>{fi(v)}</>;
}
