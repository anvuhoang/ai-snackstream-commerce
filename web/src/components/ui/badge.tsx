import { cn } from "@/lib/cn";

// The colour helps the eye find the state; the label always says it, so colour is never the only signal.
const tone = {
  neutral: "border-line bg-canvas text-ink",
  brand: "border-accent bg-accent text-white",
  ok: "border-ok/25 bg-ok-soft text-ok",
  warn: "border-warn/25 bg-warn-soft text-warn",
  danger: "border-danger/25 bg-danger-soft text-danger",
} as const;

export function Badge({ tone: t = "neutral", className, children }: { tone?: keyof typeof tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold", tone[t], className)}>
      {children}
    </span>
  );
}
