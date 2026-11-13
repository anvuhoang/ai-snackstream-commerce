"use client";

import { Button } from "@/components/ui/button";

export default function StoreError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto grid max-w-xl place-items-center gap-4 px-4 py-28 text-center">
      <h1 className="text-2xl font-extrabold tracking-tight">Không tải được nội dung</h1>
      <p className="text-muted">Hệ thống đang gặp sự cố tạm thời. Vui lòng thử lại sau ít phút.</p>
      <Button onClick={reset}>Thử lại</Button>
    </div>
  );
}
