"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { components } from "@/lib/api/schema";
import { liveCatalogError } from "@/lib/live/catalog";

type LiveSession = components["schemas"]["LiveSessionOut"];

export function LiveProductPin({ live: initial }: { live: LiveSession }) {
  const { user, csrf } = useAdmin();
  const router = useRouter();
  const [options, setOptions] = useState<{ sku: string; label: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, transition] = useTransition();
  const [snapshot, setSnapshot] = useState<LiveSession | null>(null);
  const live = snapshot?.liveId === initial.liveId ? snapshot : initial;
  useEffect(() => {
    const stream = new EventSource("/api/live/events");
    stream.addEventListener("state", event => {
      try {
        const next = (JSON.parse(event.data) as components["schemas"]["LiveCurrentOut"]).session;
        if (next?.liveId === initial.liveId) setSnapshot(next);
      } catch { /* Retain the last confirmed state; mutation still revalidates on the server. */ }
    });
    return () => stream.close();
  }, [initial.liveId]);
  const scheduled = JSON.stringify(live.scheduledSkus);
  useEffect(() => {
    const controller = new AbortController();
    const skus = JSON.parse(scheduled) as string[];
    void Promise.all(skus.map(async sku => {
      const { data, error, response } = await browserApi.GET("/api/live/products/{sku}", { params: { path: { sku } }, signal: controller.signal });
      if (!response.ok && response.status !== 404) return { option: null, error: liveCatalogError(error) };
      const variant = data?.variants.find(v => v.sku === sku);
      return { option: data && variant ? { sku, label: `${data.name} · ${variant.name} · ${sku}` } : null, error: "" };
    })).then(items => {
      if (controller.signal.aborted) return;
      setOptions(items.flatMap(item => item.option ? [item.option] : []));
      setError(items.find(item => item.error)?.error ?? "");
    }).catch(() => {
      if (!controller.signal.aborted) setError("Chưa đọc được catalog. Hãy tải lại trang.");
    });
    return () => controller.abort();
  }, [scheduled]);

  async function pin(sku: string | null) {
    if (busy || refreshing || user.role !== "admin" || live.status === "ended") return;
    setBusy(true);
    setError("");
    try {
      const { response, error } = await browserApi.POST("/api/admin/live/{live_id}/pin", {
        params: { path: { live_id: live.liveId } }, headers: adminHeaders(csrf), body: { sku },
      });
      if (!response.ok) setError(liveCatalogError(error));
      else transition(() => router.refresh());
    } catch {
      setError("Chưa xác nhận được kết quả ghim. Hãy tải lại trang.");
    } finally { setBusy(false); }
  }
  if (user.role !== "admin") return null;
  const clockControlsSku = live.hostMode === "simli" || Boolean(live.scriptPlaylist?.length);
  return <section className="mt-4 grid gap-2" data-testid="live-product-pin">
    <label className="grid gap-2 text-sm font-medium">
      Sản phẩm ghim
      <select aria-label="Sản phẩm ghim" value={live.productPinned === false ? "" : live.pinnedSku}
        disabled={busy || refreshing || live.status === "ended"}
        onChange={e => void pin(e.target.value || null)} className="rounded-lg border border-line bg-surface p-3">
        <option value="">Không ghim</option>
        {!options.some(o => o.sku === live.pinnedSku) && <option value={live.pinnedSku} disabled>{live.pinnedSku} — chưa có trong catalog</option>}
        {options.map(o => <option key={o.sku} value={o.sku} disabled={clockControlsSku && o.sku !== live.pinnedSku}>{o.label}</option>)}
      </select>
    </label>
    <p className="text-sm text-muted">Chọn từ catalog trong phạm vi SKU của phiên. Bỏ ghim chỉ ẩn thẻ; lời dẫn và SKU câu hỏi vẫn giữ nguyên.</p>
    {live.productPinned !== false && <Button type="button" variant="outline" className="w-fit" disabled={busy || refreshing || live.status === "ended"} onClick={() => void pin(null)}>Bỏ ghim</Button>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
