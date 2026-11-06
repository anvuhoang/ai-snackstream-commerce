import type { Metadata } from "next";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SnackStream Analytics", template: "%s · SnackStream Analytics" },
  robots: { index: false, follow: false },
  icons: { icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23d9441c'/%3E%3C/svg%3E" },
};

// Runs before first paint: sets the .js flag and applies the saved theme (avoids a light/dark flash)
const boot = `document.documentElement.classList.add("js");try{var t=localStorage.getItem("ss-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body>
        <NextTopLoader color="#d9441c" height={3} showSpinner={false} shadow="0 0 10px #d9441c" />
        {children}
      </body>
    </html>
  );
}
