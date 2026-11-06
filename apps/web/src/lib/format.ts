import type { Kind } from "./types";

// Vietnamese number format: '.' thousands separator, ',' decimal
const nf = (d: number) => new Intl.NumberFormat("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const cache: Record<number, Intl.NumberFormat> = {};
const f = (d: number) => (cache[d] ??= nf(d));

export const fi = (v: number | null | undefined) => (v == null ? "—" : f(0).format(Math.round(v)));
export const fd = (v: number | null | undefined, d = 2) => (v == null ? "—" : f(d).format(v));
export const fp = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${f(d).format(v)}%`);
export const fv = (v: number | null | undefined) => (v == null ? "—" : `${fi(v)}đ`);
export const fc = (v: number | null | undefined) => {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${fd(v / 1e9, 2)} tỷ`;
  if (a >= 1e6) return `${fd(v / 1e6, 2)} tr`;
  if (a >= 1e3) return `${fd(v / 1e3, 1)}k`;
  return fi(v);
};

export function fmt(kind: Kind, v: number | null | undefined, digits = 2): string {
  switch (kind) {
    case "int": return fi(v);
    case "vnd": return fv(v);
    case "pct": return fp(v, digits);
    case "x": return v == null ? "—" : `${fd(v, digits)}x`;
    case "compact": return fc(v);
    default: return fd(v, digits);
  }
}

export const shortDate = (s: string) => {
  const p = s.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : s;
};
export const dmy = (s: string | null) => {
  if (!s) return "—";
  const p = s.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
};
export const dmyHm = (s: string | null) => (s ? `${dmy(s)} ${s.slice(11, 16)}` : "—");
