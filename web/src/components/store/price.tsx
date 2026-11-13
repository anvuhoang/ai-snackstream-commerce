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
      <span className={cn("font-extrabold", size === "lg" ? "text-4xl tracking-[-0.03em]" : "text-base")}>{formatVnd(vnd)}</span>
      {compareAt ? (
        <>
          <s className="text-sm text-muted">{formatVnd(compareAt)}</s>
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">-{discountPercent(vnd, compareAt)}%</span>
        </>
      ) : null}
    </p>
  );
}
