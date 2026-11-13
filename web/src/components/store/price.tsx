import { cn } from "@/lib/cn";
import { discountPercent, formatVnd } from "@/lib/format";

/** Price with the struck-through "was" price and the discount, when there is one. */
export function Price({
  vnd,
  compareAt,
  prefix,
  size = "md",
}: {
  vnd: number;
  compareAt?: number | null;
  prefix?: string;
  size?: "md" | "lg";
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {prefix && <span className="text-xs text-muted">{prefix}</span>}
      <span className={cn("font-medium", size === "lg" ? "text-3xl font-light tracking-[-0.03em]" : "text-sm")}>{formatVnd(vnd)}</span>
      {compareAt ? (
        <>
          <s className="text-xs text-muted">{formatVnd(compareAt)}</s>
          <span className="border border-ink px-1.5 text-[10px] font-medium">-{discountPercent(vnd, compareAt)}%</span>
        </>
      ) : null}
    </p>
  );
}
