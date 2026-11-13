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

const NAV = [
  { href: "/admin", label: "Tổng quan" },
  { href: "/admin/products", label: "Sản phẩm" },
  { href: "/admin/categories", label: "Danh mục" },
  { href: "/admin/orders", label: "Đơn hàng" },
  { href: "/admin/inventory", label: "Kho" },
  { href: "/admin/analytics", label: "Dashboard" },
  { href: "/admin/chat", label: "Chatbot" },
  { href: "/admin/live", label: "Live" },
] as const;

const item = "flex items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-3 text-[15px] font-medium transition-colors";

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
      <div className="flex min-h-screen flex-wrap bg-canvas/40">
        <aside className="flex basis-full flex-col gap-1 bg-leaf p-4 text-paper md:sticky md:top-0 md:h-screen md:basis-[248px] md:shrink-0 md:overflow-y-auto">
          <Link href="/admin" className="px-3.5 pb-3 pt-1.5 text-[22px] font-extrabold tracking-[-0.03em] text-turmeric">
            SnackStream <span className="text-xs font-semibold tracking-[0.04em] text-leaf-soft">ADMIN</span>
          </Link>
          <nav aria-label="Quản trị" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {NAV.map((n) => {
              const active = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(item, active ? "bg-paper font-semibold text-leaf" : "text-leaf-soft hover:bg-paper/10")}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto hidden gap-3 border-t border-paper/20 px-3.5 pt-4 md:grid">
            <div className="grid gap-0.5 text-[13px]">
              <span className="text-leaf-soft">Đăng nhập với</span>
              <b className="break-all font-semibold" title={user.email}>
                {user.email}
              </b>
              <span className="w-fit rounded-full bg-paper/15 px-2 py-0.5 text-[11px] font-semibold uppercase">{user.role}</span>
            </div>
            <button type="button" onClick={logout} className="h-10 rounded-xl border-2 border-paper/40 text-sm font-semibold transition-colors hover:bg-paper hover:text-leaf">
              Đăng xuất
            </button>
          </div>
          <button type="button" onClick={logout} className="h-10 rounded-xl border-2 border-paper/40 text-sm font-semibold transition-colors hover:bg-paper hover:text-leaf md:hidden">
            Đăng xuất
          </button>
        </aside>
        <main className="min-w-0 flex-[999_1_640px] p-4 sm:p-8">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}
