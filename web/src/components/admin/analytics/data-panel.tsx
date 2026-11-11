"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/form";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { CSV_TEMPLATE, type BatchOut } from "@/lib/analytics";
import { errorText } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useAdmin } from "../admin-shell";

const box = "grid gap-4 rounded-[20px] border border-line bg-surface p-5";
const input = "h-11 w-full rounded-xl border-2 border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none";
const label = "grid gap-1.5 text-[13px] font-semibold";

type Problem = { line: number; problem: string };

const NUMBERS = [
  ["views", "Lượt xem"],
  ["impressions", "Lượt hiển thị"],
  ["clicks", "Click"],
  ["orders", "Đơn (kênh báo)"],
  ["revenueVnd", "Doanh thu (đ)"],
  ["costVnd", "Chi phí (đ)"],
] as const;

/** Add numbers other channels report: a CSV file or one entry typed in, plus the list of what was added (and undo for admins). */
export function DataPanel({ batches, from, to, demo }: { batches: BatchOut[]; from: string; to: string; demo: string }) {
  const router = useRouter();
  const { csrf, user } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);

  const reset = () => {
    setDone("");
    setError("");
    setProblems([]);
  };

  async function uploadFile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Hãy chọn một file CSV.");
    data.set("isDemo", data.get("isDemo") ? "true" : "false");
    setBusy(true);
    try {
      const r = await fetch("/api/admin/analytics/imports", { method: "POST", body: data, headers: adminHeaders(csrf) });
      const body = (await r.json().catch(() => null)) as (BatchOut & { error?: unknown }) | null;
      if (!r.ok) {
        setError(errorText(body));
        const list = (body as { error?: { details?: { problems?: Problem[] } } } | null)?.error?.details?.problems;
        if (list) setProblems(list);
        return;
      }
      setDone(`Đã nhập ${body?.valuesImported ?? 0} số liệu` + (body?.valuesSkipped ? `, bỏ qua ${body.valuesSkipped} số đã có.` : "."));
      form.reset();
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  async function addManual(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();
    const form = e.currentTarget;
    const f = new FormData(form);
    const num = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : Number.parseInt(v, 10);
    };
    const body = {
      day: String(f.get("day") ?? ""),
      channel: String(f.get("channel") ?? "").trim(),
      contentCode: String(f.get("contentCode") ?? "").trim(),
      views: num("views"),
      impressions: num("impressions"),
      clicks: num("clicks"),
      orders: num("orders"),
      revenueVnd: num("revenueVnd"),
      costVnd: num("costVnd"),
      isDemo: Boolean(f.get("isDemo")),
    };
    if (!body.day || !body.channel) return setError("Nhập ngày và tên kênh.");
    setBusy(true);
    const { data, error: failure } = await browserApi.POST("/api/admin/analytics/manual", { body, headers: adminHeaders(csrf) });
    setBusy(false);
    if (failure || !data) return setError(errorText(failure));
    setDone(`Đã thêm ${data.valuesImported} số liệu.`);
    form.reset();
    router.refresh();
  }

  async function undo(b: BatchOut) {
    if (!window.confirm(`Xóa lần nhập “${b.filename}” và ${b.valuesImported} số liệu của nó? Không thể hoàn tác.`)) return;
    reset();
    const { error: failure } = await browserApi.DELETE("/api/admin/analytics/imports/{batch_id}", { params: { path: { batch_id: b.id } }, headers: adminHeaders(csrf) });
    if (failure) return setError(errorText(failure));
    router.refresh();
  }

  const q = `from=${from}&to=${to}&demo=${demo}`;
  return (
    <div className="grid gap-6">
      {error && <Status kind="error">{error}</Status>}
      {done && <Status kind="ok">{done}</Status>}
      {problems.length > 0 && (
        <ul className="grid gap-1 rounded-[20px] border-2 border-danger/25 bg-danger-soft p-4 text-sm text-danger" aria-label="Các dòng lỗi">
          {problems.map((p) => (
            <li key={p.line}>
              <b className="font-semibold">Dòng {p.line}:</b> {p.problem}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={uploadFile} className={box} aria-label="Nhập từ file CSV">
          <div>
            <h2 className="text-sm font-extrabold">Nhập từ file CSV</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Cột bắt buộc: <b className="font-medium text-ink">date</b>, <b className="font-medium text-ink">channel</b> và ít nhất một số liệu (views, impressions, clicks, orders, revenue, cost). Ô để trống nghĩa là “kênh chưa báo”, không bị đổi thành 0. Một dòng lỗi thì cả file bị từ chối. Cùng một file không nhập được hai lần.
            </p>
          </div>
          <label className={label}>
            File CSV (UTF-8, tối đa 2 MB)
            <input type="file" name="file" accept=".csv,text/csv" className="text-sm file:mr-3 file:h-10 file:rounded-xl file:border-2 file:border-ink file:bg-transparent file:px-4 file:text-sm file:font-semibold" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isDemo" className="size-4 accent-[var(--color-accent)]" /> Đây là dữ liệu demo
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Đang nhập…" : "Nhập file"}
            </Button>
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + CSV_TEMPLATE)}`} download="mau-nhap-lieu.csv" className="border-b-2 border-accent text-sm font-semibold">
              Tải file mẫu
            </a>
          </div>
        </form>

        <form onSubmit={addManual} className={box} aria-label="Nhập tay">
          <h2 className="text-sm font-extrabold">Nhập tay một dòng</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={label}>
              Ngày
              <input type="date" name="day" className={input} />
            </label>
            <label className={label}>
              Kênh
              <input name="channel" placeholder="tiktok" maxLength={40} className={input} />
            </label>
            <label className={label}>
              Nội dung (tùy chọn)
              <input name="contentCode" placeholder="clip-01" maxLength={100} className={input} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {NUMBERS.map(([k, name]) => (
              <label key={k} className={label}>
                {name}
                <input name={k} inputMode="numeric" placeholder="để trống nếu chưa có" className={input} />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isDemo" className="size-4 accent-[var(--color-accent)]" /> Đây là dữ liệu demo
          </label>
          <div>
            <Button type="submit" disabled={busy}>
              Thêm số liệu
            </Button>
          </div>
        </form>
      </div>

      <section className="overflow-x-auto rounded-[20px] border border-line bg-surface" aria-label="Lịch sử nhập">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-extrabold">Đã nhập</h2>
          <span className="flex flex-wrap gap-4 text-sm font-semibold">
            <a href={`/api/admin/analytics/export/channels.csv?${q}`} className="border-b-2 border-accent">
              Xuất số liệu kênh (CSV)
            </a>
            <a href={`/api/admin/analytics/export/overview.csv?${q}`} className="border-b-2 border-accent">
              Xuất phễu và nguồn (CSV)
            </a>
          </span>
        </div>
        {batches.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">Chưa nhập gì.</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.04em] text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Lúc</th>
                <th className="px-4 py-3 font-medium">Nguồn</th>
                <th className="px-4 py-3 text-right font-medium">Dòng</th>
                <th className="px-4 py-3 text-right font-medium">Số liệu mới</th>
                <th className="px-4 py-3 text-right font-medium">Bỏ qua (đã có)</th>
                <th className="px-4 py-3 font-medium">Người nhập</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-hair last:border-0">
                  <td className="px-5 py-3 text-xs text-muted">{formatDateTime(b.createdAt)}</td>
                  <td className="px-4 py-3">
                    {b.filename}
                    {b.isDemo && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">Demo</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{b.rowsTotal}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{b.valuesImported}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{b.valuesSkipped}</td>
                  <td className="px-4 py-3 text-xs text-muted">{b.createdByEmail ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {user.role === "admin" && (
                      <Button size="sm" variant="outline" onClick={() => undo(b)}>
                        Xóa lần nhập
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
