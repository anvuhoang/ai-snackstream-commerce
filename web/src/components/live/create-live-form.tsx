"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";

export function CreateLiveForm({ disabled }: { disabled: boolean }) {
  const { user, csrf } = useAdmin();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled || user.role !== "admin") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const scheduledSkus = String(data.get("skus") ?? "")
  .split(",").map((sku) => sku.trim()).filter(Boolean);
    setError("");
    setNotice("");

    if (!title) {
      setError("Bạn cần nhập tiêu đề phiên.");
      return;
    }

    if (scheduledSkus.length < 1 || scheduledSkus.length > 6
      || !scheduledSkus.every((sku) => /^[A-Za-z0-9][A-Za-z0-9_-]{1,38}$/.test(sku))
      || new Set(scheduledSkus.map((sku) => sku.toUpperCase())).size !== scheduledSkus.length) {
      setError("Nhập 1–6 SKU không trùng nhau, chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới.");
      return;
    }

    setBusy(true);
    try {
      const { response, error: failure } = await browserApi.POST("/api/admin/live", {
        body: { title, scheduledSkus },
        headers: adminHeaders(csrf),
      });

      if (!response.ok) {
        setError(errorText(failure));
        return;
      }

      form.reset();
      setNotice("Đã tạo phiên mới. Thông tin phiên được cập nhật bên dưới.");
      router.refresh();
    } catch {
      setError("Chưa xác nhận được kết quả. Hãy tải lại trang để kiểm tra phiên.");
    } finally {
      setBusy(false);
    }
  }

  if (user.role !== "admin") {
    return <p className="text-sm text-muted">Tài khoản này chỉ xem thông tin phiên.</p>;
  }

  return (
    <form onSubmit={createSession} className="grid gap-4 rounded-card border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">Tạo phiên live</h2>

      {disabled && (
        <p className="text-sm text-muted">
          Phiên hiện tại chưa kết thúc. Hãy kết thúc phiên đó trước khi tạo phiên mới.
        </p>
      )}

      <fieldset disabled={busy || disabled} className="grid gap-4">
        <Field label="Tiêu đề phiên">
          <Input name="title" required maxLength={160} placeholder="Nhập tiêu đề phiên live" />
        </Field>
        <Field label="SKU trong phiên, cách nhau bằng dấu phẩy">
          <Input name="skus" required maxLength={250} defaultValue="BT-XIKE-01, KG-LC-250" />
        </Field>
        <Button type="submit" className="w-fit">
          {busy ? "Đang tạo…" : "Tạo phiên"}
        </Button>
      </fieldset>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
    </form>
  );
}