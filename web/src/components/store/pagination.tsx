import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const link = "inline-flex h-10 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-sm font-medium";
  return (
    <nav aria-label="Phân trang" className="mt-10 flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(link, "hover:bg-canvas")} rel="prev">
          <ChevronLeft className="size-4" /> Trước
        </Link>
      ) : (
        <span className={cn(link, "pointer-events-none opacity-40")}>
          <ChevronLeft className="size-4" /> Trước
        </span>
      )}
      <span className="text-sm text-muted">
        Trang {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} className={cn(link, "hover:bg-canvas")} rel="next">
          Sau <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span className={cn(link, "pointer-events-none opacity-40")}>
          Sau <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
