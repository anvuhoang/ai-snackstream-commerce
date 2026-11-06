import type { ReactNode } from "react";
import type { Agg, Kind, Ratio } from "@/lib/types";
import { Chip } from "./ui";
import { CountNum } from "./CountNum";
import { Reveal } from "./Reveal";

/** KPI value: counts up when known, shows the reason when missing (never a fake 0). */
export function KV({ a, r, kind = "int", digits = 2 }: { a?: Agg; r?: Ratio; kind?: Kind; digits?: number }) {
  if (a) {
    if (a.value == null) return <Chip status={a.status} title={a.note} />;
    const tail = a.nTotal > 1 && a.nKnown < a.nTotal
      ? <sup className="cov" title={`Chỉ ${a.nKnown} trên ${a.nTotal} nội dung có số liệu này`}>{a.nKnown}/{a.nTotal}</sup> : null;
    return <CountNum value={a.value} kind={kind} digits={digits} tail={tail} />;
  }
  if (!r || r.value == null) return <span className="na" data-s="undetermined" title={r?.reason ?? ""}>Không tính được</span>;
  const tail = r.nTotal > 1 && r.nUsed < r.nTotal
    ? <sup className="cov" title={`Tính trên ${r.nUsed}/${r.nTotal} nội dung có đủ tử số và mẫu số`}>{r.nUsed}/{r.nTotal}</sup> : null;
  return <CountNum value={r.value} kind={kind} digits={digits} tail={tail} />;
}

export function Kpi({ label, children, sub, help, color, tgt, tgtText, index = 0 }: {
  label: string; children: ReactNode; sub?: ReactNode; help?: string; color?: string; tgt?: string; tgtText?: string; index?: number;
}) {
  return (
    <Reveal className="kpi" index={index} style={color ? { ["--kc" as string]: `var(${color})` } : undefined}>
      {color && <span className="bar" />}
      <div className="l">{label}{help && <span className="help" title={help}>?</span>}</div>
      <div className="v">{children}</div>
      {tgt && tgtText && <div className={`tgt ${tgt}`}>{tgtText}</div>}
      {sub && <div className="s">{sub}</div>}
    </Reveal>
  );
}

export const Kpis = ({ children }: { children: ReactNode }) => <div className="kpis">{children}</div>;
