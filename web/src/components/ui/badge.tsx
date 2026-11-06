import { cn } from "@/lib/cn";

const tone = {
  neutral: "bg-canvas text-muted",
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
  danger: "bg-danger/10 text-danger",
} as const;

export function Badge({ tone: t = "neutral", className, children }: { tone?: keyof typeof tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", tone[t], className)}>{children}</span>;
}
