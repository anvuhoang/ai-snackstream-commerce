/** Placeholder cards in the same grid as the real results, so the page does not jump when they arrive. */
export function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Đang tải sản phẩm">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="aspect-square animate-pulse bg-line" />
          <div className="grid gap-2 p-4">
            <div className="h-3 w-1/3 animate-pulse rounded bg-line" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-line" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-line" />
          </div>
        </div>
      ))}
    </div>
  );
}
