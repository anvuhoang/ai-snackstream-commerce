import Link from "next/link";

// Pages that do not exist yet are plain text with the phase that delivers them.
const NAV: { href: string; label: string; phase?: number }[] = [
  { href: "/products", label: "Cửa hàng" },
  { href: "/live", label: "Live" },
];

const cell = "flex items-center border-l border-line px-4 sm:px-6 transition-colors";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-[34px] items-stretch border-b border-line bg-surface text-[11px] font-medium uppercase tracking-[0.04em]">
        <Link href="/" className="flex items-center px-4 text-[13px] font-medium normal-case tracking-normal sm:w-60 sm:px-6">
          SnackStream<sup className="ml-px text-[8px]">™</sup>
        </Link>
        <nav aria-label="Điều hướng chính" className="flex flex-1 items-stretch">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={`${cell} hover:bg-ink hover:text-white`}>
              {item.label}
            </Link>
          ))}
          <span className="flex-1 border-l border-line" />
          <span className={`${cell} hidden text-muted sm:flex`} title="Tra cứu đơn có ở giai đoạn 2">
            Tra cứu đơn
          </span>
          <span className={`${cell} text-muted`} title="Giỏ hàng có ở giai đoạn 2">
            Giỏ (0)
          </span>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="flex flex-wrap justify-between gap-3 border-t border-line px-4 py-5 text-xs sm:px-6">
        <span>© SnackStream · Đặc sản ăn vặt đường phố</span>
        <span className="text-muted">Shop demo của đồ án môn học.</span>
      </footer>
    </div>
  );
}
