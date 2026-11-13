"use client";

import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ProductImage } from "@/components/store/product-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormRow, Status } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { AdminProduct } from "@/lib/catalog";
import { errorText } from "@/lib/errors";
import { useAdmin } from "./admin-shell";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export function ImagesEditor({ product }: { product: AdminProduct }) {
  const router = useRouter();
  const { user, csrf } = useAdmin();
  const disabled = user.role !== "admin";
  const fileRef = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const headers = adminHeaders(csrf);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setMessage({ kind: "error", text: "Chọn một ảnh." });
    if (!TYPES.includes(file.type)) return setMessage({ kind: "error", text: "Chỉ nhận ảnh JPEG, PNG hoặc WebP." });
    if (file.size > MAX_BYTES) return setMessage({ kind: "error", text: "Ảnh quá lớn (tối đa 5 MB)." });

    setBusy(true);
    setMessage(null);
    const body = new FormData();
    body.append("file", file);
    body.append("alt", alt);
    // Sent with fetch (not the typed client) because the browser must set the multipart boundary itself.
    const res = await fetch(`/api/admin/catalog/products/${product.id}/images`, { method: "POST", headers, body });
    setBusy(false);
    if (!res.ok) return setMessage({ kind: "error", text: errorText(await res.json().catch(() => null)) });
    if (fileRef.current) fileRef.current.value = "";
    setAlt("");
    setMessage({ kind: "ok", text: "Đã tải ảnh lên." });
    router.refresh();
  }

  async function remove(id: number) {
    if (!confirm("Xóa ảnh này?")) return;
    const { error } = await browserApi.DELETE("/api/admin/catalog/images/{image_id}", { params: { path: { image_id: id } }, headers });
    if (error) return setMessage({ kind: "error", text: errorText(error) });
    router.refresh();
  }

  async function move(index: number, by: -1 | 1) {
    const a = product.images[index];
    const b = product.images[index + by];
    if (!a || !b) return;
    // Give both images explicit positions so the swap holds even if their old sort values were equal.
    for (const [img, order] of [[a, index + by], [b, index]] as const) {
      const { error } = await browserApi.PATCH("/api/admin/catalog/images/{image_id}", {
        params: { path: { image_id: img.id } },
        body: { sortOrder: order },
        headers,
      });
      if (error) return setMessage({ kind: "error", text: errorText(error) });
    }
    router.refresh();
  }

  return (
    <section className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-6" aria-labelledby="images-title">
      <div>
        <h2 id="images-title" className="text-lg font-bold">
          Ảnh sản phẩm
        </h2>
        <p className="text-sm text-muted">Ảnh đầu tiên là ảnh bìa. JPEG, PNG hoặc WebP, tối đa 5 MB.</p>
      </div>

      {product.images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">Chưa có ảnh. Cửa hàng sẽ hiện ô màu thay thế.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {product.images.map((img, i) => (
            <li key={img.id} className="grid gap-2">
              <ProductImage image={img} name={product.name} sizes="200px" className="rounded-lg border border-line" />
              <div className="flex items-center justify-between gap-1">
                {i === 0 ? <Badge tone="brand">Ảnh bìa</Badge> : <span />}
                {!disabled && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label="Chuyển sang trái" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowLeft className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Chuyển sang phải" disabled={i === product.images.length - 1} onClick={() => move(i, 1)}>
                      <ArrowRight className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Xóa ảnh" onClick={() => remove(img.id)}>
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  </div>
                )}
              </div>
              {img.alt && <p className="truncate text-xs text-muted">{img.alt}</p>}
            </li>
          ))}
        </ul>
      )}

      {!disabled && (
        <form onSubmit={upload} className="grid gap-3 rounded-lg border border-dashed border-line p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Chọn ảnh">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" />
            </FormRow>
            <FormRow label="Mô tả ảnh (cho người dùng đọc màn hình)">
              <Input value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} />
            </FormRow>
          </div>
          {message && <Status kind={message.kind}>{message.text}</Status>}
          <div>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>
              {busy ? "Đang tải lên…" : "Tải ảnh lên"}
            </Button>
          </div>
        </form>
      )}
      {disabled && message && <Status kind={message.kind}>{message.text}</Status>}
    </section>
  );
}
