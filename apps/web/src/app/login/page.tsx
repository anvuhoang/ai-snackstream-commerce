"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BarChart3 } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
    });
    if (res.ok) {
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).detail ?? "Đăng nhập thất bại.");
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <span className="brand" style={{ padding: 0, color: "var(--text)" }}>
          <span className="mark"><BarChart3 size={19} color="#fff" /></span>
          <span><b>SnackStream</b><small style={{ color: "var(--text-3)" }}>Analytics</small></span>
        </span>
        <h1>Đăng nhập quản trị</h1>
        <p className="muted" style={{ margin: 0 }}>Khu vực dành cho nhóm vận hành.</p>
        {error && <div className="alert err" style={{ marginTop: 16 }}><AlertTriangle size={16} /><div>{error}</div></div>}
        <form onSubmit={submit}>
          <label className="fld"><span>Tên đăng nhập</span><input className="ctl" name="username" autoComplete="username" autoFocus required /></label>
          <label className="fld"><span>Mật khẩu</span><input className="ctl" type="password" name="password" autoComplete="current-password" required /></label>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
