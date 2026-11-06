"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "./context";

/** Select that writes one URL parameter (keeping the other filters). */
export function ParamSelect({ name, options, label, placeholder, current, reset = [] }: {
  name: string; current?: string; options: { value: string; label: string }[]; label?: string; placeholder?: string; reset?: string[];
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <select className="ctl" aria-label={label ?? name} value={sp.get(name) ?? current ?? ""} style={{ maxWidth: 220 }}
      onChange={(e) => {
        const q = new URLSearchParams(sp.toString());
        if (e.target.value) q.set(name, e.target.value); else q.delete(name);
        reset.forEach((k) => q.delete(k));
        router.push(`${path}?${q}`, { scroll: false });
      }}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Warning that demo data is being viewed (only when demo data exists and "Real data" is not selected). */
export function DemoBanner() {
  const { meta } = useApp();
  const mode = useSearchParams().get("mode");
  const path = usePathname();
  const sp = useSearchParams();
  if (!meta.counts.demo || mode === "real") return null;
  const q = new URLSearchParams(sp.toString());
  q.set("mode", "real");
  return (
    <div className="alert warn">
      <svg className="i" viewBox="0 0 24 24" aria-hidden><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18.5v.1" /></svg>
      <div><b>Đang hiển thị dữ liệu DEMO.</b> Các con số bên dưới là dữ liệu minh họa có nhãn, không phải kết quả bán hàng thật. Chuyển sang{" "}
        <a href={`${path}?${q}`}><u>Dữ liệu thật</u></a> để chỉ xem số liệu đã nhập.</div>
    </div>
  );
}
