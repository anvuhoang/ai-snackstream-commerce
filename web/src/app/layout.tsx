import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { UtmCapture } from "@/components/analytics/tracker";
import "./globals.css";

// Designed for Vietnamese: every tone mark sits correctly at every weight.
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-be-vietnam",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "SnackStream · Đặc sản ăn vặt", template: "%s · SnackStream" },
  description: "Bánh tráng trộn, khô bò, khô gà lá chanh và các món ăn vặt đường phố.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={beVietnam.variable}>
      <body className="min-h-screen">
        <UtmCapture />
        {children}
      </body>
    </html>
  );
}
