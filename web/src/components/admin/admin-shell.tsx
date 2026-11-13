"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext } from "react";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { cn } from "@/lib/cn";

type User = { id: number; email: string; role: "admin" | "staff" };
const AdminContext = createContext<{ user: User; csrf: string } | null>(null);

/** Current admin and the CSRF token that every write request must send (see adminHeaders). */
export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminShell>");
  return ctx;
}

// `phase` marks sections that are planned but not built yet (see docs/ROADMAP.md).
const NAV = [
  { href: "/admin", label: "Tổng quan" },
  { href: "/admin/products", label: "Sản phẩm" },
  { href: "/admin/categories", label: "Danh mục" },
  { href: "/admin/orders", label: "Đơn hàng" },
  { href: "/admin/inventory", label: "Kho", phase: 3 },
  { href: "/admin/analytics", label: "Dashboard", phase: 4 },
  { href: "/admin/chat", label: "Chatbot", phase: 5 },
  { href: "/admin/live", label: "Live", phase: 6 },
] as const;

const cell = "flex items-center whitespace-nowrap border-l border-line px-4 sm:px-6 transition-colors";

export function AdminShell({ user, csrf, children }: { user: User; csrf: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await browserApi.POST("/api/admin/auth/logout", { headers: adminHeaders(csrf) });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <AdminContext.Provider value={{ user, csrf }}>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 flex h-[34px] items-stretch border-b border-line bg-surface text-[11px] font-medium uppercase tracking-[0.04em]">
          <div className="flex items-center px-4 text-[13px] normal-case tracking-normal sm:w-60 sm:px-6">
            SnackStream
            <span className="ml-2 text-[11px] uppercase tracking-[0.04em] text-muted">Admin</span>
          </div>
          <nav aria-label="Quản trị" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
            {NAV.map((item) => {
              const active = item.href === "/admin" ? path === "/admin" : path.startsWith(item.href);
              if ("phase" in item) {
                return (
                  <span key={item.href} className={cn(cell, "hidden cursor-not-allowed text-muted lg:flex")} title={`Có ở giai đoạn ${item.phase}`}>
                    {item.label}
                    <span className="ml-1.5 text-[9px]">G{item.phase}</span>
                  </span>
                );
              }
              return (
                <Link key={item.href} href={item.href} className={cn(cell, active ? "font-semibold underline underline-offset-4" : "hover:bg-ink hover:text-white")}>
                  {item.label}
                </Link>
              );
            })}
            <span className="min-w-4 flex-1 border-l border-line" />
          </nav>
          <span className={cn(cell, "hidden normal-case tracking-normal text-muted md:flex")} title={user.email}>
            {user.email}
            <span className="ml-2 border border-line px-1 text-[9px] uppercase">{user.role}</span>
          </span>
          <button type="button" onClick={logout} className={cn(cell, "uppercase hover:bg-ink hover:text-white")}>
            Đăng xuất
          </button>
        </header>
        <main className="flex-1 p-4 sm:p-8">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}
