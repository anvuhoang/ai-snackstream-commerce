import { cn } from "@/lib/cn";

// Status is told by outline, fill or dashes plus the label, never by colour alone.
const tone = {
  neutral: "border-ink text-ink",
  brand: "border-ink bg-ink text-white",
  ok: "border-ink text-ink",
  warn: "border-dashed border-muted text-muted",
  danger: "border-danger text-danger",
} as const;

export function Badge({ tone: t = "neutral", className, children }: { tone?: keyof typeof tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 items-center border px-2 text-[10px] font-medium uppercase tracking-[0.04em]", tone[t], className)}>
      {children}
    </span>
  );
}
