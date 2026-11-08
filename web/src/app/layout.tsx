import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import "./globals.css";

const interTight = Inter_Tight({ subsets: ["latin", "vietnamese"], variable: "--font-inter-tight", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SnackStream · Đặc sản ăn vặt", template: "%s · SnackStream" },
  description: "Bánh tráng trộn, khô bò, khô gà lá chanh và các món ăn vặt đường phố.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={interTight.variable}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
