"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/form";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";
import { SOURCE_LABEL } from "@/lib/inventory";
import { useAdmin } from "./admin-shell";

/** Count here, inline: receive new goods or correct the number after checking the shelf. Odoo-owned counts are read-only. */
export function StockAdjust({
  variantId,
  source,
  onHand,
  reserved,
}: {
  variantId: number;
  source: "own" | "odoo" | null;
  onHand: number;
  reserved: number;
}) {
  const router = useRouter();
  const { csrf } = useAdmin();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"receive" | "adjust">("receive");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (source === "odoo") return <span className="text-xs text-muted">Quản lý trong {SOURCE_LABEL.odoo}</span>;

  async function save() {
    const n = Number.parseInt(amount, 10);
    if (!Number.isInteger(n) || n === 0) return setError("Nhập một số khác 0.");
    if (kind === "receive" && n < 0) return setError("Hàng nhập phải là số dương. Dùng “Điều chỉnh” để giảm.");
    setBusy(true);
    setError("");
    const { error: failure } = await browserApi.POST("/api/admin/inventory/{variant_id}/adjust", {
      params: { path: { variant_id: variantId } },
      body: { kind, delta: n, note },
      headers: adminHeaders(csrf),
    });
    setBusy(false);
    if (failure) return setError(errorText(failure));
    setOpen(false);
    setAmount("");
    setNote("");
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Cập nhật
      </Button>
    );
  }

  const field = "h-9 border border-line bg-surface px-2 text-sm focus:bg-canvas focus:outline-none";
  return (
    <div className="grid w-64 gap-2 border border-line bg-canvas p-3">
      <select value={kind} onChange={(e) => setKind(e.target.value as "receive" | "adjust")} className={field} aria-label="Loại thay đổi">
        <option value="receive">Nhập hàng (+)</option>
        <option value="adjust">Điều chỉnh (+ hoặc −)</option>
      </select>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="numeric"
        placeholder={kind === "receive" ? "Số lượng nhập" : "Ví dụ -3 hoặc 5"}
        aria-label="Số lượng"
        className={field}
      />
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Ghi chú (tùy chọn)" aria-label="Ghi chú" className={field} />
      <p className="text-[11px] text-muted">
        Hiện có {onHand}, đang giữ {reserved}. Không giảm xuống dưới số đang giữ.
      </p>
      {error && <Status kind="error">{error}</Status>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>
          Lưu
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
          Hủy
        </Button>
      </div>
    </div>
  );
}
