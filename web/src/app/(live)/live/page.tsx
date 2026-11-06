import type { Metadata } from "next";

export const metadata: Metadata = { title: "Live" };

export default function LivePage() {
  return (
    <div className="mx-auto grid min-h-screen max-w-3xl place-content-center gap-3 px-4 text-center">
      <h1 className="text-3xl font-extrabold tracking-tight">Phiên live</h1>
      <p className="text-muted">Trang xem live sẽ có ở giai đoạn 6 (trình phát, bình luận, món ghim).</p>
    </div>
  );
}
