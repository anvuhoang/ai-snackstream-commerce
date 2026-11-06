import { Suspense, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Me, Meta } from "@/lib/types";
import { AppProvider } from "@/components/context";
import { Sidebar } from "@/components/Shell";
import { Notice } from "@/components/ui";

export default async function DashLayout({ children }: { children: ReactNode }) {
  const [me, meta] = await Promise.all([api<Me>("/api/auth/me"), api<Meta>("/api/meta")]);
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in server time
  return (
    <AppProvider value={{ me, meta, today }}>
      <div className="app">
        <Suspense fallback={<aside className="sidebar" />}><Sidebar /></Suspense>
        <div className="main">
          {me.defaultPassword && (
            <div style={{ padding: "16px 32px 0" }}>
              <Notice kind="warn"><b>Đang dùng mật khẩu mặc định.</b> Đặt <code>ADMIN_PASSWORD</code> hoặc <code>ADMIN_PASSWORD_HASH</code> trong cấu hình API trước khi triển khai.</Notice>
            </div>
          )}
          {children}
        </div>
      </div>
    </AppProvider>
  );
}
