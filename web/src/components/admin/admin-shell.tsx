"use client";

import { Boxes, ChartNoAxesCombined, ClipboardList, LayoutDashboard, LogOut, MessagesSquare, Package, Radio } from "lucide-react";
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
  { href: "/admin", label: "Tổng quan", Icon: LayoutDashboard },
  { href: "/admin/products", label: "Sản phẩm", Icon: Package, phase: 1 },
  { href: "/admin/orders", label: "Đơn hàng", Icon: ClipboardList, phase: 2 },
  { href: "/admin/inventory", label: "Kho", Icon: Boxes, phase: 3 },
  { href: "/admin/analytics", label: "Dashboard", Icon: ChartNoAxesCombined, phase: 4 },
  { href: "/admin/chat", label: "Chatbot", Icon: MessagesSquare, phase: 5 },
  { href: "/admin/live", label: "Live", Icon: Radio },
] as const;

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
      <div className="grid min-h-screen grid-cols-[15rem_1fr]">
        <aside className="flex flex-col gap-1 border-r border-line bg-surface p-3">
          <div className="px-3 py-4 text-lg font-extrabold tracking-tight">SnackStream</div>
          <nav aria-label="Quản trị" className="grid gap-1">
            {NAV.map((item) => {
              const active = item.href === "/admin" ? path === "/admin" : path.startsWith(item.href);
              const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium";
              if ("phase" in item) {
                return (
                  <span key={item.href} className={cn(base, "cursor-not-allowed text-muted/50")} title={`Có ở giai đoạn ${item.phase}`}>
                    <item.Icon className="size-4" /> {item.label}
                    <span className="ml-auto rounded bg-canvas px-1.5 text-[10px] font-semibold">G{item.phase}</span>
                  </span>
                );
              }
              return (
                <Link key={item.href} href={item.href} className={cn(base, active ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas")}>
                  <item.Icon className="size-4" /> {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto grid gap-2 border-t border-line px-3 pt-3 text-sm">
            <div className="truncate text-muted" title={user.email}>
              {user.email}
              <span className="ml-2 rounded bg-canvas px-1.5 text-[10px] font-semibold uppercase">{user.role}</span>
            </div>
            <button type="button" onClick={logout} className="inline-flex items-center gap-2 text-muted hover:text-ink">
              <LogOut className="size-4" /> Đăng xuất
            </button>
          </div>
        </aside>
        <main className="p-8">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}
