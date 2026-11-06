"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const { response, error: failure } = await browserApi.POST("/api/admin/auth/login", {
      body: { email: String(form.get("email")), password: String(form.get("password")) },
    });
    if (response.ok) {
      router.replace("/admin");
      router.refresh();
      return;
    }
    setError(errorText(failure));
    setBusy(false);
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={onSubmit} className="grid w-full max-w-sm gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Đăng nhập quản trị</h1>
          <p className="mt-1 text-sm text-muted">Dành cho nhân viên SnackStream.</p>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Field label="E-mail">
          <Input name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        <Field label="Mật khẩu">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? "Đang đăng nhập…" : "Đăng nhập"}
        </Button>
      </form>
    </div>
  );
}
