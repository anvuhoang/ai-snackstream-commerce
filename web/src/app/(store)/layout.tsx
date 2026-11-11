import Link from "next/link";
import { CartLink } from "@/components/cart/cart-link";
import { CartProvider } from "@/components/cart/cart-provider";

const NAV: { href: string; label: string }[] = [
  { href: "/products", label: "Cửa hàng" },
  { href: "/live", label: "Live" },
];

const link = "rounded-[10px] px-3.5 py-2.5 text-[15px] font-medium transition-colors hover:bg-canvas";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div className="flex min-h-screen flex-col">
        <div className="bg-leaf px-4 py-2.5 text-center text-[13px] font-medium text-paper">
          Miễn phí giao từ 300.000đ · Thanh toán khi nhận hàng · Tra cứu đơn không cần tài khoản
        </div>
        <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
          <div className="mx-auto flex h-[72px] w-full max-w-[1200px] items-center gap-3 px-4 sm:gap-6 sm:px-8">
            <Link href="/" className="text-2xl font-extrabold tracking-[-0.03em] text-accent">
              SnackStream
            </Link>
            <nav aria-label="Điều hướng chính" className="hidden flex-1 items-center gap-1 md:flex">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className={link}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <span className="flex-1 md:hidden" />
            <Link href="/orders/lookup" className={`${link} hidden sm:block`}>
              Tra cứu đơn
            </Link>
            <CartLink className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover" />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="mt-16 overflow-hidden bg-ink text-[#eadbbd]">
          <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-start justify-between gap-x-12 gap-y-6 px-4 pb-6 pt-12 text-sm sm:px-8">
            <div className="grid max-w-sm gap-2">
              <b className="text-xl font-extrabold tracking-[-0.03em] text-turmeric">SnackStream</b>
              <span className="leading-relaxed">Đặc sản ăn vặt đường phố. Shop demo của đồ án môn học, thanh toán online chỉ là môi trường thử nghiệm.</span>
            </div>
            <div className="grid gap-2.5">
              <b className="text-paper">Hỗ trợ</b>
              <Link href="/orders/lookup" className="hover:text-paper">
                Tra cứu đơn hàng
              </Link>
              <Link href="/checkout" className="hover:text-paper">
                Giỏ hàng
              </Link>
            </div>
          </div>
          <div aria-hidden className="select-none whitespace-nowrap pl-[2vw] text-[clamp(64px,17vw,230px)] font-extrabold leading-[0.8] tracking-[-0.06em] text-turmeric">
            SnackStream
          </div>
        </footer>
      </div>
    </CartProvider>
  );
}
