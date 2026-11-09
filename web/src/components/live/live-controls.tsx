"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { components } from "@/lib/api/schema";
import { errorText } from "@/lib/errors";

type LiveSession = components["schemas"]["LiveSessionOut"];
type Action = "start" | "end";

export function LiveControls({ live }: { live: LiveSession }) {
  const { user, csrf } = useAdmin();
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const locked = busyAction !== null || refreshing;

  async function control(action: Action) {
    if (locked || user.role !== "admin") return;
    if (action === "start" && live.status !== "not_started") return;
    if (action === "end" && live.status === "ended") return;

    setBusyAction(action);
    setError("");

    try {
      const path = action === "start"
        ? "/api/admin/live/{live_id}/start"
        : "/api/admin/live/{live_id}/end";

      const { response, error: failure } = await browserApi.POST(path, {
        params: { path: { live_id: live.liveId } },
        headers: adminHeaders(csrf),
      });

      if (!response.ok) {
        setError(errorText(failure));
        return;
      }

      startTransition(() => router.refresh());
    } catch {
      setError("Chưa xác nhận được kết quả. Hãy tải lại trang để kiểm tra phiên.");
    } finally {
      setBusyAction(null);
    }
  }

  if (user.role !== "admin") return null;

  return (
    <div className="mt-5 grid gap-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={locked || live.status !== "not_started"}
          onClick={() => void control("start")}>
          {busyAction === "start" ? "Đang bắt đầu…" : "Bắt đầu"}
        </Button>

        <Button type="button" variant="outline" disabled={locked || live.status === "ended"}
          onClick={() => void control("end")}>
          {busyAction === "end" ? "Đang kết thúc…" : "Kết thúc"}
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}