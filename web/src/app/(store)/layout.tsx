import Link from "next/link";
import { Radio, ShoppingBasket } from "lucide-react";

// Links whose pages do not exist yet are rendered as plain text with the phase that delivers them.
const NAV: { href: string; label: string; phase?: number }[] = [
  { href: "/", label: "Trang chủ" },
  { href: "/products", label: "Sản phẩm", phase: 1 },
  { href: "/live", label: "Live" },
];

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-brand text-white">S</span>
            SnackStream
          </Link>
          <nav aria-label="Điều hướng chính" className="flex items-center gap-1 text-sm font-medium">
            {NAV.map((item) =>
              item.phase ? (
                <span key={item.href} className="px-3 py-2 text-muted/60" title={`Có ở giai đoạn ${item.phase}`}>
                  {item.label}
                </span>
              ) : (
                <Link key={item.href} href={item.href} className="rounded-lg px-3 py-2 text-muted hover:bg-canvas hover:text-ink">
                  {item.href === "/live" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Radio className="size-4" /> {item.label}
                    </span>
                  ) : (
                    item.label
                  )}
                </Link>
              ),
            )}
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-muted/60" title="Giỏ hàng có ở giai đoạn 2">
              <ShoppingBasket className="size-4" /> Giỏ
            </span>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line py-8 text-center text-sm text-muted">
        © SnackStream · Đặc sản ăn vặt đường phố
      </footer>
    </div>
  );
}
