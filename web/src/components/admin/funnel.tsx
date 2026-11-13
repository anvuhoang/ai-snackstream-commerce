import { Badge } from "@/components/ui/badge";
import { formatPercent, STEP_LABEL, type FunnelStep } from "@/lib/analytics";

function rateText(step: FunnelStep): string {
  if (step.rateNote === "first_step") return "Bước đầu tiên";
  if (step.rateNote === "previous_step_empty") return "Không tính được: bước trước chưa có dữ liệu";
  return step.rate === null ? "Không tính được" : `${formatPercent(step.rate)} so với bước trước`;
}

/**
 * One funnel, ranked bars on a single scale and a single colour: a funnel is one series in order, so there is nothing to tell apart
 * by colour. Every number is also printed, so the bars are never the only way to read it. A group holds steps of the SAME unit
 * (sessions or orders); the two units are never drawn on one scale.
 */
export function FunnelGroup({ title, unitLabel, steps }: { title: string; unitLabel: string; steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <section className="border border-line bg-surface" aria-label={title}>
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em]">{title}</h2>
        <span className="text-[11px] text-muted">Đơn vị: {unitLabel}</span>
      </header>
      <ol>
        {steps.map((s) => (
          <li key={s.key} className="grid gap-1.5 border-b border-hair px-5 py-4 last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                {STEP_LABEL[s.key]}
                {s.trackingGap && <Badge tone="warn">Thiếu dữ liệu theo dõi</Badge>}
              </span>
              <b className="text-lg font-medium tabular-nums">{s.count.toLocaleString("vi-VN")}</b>
            </div>
            <div className="h-3 bg-canvas" title={`${STEP_LABEL[s.key]}: ${s.count.toLocaleString("vi-VN")} ${unitLabel}`}>
              {s.count > 0 && <div className="h-full min-w-[2px] bg-ink" style={{ width: `${(s.count / max) * 100}%` }} />}
            </div>
            <p className="text-xs text-muted">{rateText(s)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
