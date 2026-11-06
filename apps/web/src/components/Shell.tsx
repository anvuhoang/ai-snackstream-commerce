"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, BookOpen, Bot, Database, ExternalLink, Filter, LayoutGrid, LogOut, Package, Share2, ShoppingBag, SunMoon } from "lucide-react";
import { useApp } from "./context";

const NAV = [
  { group: "Phân tích", items: [
    { href: "/", label: "Tổng quan", Icon: LayoutGrid, keep: true },
    { href: "/shopee", label: "Shopee", Icon: ShoppingBag, keep: true },
    { href: "/external", label: "Nguồn ngoài", Icon: Share2, keep: true },
    { href: "/funnel", label: "Phễu & so sánh", Icon: Filter, keep: true },
    { href: "/ai", label: "Hiệu quả AI", Icon: Bot, keep: true },
  ] },
  { group: "Quản lý", items: [
    { href: "/products", label: "Sản phẩm & SKU", Icon: Package, keep: false },
    { href: "/data", label: "Quản lý dữ liệu", Icon: Database, keep: false },
    { href: "/metrics", label: "Định nghĩa chỉ số", Icon: BookOpen, keep: false },
  ] },
];
const FILTER_KEYS = ["from", "to", "platform", "dist", "campaign", "sku", "content", "mode"];

export function Sidebar() {
  const { me, meta } = useApp();
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();

  const keepQs = (keep: boolean) => {
    if (!keep) return "";
    const q = new URLSearchParams();
    FILTER_KEYS.forEach((k) => { const v = sp.get(k); if (v) q.set(k, v); });
    return q.size ? `?${q}` : "";
  };
  const toggleTheme = () => {
    const root = document.documentElement;
    const isDark = root.getAttribute("data-theme") === "dark" || (!root.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    root.classList.add("theme-anim");
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("ss-theme", next); } catch { /* storage may be blocked */ }
    setTimeout(() => root.classList.remove("theme-anim"), 450);
  };
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": me.csrf } });
    router.replace("/login");
    router.refresh();
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="mark"><BarChart3 size={19} color="#fff" /></span>
        <div><b>SnackStream</b><small>Analytics</small></div>
      </div>
      <nav className="nav" aria-label="Điều hướng chính">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map(({ href, label, Icon, keep }) => {
              const active = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link key={href} href={`${href}${keepQs(keep)}`} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                  <Icon size={18} /><span>{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
        <div className="nav-group">Trang công khai</div>
        <a href="/shop" target="_blank" rel="noopener"><ExternalLink size={18} /><span>Trang khách (shop)</span></a>
      </nav>
      <div className="side-foot">
        <div className="who"><span className="avatar">{me.user.slice(0, 1).toUpperCase()}</span><span>{me.user}</span></div>
        {meta.counts.demo > 0 && <span className="badge demo" style={{ justifySelf: "start" }}>Có dữ liệu DEMO</span>}
        <button type="button" onClick={toggleTheme} aria-label="Đổi giao diện sáng/tối"><SunMoon size={18} /> Sáng / Tối</button>
        <button type="button" onClick={logout}><LogOut size={18} /> Đăng xuất</button>
      </div>
    </aside>
  );
}
