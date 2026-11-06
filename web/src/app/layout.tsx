import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SnackStream · Đặc sản ăn vặt", template: "%s · SnackStream" },
  description: "Bánh tráng trộn, khô bò, khô gà lá chanh và các món ăn vặt đường phố.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
