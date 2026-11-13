"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/form";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { STATUS_LABEL, type AdminProduct } from "@/lib/catalog";
import { errorText, PUBLISH_MISSING } from "@/lib/errors";
import { useAdmin } from "./admin-shell";

const TONE = { draft: "neutral", published: "ok", hidden: "warn" } as const;

/** Where the product is in its life (draft -> on sale -> hidden) and the buttons that move it. */
export function StatusActions({ product }: { product: AdminProduct }) {
  const router = useRouter();
  const { user, csrf } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blockers = product.publishBlockers;

  async function act(action: "publish" | "hide") {
    setBusy(true);
    setError("");
    const path = action === "publish" ? "/api/admin/catalog/products/{product_id}/publish" : "/api/admin/catalog/products/{product_id}/hide";
    const { error: failure } = await browserApi.POST(path, { params: { path: { product_id: product.id } }, headers: adminHeaders(csrf) });
    setBusy(false);
    if (failure) return setError(errorText(failure));
    router.refresh();
  }

  return (
    <section className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-6" aria-labelledby="status-title">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="status-title" className="text-lg font-bold">
          Trạng thái
        </h2>
        <Badge tone={TONE[product.status]}>{STATUS_LABEL[product.status]}</Badge>
        {product.isDemo && <Badge tone="warn">Demo</Badge>}
      </div>

      {product.status !== "published" && blockers.length > 0 && (
        <div className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
          <p className="font-semibold">Còn thiếu trước khi đăng bán:</p>
          <ul className="mt-1 list-disc pl-5">
            {blockers.map((b) => (
              <li key={b}>{PUBLISH_MISSING[b] ?? b}</li>
            ))}
          </ul>
        </div>
      )}
      {product.status === "published" && <p className="text-sm text-muted">Khách đang thấy sản phẩm này trên cửa hàng.</p>}
      {product.status === "hidden" && <p className="text-sm text-muted">Sản phẩm đã ẩn khỏi cửa hàng; dữ liệu và lịch sử đơn vẫn được giữ.</p>}
      {error && <Status kind="error">{error}</Status>}

      {user.role === "admin" && (
        <div className="flex flex-wrap gap-3">
          {product.status !== "published" && (
            <Button onClick={() => act("publish")} disabled={busy || blockers.length > 0}>
              {product.status === "hidden" ? "Đăng bán lại" : "Đăng bán"}
            </Button>
          )}
          {product.status === "published" && (
            <Button variant="outline" onClick={() => act("hide")} disabled={busy}>
              Ẩn khỏi cửa hàng
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
