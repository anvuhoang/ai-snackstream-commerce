/** Placeholder cells in the same grid as the real results, so the page does not jump when they arrive. */
export function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 border-l border-t border-line lg:grid-cols-4" aria-busy="true" aria-label="Đang tải sản phẩm">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="border-b border-r border-line bg-canvas">
          <div className="m-4 h-3 w-2/3 animate-pulse bg-hair" />
          <div className="aspect-square" />
        </div>
      ))}
    </div>
  );
}
