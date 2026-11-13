"use client";

import Image from "next/image";
import { useState } from "react";

export function ProductPhoto({ src, name, sizes = "(max-width: 640px) 90vw, 30vw" }: { src?: string | null; name: string; sizes?: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="overflow-hidden rounded-xl bg-canvas" style={{ width: "100%", aspectRatio: "1 / 1" }}>
    {src && !failed ? <Image src={src} alt={name} width={1024} height={1024} sizes={sizes} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} onError={() => setFailed(true)} /> : <div className="grid h-full place-items-center p-4 text-center text-sm text-muted">Chưa có ảnh sản phẩm</div>}
  </div>;
}
