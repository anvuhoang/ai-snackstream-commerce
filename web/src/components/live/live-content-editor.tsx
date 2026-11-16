"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { liveContentError } from "@/lib/live/content-errors";
import type { components } from "@/lib/api/schema";

type Session = components["schemas"]["LiveSessionOut"];
type Content = components["schemas"]["LiveContentOut"];
type Capabilities = components["schemas"]["LiveHostCapabilitiesOut"];

export function LiveContentEditor({ live, hostStarting = false, onAudioReadyChange }: {
  live: Session; hostStarting?: boolean; onAudioReadyChange?: (ready: boolean) => void;
}) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [content, setContent] = useState<Content | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [draft, setDraft] = useState("");
  const savedScript = useRef("");
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  const [saving, setSaving] = useState(0);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const sessionLocked = hostStarting || live.status !== "not_started" || Boolean(live.host);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const { data, error: failure } = await browserApi.GET("/api/admin/live/{live_id}/content", {
          params: { path: { live_id: live.liveId } }, headers: adminHeaders(csrf),
        });
        if (disposed) return;
        if (data) {
          setContent(data);
          savedScript.current = data.script ?? "";
          setDraft(data.script ?? "");
          if (data.status === "speaking") timer = setTimeout(load, 1000);
        } else setError(liveContentError(failure));
      } catch { if (!disposed) setError("Không tải được lời dẫn. Hãy tải lại trang."); }
    }
    void load();
    void browserApi.GET("/api/admin/live/host-capabilities", { headers: adminHeaders(csrf) })
      .then(({ data }) => { if (!disposed && data) setCapabilities(data); }).catch(() => {});
    return () => { disposed = true; clearTimeout(timer); };
  }, [live.liveId, csrf]);

  const saveDraft = useCallback((script: string) => {
    setSaving(count => count + 1);
    // Serialize saves: a slower response must never overwrite a newer draft on the server.
    const work = saves.current.then(async () => {
      const { data, error: failure } = await browserApi.PUT("/api/admin/live/{live_id}/content/script", {
        params: { path: { live_id: live.liveId } }, headers: adminHeaders(csrf), body: { script },
      });
      if (!data) throw new Error(liveContentError(failure));
      savedScript.current = data.script ?? "";
      setContent(data);
      return data;
    });
    saves.current = work.then(() => undefined, () => undefined);
    return work.finally(() => setSaving(count => count - 1));
  }, [live.liveId, csrf]);

  useEffect(() => {
    if (!content || sessionLocked || busy || draft.trim() === savedScript.current) return;
    const timer = setTimeout(() => {
      void saveDraft(draft).catch(failure => setError(
        failure instanceof Error ? failure.message : "Chưa lưu được kịch bản. Hãy kiểm tra kết nối."
      ));
    }, 250);
    return () => clearTimeout(timer);
    // Save on draft edits, not on responses/state changes (no automatic retry after failure).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, sessionLocked, busy, saveDraft]);

  const locked = busy || sessionLocked || content?.status === "speaking";
  const audioReady = content?.status === "ready" && content.script === draft.trim() && !busy && saving === 0;
  useEffect(() => { onAudioReadyChange?.(audioReady); }, [audioReady, onAudioReadyChange]);

  async function prepareAudio() {
    if (sending.current || locked || !content || !reviewed || !draft.trim()) return;
    sending.current = true; setBusy(true); setError("");
    try {
      // Persist exactly the text confirmed above before requesting TTS; no script provider call.
      const saved = await saveDraft(draft.trim());
      if (!saved.script) return;
      const { data, error: failure } = await browserApi.POST("/api/admin/live/{live_id}/content/audio", {
        params: { path: { live_id: live.liveId } }, headers: adminHeaders(csrf),
        body: { script: saved.script },
      });
      if (!data) { setError(liveContentError(failure)); return; }
      setContent(data);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Chưa xác nhận được kết quả. Hãy kiểm tra trước khi thử lại.");
    } finally { sending.current = false; setBusy(false); }
  }

  return <section className="mt-5 grid gap-3 border-t border-line pt-4" data-testid="live-content">
    <h2 className="text-lg font-bold">Chuẩn bị lời dẫn</h2>
    <p className="text-sm text-muted">{content?.product.name} · {content?.product.sku}</p>
    <p className="whitespace-pre-line text-sm text-muted">{content?.product.facts}</p>
    <p className="text-sm text-muted">Nhập hoặc dán lời dẫn tiếng Việt, thời lượng đọc gợi ý 30–45 giây.</p>
    {capabilities && !capabilities.audioConfigured &&
      <p role="status" className="text-sm text-muted">Chưa cấu hình dịch vụ giọng đọc. Hãy liên hệ quản trị viên.</p>}
    <label className="grid gap-2 text-sm font-medium">Kịch bản
      <textarea data-testid="manual-script" value={draft} disabled={locked || !content} maxLength={2000} rows={8}
        onChange={event => {
          setDraft(event.target.value);
          setReviewed(false); setError("");
          onAudioReadyChange?.(content?.status === "ready" && event.target.value.trim() === content.script && !busy && saving === 0);
        }}
        placeholder="Dán hoặc nhập lời dẫn đã kiểm tra…"
        className="w-full rounded-xl border border-line bg-surface p-3" />
    </label>
    <p className="text-sm text-muted">{draft.length}/2000 ký tự · {saving ? "Đang lưu…" : draft.trim() === (content?.script ?? "") ? "Đã lưu" : "Chưa lưu xong"}. Nếu sửa lời dẫn, bạn cần tạo lại giọng đọc.</p>
    <Button type="button" variant="outline" className="w-fit" data-testid="review-script" aria-pressed={reviewed} disabled={locked || !draft.trim() || reviewed}
      onClick={() => setReviewed(true)}>{reviewed ? "Đã xác nhận lời dẫn" : "Xác nhận lời dẫn"}</Button>
    <p className="text-sm text-muted">Tạo giọng đọc có sử dụng hạn mức dịch vụ.</p>
    <Button className="w-fit" data-testid="generate-audio" disabled={locked || saving > 0 || !reviewed || !draft.trim() || audioReady || !capabilities?.audioConfigured}
      onClick={() => void prepareAudio()}>Tạo giọng đọc</Button>
    {busy && <p role="status">Đang tạo giọng đọc…</p>}
    {audioReady && content?.durationSeconds != null && <p role="status">Giọng đọc đã sẵn sàng · {content.durationSeconds.toFixed(3)} giây · SKU {content.product.sku}. Bạn có thể bắt đầu live.</p>}
    {!audioReady && <p className="text-sm text-muted">Chưa có audio khớp kịch bản thì không thể bắt đầu live.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
