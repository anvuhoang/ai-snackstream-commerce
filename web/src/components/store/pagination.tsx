import Link from "next/link";
import { cn } from "@/lib/cn";

/** Previous / next with the current position. `hrefFor(page)` builds the link so filters are kept. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const cell = "inline-flex h-11 items-center rounded-full border-2 border-ink px-5 text-sm font-semibold";
  return (
    <nav aria-label="Phân trang" className="flex items-center justify-center gap-3 py-2">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(cell, "transition-colors hover:bg-canvas")} rel="prev">
          ← Trước
        </Link>
      ) : (
        <span className={cn(cell, "opacity-30")}>← Trước</span>
      )}
      <span className="px-2 text-sm font-medium text-muted">
        Trang {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} className={cn(cell, "transition-colors hover:bg-canvas")} rel="next">
          Sau →
        </Link>
      ) : (
        <span className={cn(cell, "opacity-30")}>Sau →</span>
      )}
    </nav>
  );
}
