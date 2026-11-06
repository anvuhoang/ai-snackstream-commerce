"use client";
import type { Step } from "@/lib/types";
import { fp } from "@/lib/format";
import { A } from "./ui";
import { useInView } from "./Reveal";

function StepRow({ st, top, i }: { st: Step; top: number; i: number }) {
  const { ref, seen } = useInView<HTMLDivElement>(0.2);
  const known = st.agg.value != null;
  const pct = known && top ? Math.max(0.6, (st.agg.value! / top) * 100) : 0;
  return (
    <>
      {i > 0 && st.rate && (
        <div className="f-link">
          <span />
          <div className="mid">
            {st.rate.value != null ? (
              <>
                <b>{fp(st.rate.value)}</b> chuyển tiếp · <span className="drop">rời đi {fp(100 - st.rate.value)}</span>
                {st.rate.nUsed < st.rate.nTotal && <span className="note">(tính trên {st.rate.nUsed}/{st.rate.nTotal} nội dung đủ dữ liệu)</span>}
              </>
            ) : (
              <><span className="na" data-s="undetermined" title={st.rate.reason}>Không tính được</span><span className="note">{st.rate.reason}</span></>
            )}
          </div>
          <span />
        </div>
      )}
      <div ref={ref} className="f-step" style={{ ["--fc" as string]: `var(--f${Math.min(i + 1, 6)})`, ["--d" as string]: `${i * 120}ms` }}>
        <div className="lbl"><b>{st.label}</b><span>{st.source}</span></div>
        <div className="f-track">
          {known ? <div className="f-bar" style={{ width: seen ? `${pct}%` : "0%" }} /> : <div className="f-bar missing" />}
        </div>
        <div className="f-val"><A a={st.agg} /></div>
      </div>
    </>
  );
}

export function FunnelView({ steps }: { steps: Step[] }) {
  const top = steps[0]?.agg.value ?? 0;
  return <div className="funnel">{steps.map((s, i) => <StepRow key={s.key} st={s} top={top} i={i} />)}</div>;
}

