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
      {prefix && <span className="text-sm text-muted">{prefix}</span>}
      <span className={cn("font-extrabold text-brand", size === "lg" ? "text-3xl" : "text-lg")}>{formatVnd(vnd)}</span>
      {compareAt ? (
        <>
          <s className="text-sm text-muted">{formatVnd(compareAt)}</s>
          <span className="rounded bg-brand-soft px-1.5 text-xs font-bold text-brand">-{discountPercent(vnd, compareAt)}%</span>
        </>
      ) : null}
    </p>
  );
}
