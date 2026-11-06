"use client";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fc, fmt, shortDate } from "@/lib/format";
import type { Kind } from "@/lib/types";
import { useInView } from "./Reveal";

export type Dataset = { label: string; color: string; data: (number | null)[] };

type TipProps = { active?: boolean; label?: string; payload?: { name: string; value: number | null; color: string }[]; kind: Kind };
function Tip({ active, label, payload, kind }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", boxShadow: "var(--shadow-lg)", fontSize: 12.5 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", lineHeight: 1.7 }}>
          <i style={{ width: 9, height: 9, borderRadius: 3, background: p.color, display: "inline-block" }} />
          {p.name}: <b style={{ color: "var(--text)" }}>{p.value == null ? "—" : fmt(kind, p.value)}</b>
        </div>
      ))}
    </div>
  );
}

export function ChartCard({ title, sub, type, labels, datasets, kind = "int", dates = false, horizontal = false, tall = false, stack = false, index = 0 }: {
  title: string; sub?: string; type: "line" | "bar"; labels: string[]; datasets: Dataset[]; kind?: Kind; dates?: boolean;
  horizontal?: boolean; tall?: boolean; stack?: boolean; index?: number;
}) {
  const [table, setTable] = useState(false);
  const { ref, seen } = useInView<HTMLDivElement>(0.12);
  const names = labels.map((l) => (dates ? shortDate(l) : l));
  const data = names.map((name, i) => Object.fromEntries([["name", name], ...datasets.map((d) => [d.label, d.data[i]])]));
  const tick = { fill: "var(--text-3)", fontSize: 12 };
  const yFmt = (v: number) => (kind === "int" || kind === "vnd" ? fc(v) : fmt(kind, v));
  const margin = { top: 6, right: 8, left: horizontal ? 8 : -4, bottom: 0 };
  const legend = datasets.length > 1 ? (
    <Legend verticalAlign="top" align="left" iconType="circle" iconSize={9} wrapperStyle={{ paddingBottom: 10, fontSize: 12, color: "var(--text-2)" }} />
  ) : null;
  const cursor = { stroke: "var(--border-strong)", strokeDasharray: "3 3", fill: "color-mix(in srgb, var(--text) 5%, transparent)" };

  return (
    <section ref={ref} className={`card chart-panel rv ${seen ? "in" : ""}`} style={{ ["--d" as string]: `${Math.min(index, 9) * 55}ms` }}>
      <div className="card-h">
        <div><h2>{title}</h2>{sub && <p className="sub">{sub}</p>}</div>
        <div className="chart-tools">
          <button type="button" className="btn sm" aria-pressed={table} onClick={() => setTable((t) => !t)}>{table ? "Biểu đồ" : "Bảng"}</button>
        </div>
      </div>
      <div className="card-b">
        {table ? (
          <div className="chart-table" style={{ display: "block" }}>
            <table className="tbl">
              <thead><tr><th>{dates ? "Ngày" : ""}</th>{datasets.map((d) => <th key={d.label} className="n">{d.label}</th>)}</tr></thead>
              <tbody>
                {names.map((n, i) => (
                  <tr key={n + i}><td>{n}</td>{datasets.map((d) => <td key={d.label} className="n">{d.data[i] == null ? "—" : fmt(kind, d.data[i])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={`chart-box${tall ? " tall" : ""}`} role="img" aria-label={title}>
            {seen && (
              <ResponsiveContainer width="100%" height="100%">
                {type === "line" ? (
                  <LineChart data={data} margin={margin}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="name" tick={tick} tickLine={false} axisLine={{ stroke: "var(--grid)" }} interval="preserveStartEnd" minTickGap={28} />
                    <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={yFmt} width={52} />
                    <Tooltip content={<Tip kind={kind} />} cursor={cursor} />
                    {legend}
                    {datasets.map((d) => (
                      <Line key={d.label} type="monotone" dataKey={d.label} stroke={d.color} strokeWidth={2} dot={false} connectNulls={false}
                        activeDot={{ r: 4.5, stroke: "var(--surface)", strokeWidth: 2 }} animationDuration={1100} animationEasing="ease-out" />
                    ))}
                  </LineChart>
                ) : (
                  <BarChart data={data} margin={margin} layout={horizontal ? "vertical" : "horizontal"} barCategoryGap={horizontal ? "28%" : "18%"}>
                    <CartesianGrid stroke="var(--grid)" vertical={horizontal} horizontal={!horizontal} />
                    {horizontal ? (
                      <>
                        <XAxis type="number" tick={tick} tickLine={false} axisLine={false} tickFormatter={yFmt} />
                        <YAxis type="category" dataKey="name" tick={tick} tickLine={false} axisLine={{ stroke: "var(--grid)" }} width={86} />
                      </>
                    ) : (
                      <>
                        <XAxis dataKey="name" tick={tick} tickLine={false} axisLine={{ stroke: "var(--grid)" }} interval="preserveStartEnd" minTickGap={24} />
                        <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={yFmt} width={52} />
                      </>
                    )}
                    <Tooltip content={<Tip kind={kind} />} cursor={cursor} />
                    {legend}
                    {datasets.map((d) => (
                      <Bar key={d.label} dataKey={d.label} fill={d.color} stackId={stack ? "s" : undefined}
                        radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} animationDuration={900} animationEasing="ease-out" />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
