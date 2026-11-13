import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function StoreNotFound() {
  return (
    <div className="mx-auto grid max-w-xl place-items-center gap-4 px-4 py-28 text-center">
      <p className="text-5xl font-extrabold text-brand">404</p>
      <h1 className="text-2xl font-extrabold tracking-tight">Không tìm thấy trang này</h1>
      <p className="text-muted">Sản phẩm có thể đã ngừng bán hoặc đường dẫn bị sai.</p>
      <Link href="/products" className={buttonClass()}>
        Xem sản phẩm
      </Link>
    </div>
  );
}
