import type { Metadata } from "next";

export const metadata: Metadata = { title: "Quản trị" };

export default function AdminHome() {
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Tổng quan</h1>
      <p className="mt-2 max-w-xl text-muted">
        Khu quản trị đã sẵn sàng. Các mục ở thanh bên sẽ được mở lần lượt theo từng giai đoạn của lộ trình.
      </p>
    </div>
  );
}
