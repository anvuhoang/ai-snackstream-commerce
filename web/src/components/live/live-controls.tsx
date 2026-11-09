"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { components } from "@/lib/api/schema";
import { errorText } from "@/lib/errors";

type LiveSession = components["schemas"]["LiveSessionOut"];
type Action = "start" | "end" | "pause" | "resume";

export function LiveControls({ live }: { live: LiveSession }) {
  const { user, csrf } = useAdmin();
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<Action | "pin" | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const locked = busyAction !== null || refreshing;

  async function control(action: Action) {
    if (locked || user.role !== "admin") return;
    if (action === "start" && live.status !== "not_started") return;
    if (action === "end" && live.status === "ended") return;
    if (action === "pause" && live.status !== "playing") return;
    if (action === "resume" && live.status !== "paused") return;

    setBusyAction(action);
    setError("");

    try {
      const paths = {
        start: "/api/admin/live/{live_id}/start",
        end: "/api/admin/live/{live_id}/end",
        pause: "/api/admin/live/{live_id}/pause",
        resume: "/api/admin/live/{live_id}/resume",
      } as const;

      const { response, error: failure } = await browserApi.POST(
        paths[action],
        {
          params: { path: { live_id: live.liveId } },
          headers: adminHeaders(csrf),
        },
      );

      if (!response.ok) {
        setError(errorText(failure));
        return;
      }

      startTransition(() => router.refresh());
    } catch {
      setError(
        "Chưa xác nhận được kết quả. Hãy tải lại trang để kiểm tra phiên.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function pinSku(sku: string) {
  if (locked || user.role !== "admin" || live.status === "ended") return;
  setBusyAction("pin");
  setError("");

  try {
    const { response, error: failure } = await browserApi.POST("/api/admin/live/{live_id}/pin", {
      params: { path: { live_id: live.liveId } },
      headers: adminHeaders(csrf),
      body: { sku },
    });

    if (!response.ok) {
      setError(errorText(failure));
      return;
    }

    startTransition(() => router.refresh());
  } catch {
    setError("Chưa xác nhận được kết quả. Hãy tải lại trang để kiểm tra SKU.");
  } finally {
    setBusyAction(null);
  }
}

  if (user.role !== "admin") return null;

  return (
    <div className="mt-5 grid gap-3">
    <label className="grid gap-2 text-sm font-medium">
    SKU đang giới thiệu
    <select value={live.pinnedSku} disabled={locked || live.status === "ended"}
      onChange={(event) => void pinSku(event.target.value)}
      className="w-full rounded-lg border border-line bg-surface p-3">
      {live.scheduledSkus.map((sku) => (
         <option key={sku} value={sku}>{sku}</option>
       ))}
      </select>
    </label>

    {busyAction === "pin" && (
      <p role="status" className="text-sm text-muted">Đang cập nhật SKU…</p>
    )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={locked || live.status !== "not_started"}
          onClick={() => void control("start")}
        >
          {busyAction === "start" ? "Đang bắt đầu…" : "Bắt đầu"}
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={locked || live.status === "ended"}
          onClick={() => void control("end")}
        >
          {busyAction === "end" ? "Đang kết thúc…" : "Kết thúc"}
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={locked || live.status !== "playing"}
          onClick={() => void control("pause")}
        >
          {busyAction === "pause" ? "Đang tạm dừng…" : "Tạm dừng"}
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={locked || live.status !== "paused"}
          onClick={() => void control("resume")}
        >
          {busyAction === "resume" ? "Đang tiếp tục…" : "Tiếp tục"}
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}