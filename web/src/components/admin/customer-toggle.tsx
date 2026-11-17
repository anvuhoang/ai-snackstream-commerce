"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";
import { useAdmin } from "./admin-shell";

/** Switch one customer account off or on. Only an admin may; staff see the state without a button. */
export function CustomerToggle({ id, email, isActive }: { id: number; email: string; isActive: boolean }) {
  const router = useRouter();
  const { csrf, user } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user.role !== "admin") return null;

  async function toggle() {
    const next = !isActive;
    if (!next && !window.confirm(`Khoá tài khoản ${email}? Khách sẽ không đăng nhập được nữa, các đơn cũ vẫn giữ nguyên.`)) return;
    setBusy(true);
    setError("");
    const { error: failure } = await browserApi.PATCH("/api/admin/customers/{customer_id}", {
      params: { path: { customer_id: id } },
      headers: adminHeaders(csrf),
      body: { isActive: next },
    });
    setBusy(false);
    if (failure) return setError(errorText(failure));
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void toggle()}>
        {busy ? "Đang lưu…" : isActive ? "Khoá" : "Mở khoá"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
