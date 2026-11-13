/** Placeholder cards in the same grid as the real results, so the page does not jump when they arrive. */
export function GridSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-2 gap-4 px-4 py-8 sm:gap-5 sm:px-8 lg:grid-cols-4" aria-busy="true" aria-label="Đang tải sản phẩm">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="aspect-square animate-pulse bg-canvas" />
          <div className="grid gap-2 p-5">
            <div className="h-3 w-1/3 animate-pulse rounded bg-hair" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-hair" />
          </div>
        </div>
      ))}
    </div>
  );
}
