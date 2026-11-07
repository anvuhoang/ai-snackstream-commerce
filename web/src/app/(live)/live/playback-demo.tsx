"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const VIDEO_URL = "/live-demo/avatar.mp4";
const LIVE_ID = "LIVE-PLAYBACK-DEMO-001";
const MAX_EVENTS = 200;
type State = "loading" | "ready" | "playing" | "paused" | "buffering" | "ended" | "error";
type EventName = "live_join" | "live_media_ready" | "live_playback_started" | "live_playback_paused"
  | "live_playback_waiting" | "live_playback_ended" | "live_playback_error" | "live_playback_retry"
  | "live_volume_changed" | "live_audio_confirmed";
type Details = Record<string, string | number | boolean>;
type PlaybackEvent = {
  eventId: string; event: EventName; sessionId: string; liveId: string;
  occurredAt: string; isDemo: true; source: "web_live"; details: Details;
};
const STATUS: Record<State, string> = {
  loading: "Đang tải video", ready: "Sẵn sàng phát", playing: "Đang phát", paused: "Đã tạm dừng",
  buffering: "Đang chờ dữ liệu", ended: "Đã phát hết video", error: "Không phát được video",
};

export function PlaybackDemo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const [status, setStatus] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<PlaybackEvent[]>([]);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [audioConfirmed, setAudioConfirmed] = useState(false);

  const record = useCallback((event: EventName, details: Details = {}) => {
    sessionIdRef.current ??= crypto.randomUUID();
    const video = videoRef.current;
    const entry: PlaybackEvent = {
      eventId: crypto.randomUUID(), event, sessionId: sessionIdRef.current, liveId: LIVE_ID,
      occurredAt: new Date().toISOString(), isDemo: true, source: "web_live",
      details: { mediaUrl: VIDEO_URL, currentTime: video?.currentTime ?? 0,
        muted: video?.muted ?? false, volume: video?.volume ?? 1, ...details },
    };
    setEvents((previous) => [...previous, entry].slice(-MAX_EVENTS));
  }, []);

  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    record("live_join");
  }, [record]);

  async function play() {
    try {
      await videoRef.current?.play();
    } catch (cause) {
      setStatus("error");
      setError("Chưa phát được video. Kiểm tra file, rồi bấm Thử tải lại hoặc nút phát trên trình phát.");
      record("live_playback_error", { reason: "play_rejected", errorName: cause instanceof Error ? cause.name : "UnknownError" });
    }
  }

  function downloadLog() {
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, scope: "playback-smoke-test",
      exportedAt: new Date().toISOString(), events }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `live-playback-${sessionIdRef.current ?? "demo"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl content-start gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="grid gap-3">
        <Link href="/" className="w-fit text-sm font-semibold text-brand hover:underline">← Về cửa hàng</Link>
        <p className="text-sm font-semibold text-brand">AI Live · Bản thử đường phát</p>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Xem và nghe avatar</h1>
        <p className="max-w-2xl text-muted">Phát video có sẵn để kiểm tra trên trình duyệt thứ hai. Mỗi trình duyệt điều khiển video riêng;
          đây chưa phải phiên live đồng bộ hoặc trả lời bình luận mới.</p>
      </header>
      <section aria-label="Trình phát thử" className="overflow-hidden rounded-card border border-line bg-surface">
        <video ref={videoRef} src={VIDEO_URL} controls playsInline preload="metadata" aria-label="Video avatar thử nghiệm"
          className="aspect-video w-full bg-black object-contain"
          onLoadStart={() => { setStatus("loading"); setError(null); }}
          onLoadedMetadata={(event) => { setStatus("ready"); record("live_media_ready", { durationSeconds: event.currentTarget.duration }); }}
          onPlaying={() => { setStatus("playing"); setError(null); record("live_playback_started"); }}
          onPause={(event) => { if (!event.currentTarget.ended) { setStatus("paused"); record("live_playback_paused"); } }}
          onWaiting={() => { setStatus("buffering"); record("live_playback_waiting"); }}
          onEnded={() => { setStatus("ended"); record("live_playback_ended"); }}
          onError={(event) => {
            setStatus("error");
            setError("Không đọc được video. Kiểm tra file avatar.mp4 đã đặt đúng thư mục và phát được trên máy.");
            record("live_playback_error", { reason: "media_error", mediaErrorCode: event.currentTarget.error?.code ?? 0 });
          }}
          onVolumeChange={(event) => { setMuted(event.currentTarget.muted); setVolume(event.currentTarget.volume); record("live_volume_changed"); }}
        />
        <div className="grid gap-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="font-semibold">{STATUS[status]}</p>
            <p className="text-sm text-muted">Âm thanh: {muted || volume === 0 ? "đang tắt" : "đã bật trong trình phát"}</p>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => void play()} disabled={status === "playing"}>Phát video</Button>
            <Button type="button" variant="outline" onClick={() => {
              setAudioConfirmed(false); record("live_playback_retry"); videoRef.current?.load();
            }}>Thử tải lại</Button>
            <Button type="button" variant="outline" disabled={status !== "playing" || muted || volume === 0 || audioConfirmed}
              onClick={() => { setAudioConfirmed(true); record("live_audio_confirmed", { confirmedBy: "viewer" }); }}>
              {audioConfirmed ? "Đã xác nhận nghe được" : "Tôi nghe được tiếng"}
            </Button>
          </div>
          <p className="text-sm text-muted">Bấm phát và bật âm thanh trên từng trình duyệt. Chỉ xác nhận sau khi bạn thực sự nghe được giọng nói.</p>
        </div>
      </section>
      <section aria-labelledby="setup-title" className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:p-6">
        <h2 id="setup-title" className="text-lg font-bold">Chuẩn bị video thử</h2>
        <p className="text-sm text-muted">Copy MP4 Q-014 đã có vào thư mục dưới đây và đổi tên bản copy thành <code>avatar.mp4</code>.</p>
        <code className="break-all rounded-lg bg-canvas p-3 text-sm">web/public/live-demo/avatar.mp4</code>
        <p className="text-sm text-muted">File video không đưa lên Git. Mở cùng địa chỉ trang này bằng Chrome và Edge để kiểm tra.</p>
      </section>
      <section aria-labelledby="log-title" className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="log-title" className="text-lg font-bold">Log thử trên trình duyệt</h2>
          <Button type="button" variant="outline" onClick={downloadLog} disabled={events.length === 0}>Tải log JSON</Button>
        </div>
        <p className="break-all text-sm text-muted">Mã phiên thử: {LIVE_ID}</p>
        <p className="text-sm text-muted">Log chỉ lưu trong bộ nhớ tab, tối đa {MAX_EVENTS} sự kiện gần nhất. Tải log trước khi đóng hoặc tải lại trang.
          Log chưa gửi về backend hay dashboard; sự kiện phát không tự chứng minh âm thanh đã nghe được.</p>
        <p className="text-sm text-muted">Đang giữ {events.length} sự kiện. Các sự kiện gần nhất:</p>
        <ol className="grid gap-2 text-sm">
          {events.slice(-8).map((event) => <li key={event.eventId} className="flex flex-wrap justify-between gap-2 border-t border-line pt-2">
            <code className="break-all">{event.event}</code>
            <time dateTime={event.occurredAt} className="text-muted">{new Date(event.occurredAt).toLocaleTimeString("vi-VN")}</time>
          </li>)}
        </ol>
      </section>
    </main>
  );
}
