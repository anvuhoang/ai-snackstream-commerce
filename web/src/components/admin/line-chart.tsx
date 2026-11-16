"use client";

import { useId, useState } from "react";
import { formatVnd } from "@/lib/format";

export type Series = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

type Props = {
  title: string;
  /** One YYYY-MM-DD per point. */
  days: string[];
  series: Series[];
  /** "area" draws a line with a soft fill; "bars" draws one rounded bar per series per day. */
  kind?: "area" | "bars";
  /** Plain data only: a server page cannot hand a function to this client component, so the unit picks the number format. */
  unit?: "count" | "vnd";
  /** Show each series' total for the period in the header. Turn off when a sum over days would double count (distinct sessions). */
  showTotals?: boolean;
  note?: string;
};

const W = 640;
const H = 250;
const PAD = { l: 48, r: 12, t: 14, b: 30 };
const PW = W - PAD.l - PAD.r;
const PH = H - PAD.t - PAD.b;

const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const compactVnd = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}tr` : n >= 1_000 ? `${+(n / 1_000).toFixed(0)}k` : String(n));

/** A round top for the y axis (1, 2 or 5 times a power of ten) so every gridline reads as a plain number. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** A bar whose top corners are rounded and whose foot sits square on the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/**
 * A daily time series on ONE y axis (two measures with different units belong in two charts). Hovering, or the arrow keys, pick
 * the nearest day: a band marks it and one tooltip lists every series. The numbers are also in a table under the chart, so the
 * tooltip is never the only way to read a value.
 */
export function LineChart({ title, days, series, kind = "area", unit = "count", showTotals = true, note }: Props) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const format = unit === "vnd" ? formatVnd : (n: number) => n.toLocaleString("vi-VN");
  const axis = unit === "vnd" ? compactVnd : (n: number) => n.toLocaleString("vi-VN");
  const n = days.length;
  const yMax = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const empty = series.every((s) => s.values.every((v) => v === 0));
  const step = PW / Math.max(1, n);
  // Bars sit in the middle of their slot; an area chart runs edge to edge.
  const x = (i: number) => (kind === "bars" ? PAD.l + step * (i + 0.5) : PAD.l + (n <= 1 ? PW / 2 : (i * PW) / (n - 1)));
  const y = (v: number) => PAD.t + PH - (v / yMax) * PH;
  const ticks = [0, yMax / 2, yMax];
  const every = Math.max(1, Math.ceil(n / 6));
  const labelAt = days.map((_, i) => i).filter((i) => i % every === 0 || i === n - 1).filter((i) => i === n - 1 || n - 1 - i >= every * 0.6);

  function move(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = kind === "bars" ? Math.floor((px - PAD.l) / step) : n <= 1 ? 0 : Math.round(((px - PAD.l) / PW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }

  const totals = series.map((s) => s.values.reduce((a, b) => a + b, 0));
  const flip = hover !== null && x(hover) / W > 0.6;
  const slot = step * 0.72;
  const barW = Math.max(3, slot / series.length - 2);

  return (
    <section className="rounded-[20px] border border-line bg-surface" aria-label={title}>
      <header className="grid gap-3 px-5 pb-1 pt-4">
        <h2 className="text-sm font-extrabold">{title}</h2>
        {showTotals && (
          <ul className="flex flex-wrap items-end gap-x-7 gap-y-2" aria-label="Tổng cả kỳ">
            {series.map((s, i) => (
              <li key={s.key} className="grid gap-0.5">
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="inline-block size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                  {series.length > 1 ? s.label : "Tổng cả kỳ"}
                </span>
                <b className="text-[26px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{format(totals[i])}</b>
              </li>
            ))}
          </ul>
        )}
        {!showTotals && series.length > 1 && (
          <ul className="flex flex-wrap gap-4 text-xs text-muted" aria-label="Chú giải">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="relative px-2 pb-2 pt-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-accent"
          role="img"
          tabIndex={0}
          aria-label={`${title}. Dùng phím mũi tên trái phải để xem từng ngày.`}
          onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
            else if (e.key === "Escape") setHover(null);
          }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.26} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "var(--color-line)" : "var(--color-hair)"}
                strokeWidth={1}
                strokeDasharray={t === 0 ? undefined : "3 4"}
              />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)" className="tabular-nums">
                {axis(t)}
              </text>
            </g>
          ))}
          {labelAt.map((i) => (
            <text key={i} x={x(i)} y={H - 9} textAnchor={i === n - 1 && n > 1 ? "end" : "middle"} fontSize={11} fill={hover === i ? "var(--color-ink)" : "var(--color-muted)"}>
              {dayLabel(days[i])}
            </text>
          ))}

          {hover !== null && kind === "bars" && (
            <rect x={PAD.l + step * hover} y={PAD.t} width={step} height={PH} fill="var(--color-ink)" opacity={0.05} rx={4} />
          )}

          {kind === "area" &&
            series.map((s) => (
              <g key={s.key}>
                {n > 1 && (
                  <path
                    d={`M${x(0)},${y(0)} ${s.values.map((v, i) => `L${x(i)},${y(v)}`).join(" ")} L${x(n - 1)},${y(0)} Z`}
                    fill={`url(#${uid}-${s.key})`}
                  />
                )}
                <polyline
                  points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.25}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* the latest day is always marked, so the eye lands on "now" */}
                <circle cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={4.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
              </g>
            ))}

          {kind === "bars" &&
            days.map((d, i) =>
              series.map((s, k) => {
                const h = (s.values[i] / yMax) * PH;
                const left = x(i) - (barW * series.length + 2 * (series.length - 1)) / 2 + k * (barW + 2);
                return (
                  <path
                    key={`${d}-${s.key}`}
                    d={barPath(left, PAD.t + PH - h, barW, h, 3)}
                    fill={s.color}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                );
              }),
            )}

          {hover !== null && kind === "area" && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--color-ink)" strokeWidth={1} opacity={0.3} />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2.5} />
              ))}
            </g>
          )}
        </svg>

        {empty && <p className="pointer-events-none absolute inset-x-0 top-[44%] text-center text-sm text-muted">Chưa có dữ liệu trong khoảng này.</p>}

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs shadow-lg"
            style={{ left: `${((x(hover) / W) * 100).toFixed(2)}%`, transform: `translateX(${flip ? "calc(-100% - 12px)" : "12px"})` }}
            role="status"
          >
            <div className="mb-1.5 font-medium text-muted">Ngày {dayLabel(days[hover])}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-6 py-0.5">
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="inline-block size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
                <b className="text-sm font-extrabold tabular-nums text-ink">{format(s.values[hover])}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="border-t border-hair px-5 py-2 text-xs text-muted">
        <summary className="cursor-pointer select-none py-1">Xem bảng số liệu</summary>
        <div className="max-h-56 overflow-auto">
          <table className="my-2 w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.04em]">
                <th className="py-1 pr-3 font-medium">Ngày</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d} className="border-t border-hair">
                  <td className="py-1 pr-3">{dayLabel(d)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 pr-3 text-right tabular-nums text-ink">
                      {format(s.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {note && <p className="border-t border-hair px-5 py-3 text-xs text-muted">{note}</p>}
    </section>
  );
}
