import Link from "next/link";
import { CartLink } from "@/components/cart/cart-link";
import { CartProvider } from "@/components/cart/cart-provider";

const NAV: { href: string; label: string }[] = [
  { href: "/products", label: "Cửa hàng" },
  { href: "/live", label: "Live" },
];

const cell = "flex items-center border-l border-line px-4 sm:px-6 transition-colors hover:bg-ink hover:text-white";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 flex h-[34px] items-stretch border-b border-line bg-surface text-[11px] font-medium uppercase tracking-[0.04em]">
          <Link href="/" className="flex items-center px-4 text-[13px] font-medium normal-case tracking-normal sm:w-60 sm:px-6">
            SnackStream<sup className="ml-px text-[8px]">™</sup>
          </Link>
          <nav aria-label="Điều hướng chính" className="flex flex-1 items-stretch">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className={cell}>
                {item.label}
              </Link>
            ))}
            <span className="flex-1 border-l border-line" />
            <Link href="/orders/lookup" className={`${cell} hidden sm:flex`}>
              Tra cứu đơn
            </Link>
            <CartLink className={cell} />
          </nav>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="flex flex-wrap justify-between gap-3 border-t border-line px-4 py-5 text-xs sm:px-6">
          <span>© SnackStream · Đặc sản ăn vặt đường phố</span>
          <span className="flex gap-6">
            <Link href="/orders/lookup" className="border-b border-current">
              Tra cứu đơn hàng
            </Link>
            <span className="text-muted">Shop demo của đồ án môn học. Thanh toán online chỉ là sandbox.</span>
          </span>
        </footer>
      </div>
    </CartProvider>
  );
}
