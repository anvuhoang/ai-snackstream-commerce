import { cn } from "@/lib/cn";

/**
 * The SnackStream mark (the yellow S on a red tile, /public/brand/logo-mark.svg) with the two-tone wordmark.
 * "onDark" is for the green admin sidebar and the dark footer, where the wordmark switches to paper and turmeric.
 */
export function Logo({ size = 32, onDark = false, className }: { size?: number; onDark?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-extrabold leading-none tracking-[-0.03em]", className)} style={{ fontSize: size * 0.8 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG, nothing to optimise */}
      <img src="/brand/logo-mark.svg" alt="" width={size} height={size} className="shrink-0" />
      <span>
        <span className={onDark ? "text-paper" : "text-ink"}>Snack</span>
        <span className={onDark ? "text-turmeric" : "text-accent"}>Stream</span>
      </span>
    </span>
  );
}
