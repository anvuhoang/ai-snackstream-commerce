import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { serverApi } from "@/lib/api/server";

/** Every page under /admin (except /admin/login) is guarded here, on the server, before anything renders. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const api = await serverApi();
  const { data } = await api.GET("/api/admin/auth/me");
  if (!data) redirect("/admin/login");
  return (
    <AdminShell user={data.user} csrf={data.csrf}>
      {children}
    </AdminShell>
  );
}
