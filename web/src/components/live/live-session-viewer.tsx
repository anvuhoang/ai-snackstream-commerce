"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { components } from "@/lib/api/schema";
import { SessionVideo } from "./session-video";
import { LiveQuestions } from "./live-questions";

type Snapshot = components["schemas"]["LiveCurrentOut"];
type TimedSnapshot = Snapshot & { receivedAtMs: number };
type Connection = "connecting" | "connected" | "reconnecting" | "invalid";

const CONNECTION_LABELS = {
  connecting: "Đang kết nối phiên live…",
  connected: "Đã kết nối. Trạng thái được cập nhật tự động.",
  reconnecting: "Mất kết nối, đang thử lại. Thông tin bên dưới có thể chưa cập nhật.",
  invalid: "Không đọc được trạng thái. Hãy tải lại trang.",
};

const STATUS_LABELS = {
  not_started: "Phiên chưa bắt đầu",
  playing: "Phiên đang hoạt động",
  paused: "Phiên đang tạm dừng",
  ended: "Phiên đã kết thúc",
};

export function LiveSessionViewer() {
  const [snapshot, setSnapshot] = useState<TimedSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const stream = new EventSource("/api/live/events");

    stream.addEventListener("state", (event) => {
      try {
        setSnapshot({
        ...(JSON.parse(event.data) as Snapshot),
        receivedAtMs: performance.now(),
    });
        setConnection("connected");
      } catch {
        setConnection("invalid");
      }
    });

    stream.onerror = () => setConnection("reconnecting");
    return () => stream.close();
  }, []);

  const live = snapshot?.session;

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <header className="grid gap-3">
        <Link href="/" className="w-fit text-sm font-semibold text-brand">
          ← Về cửa hàng
        </Link>
        <h1 className="text-3xl font-extrabold">{live?.title ?? "AI Live"}</h1>
        <p role="status" className="text-sm text-muted">
          {CONNECTION_LABELS[connection]}
        </p>
      </header>

      {snapshot !== null && (
        live ? (
          <section className="grid gap-3 rounded-card border border-line bg-surface p-5">
            {live.isDemo && <p className="text-sm text-muted">Dữ liệu thử nghiệm</p>}
            <h2 className="text-xl font-bold">{STATUS_LABELS[live.status]}</h2>
            <p className="break-all text-sm text-muted">Mã phiên: {live.liveId}</p>
            <p className="text-sm text-muted">
              SKU đang giới thiệu: {live.pinnedSku}
            </p>
            {(live.status === "playing" || live.status === "paused") && live.playback && snapshot.serverTime && (
            <SessionVideo
            key={live.playback.playbackId}
            playback={live.playback}
            serverTime={snapshot.serverTime}
            receivedAtMs={snapshot.receivedAtMs}
            connected={connection === "connected"}
            enabled={enabled}
            onEnable={() => setEnabled(true)}
        />
      )}

      <LiveQuestions
            key={live.liveId}
            live={live}
            connected={connection === "connected"}
            />
          </section>
        ) : (
          <p className="text-muted">Hiện chưa có phiên live.</p>
        )
      )}

      <Link href="/live/check" className="w-fit text-sm text-brand underline">
        Mở bài kiểm tra video và âm thanh
      </Link>
    </main>
  );
}