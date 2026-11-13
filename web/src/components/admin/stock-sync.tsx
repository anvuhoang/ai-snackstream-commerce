"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/form";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { SyncStatus } from "@/lib/inventory";
import { useAdmin } from "./admin-shell";

/** Shows when Odoo was last read and lets the user read it again now. */
export function StockSync({ status }: { status: SyncStatus }) {
  const router = useRouter();
  const { csrf } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = status.lastRun;

  async function sync() {
    setBusy(true);
    setError("");
    const { error: failure } = await browserApi.POST("/api/admin/inventory/sync", { headers: adminHeaders(csrf) });
    setBusy(false);
    if (failure) return setError(errorText(failure));
    router.refresh();
  }

  return (
    <section className="grid gap-3 border border-line bg-surface p-5" aria-label="Đồng bộ Odoo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em]">Đồng bộ Odoo</h2>
        {status.enabled ? (
          <Button size="sm" disabled={busy} onClick={sync}>
            {busy ? "Đang đồng bộ…" : "Đồng bộ ngay"}
          </Button>
        ) : (
          <span className="text-xs text-muted">Chưa cấu hình ODOO_URL, ODOO_DB, ODOO_API_KEY</span>
        )}
      </div>
      {error && <Status kind="error">{error}</Status>}
      {run ? (
        <div className="grid gap-1 text-sm">
          <p className={run.ok ? "" : "font-medium text-red-700"}>
            {run.ok ? "Lần gần nhất thành công" : "Lần gần nhất thất bại"} · {formatDateTime(run.finishedAt ?? run.startedAt)}
          </p>
          {run.ok ? (
            <p className="text-xs text-muted">
              {run.matched} sản phẩm khớp SKU, {run.changed} số thay đổi.
            </p>
          ) : (
            <p className="text-xs">{run.error}</p>
          )}
          {run.ok && run.missingSkus.length > 0 && <p className="text-xs text-muted">Odoo chưa có SKU: {run.missingSkus.join(", ")}</p>}
        </div>
      ) : (
        status.enabled && <p className="text-xs text-muted">Chưa đồng bộ lần nào.</p>
      )}
    </section>
  );
}
