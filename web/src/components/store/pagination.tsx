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
  const cell = "flex h-12 items-center px-6 text-[11px] font-medium uppercase tracking-[0.04em]";
  return (
    <nav aria-label="Phân trang" className="flex items-stretch justify-center border-b border-line">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(cell, "border-r border-line hover:bg-canvas")} rel="prev">
          ← Trước
        </Link>
      ) : (
        <span className={cn(cell, "border-r border-line opacity-30")}>← Trước</span>
      )}
      <span className={cn(cell, "text-muted")}>
        Trang {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} className={cn(cell, "border-l border-line hover:bg-canvas")} rel="next">
          Sau →
        </Link>
      ) : (
        <span className={cn(cell, "border-l border-line opacity-30")}>Sau →</span>
      )}
    </nav>
  );
}
