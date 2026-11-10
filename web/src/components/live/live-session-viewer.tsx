"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { components } from "@/lib/api/schema";
import { SessionVideo } from "./session-video";
import { LiveQuestions } from "./live-questions";
import { Button } from "@/components/ui/button";
import {
  createLivePlaybackLog,
  downloadLivePlaybackLog,
  summarizeLiveQuestions,
  type LivePlaybackLog,
} from "@/lib/live/playback-log";
import { canFinishReplyTail, REPLY_TAIL_TIMEOUT_MS } from "@/lib/live/playback-timing";

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
  const [videoSnapshot, setVideoSnapshot] = useState<TimedSnapshot | null>(null);
  const [summaries, setSummaries] = useState<ReturnType<typeof summarizeLiveQuestions>>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const displayed = useRef<TimedSnapshot | null>(null);
  const latest = useRef<TimedSnapshot | null>(null);
  const tailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(false);
  const logRef = useRef<LivePlaybackLog | null>(null);
  const joinedLiveId = useRef<string | null>(null);
  const selectedPlaybackId = useRef<string | null>(null);
  const recordLog = useCallback<LivePlaybackLog["record"]>((event, context, details) => {
    logRef.current ??= createLivePlaybackLog();
    logRef.current.record(event, context, details);
  }, []);

  const releaseVideo = useCallback((reason: string) => {
    if (tailTimer.current !== null) clearTimeout(tailTimer.current);
    tailTimer.current = null;
    const old = displayed.current?.session;
    const next = latest.current;
    const media = videoRef.current;
    if (old?.playback && old.playback.playbackId !== next?.session?.playback?.playbackId) {
      recordLog("live_playback_released", {
        liveId: old.liveId, playbackId: old.playback.playbackId,
        questionId: old.playback.questionId ?? undefined,
        playbackKind: old.playback.kind, mediaSource: old.playback.mediaSource,
      }, {
        reason,
        currentTime: media?.currentTime ?? null,
        durationSeconds: media && Number.isFinite(media.duration) ? media.duration : null,
        ended: media?.ended ?? false,
      });
      // Stop the old element before React mounts the next, including on skip/end.
      media?.pause();
    }
    displayed.current = next;
    setVideoSnapshot(next);
  }, [recordLog]);

  useEffect(() => {
    logRef.current ??= createLivePlaybackLog();
    const log = logRef.current;
    const stream = new EventSource("/api/live/events");
    const observedStatuses = new Map<string, string>();
    let firstSnapshot = true;

    stream.addEventListener("state", (event) => {
      try {
        const next = JSON.parse(event.data) as Snapshot;
        const receivedAtMs = performance.now();
        const session = next.session;

        if (session) {
          const playback = session.playback;
          const question = session.questions?.find(
            (item) => item.questionId === playback?.questionId,
          );
          const context = {
            liveId: session.liveId,
            playbackId: playback?.playbackId,
            questionId: playback?.questionId ?? undefined,
            playbackKind: playback?.kind,
            mediaSource: playback?.mediaSource,
            sku: playback?.kind === "reply" ? question?.sku : session.pinnedSku,
          };

          if (joinedLiveId.current !== session.liveId) {
            log.record("live_join", { liveId: session.liveId });
            joinedLiveId.current = session.liveId;
          }

          log.record("live_state_received", context, {
            status: session.status,
            pinnedSku: session.pinnedSku,
            questionCount: session.questions?.length ?? 0,
            serverTime: next.serverTime ?? null,
          });

          for (const item of session.questions ?? []) {
            const key = JSON.stringify([session.liveId, item.questionId]);
            const previous = observedStatuses.get(key);
            if (firstSnapshot || previous !== item.status) {
              log.record("live_question_status_observed", {
                liveId: session.liveId, questionId: item.questionId,
                sku: item.sku, mediaSource: item.mediaSource ?? undefined,
              }, {
                status: item.status,
                previousObservedStatus: previous ?? null,
                observation: firstSnapshot || previous === undefined ? "snapshot" : "update",
                receivedAt: item.receivedAt,
                errorCode: item.errorCode ?? null,
              });
              observedStatuses.set(key, item.status);
            }
          }

          if (playback && selectedPlaybackId.current !== playback.playbackId) {
            log.record("live_playback_selected", context, {
              startedAt: playback.startedAt,
              pausedAt: playback.pausedAt ?? null,
              durationSeconds: playback.durationSeconds ?? null,
            });
          }
          selectedPlaybackId.current = playback?.playbackId ?? null;
        }

        const timed = { ...next, receivedAtMs };
        latest.current = timed;
        const old = displayed.current?.session;
        const media = videoRef.current;
        const canFinish = old?.liveId === session?.liveId && old?.playback && media
          && old.playback.playbackId !== session?.playback?.playbackId
          && canFinishReplyTail(old.playback, media,
            session?.questions?.find((item) => item.questionId === old.playback?.questionId)?.status,
            session?.status === "playing", true, enabledRef.current);
        if (canFinish) {
          if (tailTimer.current === null) {
            tailTimer.current = setTimeout(() => releaseVideo("tail_timeout"), REPLY_TAIL_TIMEOUT_MS);
          }
        } else {
          releaseVideo("server_state");
        }
        firstSnapshot = false;
        setSnapshot(timed);
        setConnection("connected");
      } catch {
        videoRef.current?.pause();
        releaseVideo("invalid_state");
        setConnection("invalid");
      }
    });

    stream.onerror = () => {
      firstSnapshot = true;
      videoRef.current?.pause();
      releaseVideo("connection_lost");
      setConnection("reconnecting");
      if (joinedLiveId.current) {
        log.record("live_connection_lost", { liveId: joinedLiveId.current });
      }
    };

    return () => {
      stream.close();
      if (tailTimer.current !== null) clearTimeout(tailTimer.current);
      tailTimer.current = null;
    };
  }, [releaseVideo]);

  const live = snapshot?.session;
  const shown = videoSnapshot?.session;
  const playback = shown?.playback;

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
            {(live.status === "playing" || live.status === "paused") && playback && videoSnapshot?.serverTime && (
              <SessionVideo
                key={playback.playbackId}
                playback={playback}
                serverTime={videoSnapshot.serverTime}
                receivedAtMs={videoSnapshot.receivedAtMs}
                connected={connection === "connected"}
                enabled={enabled}
                videoRef={videoRef}
                finishing={playback.playbackId !== live.playback?.playbackId}
                onEnded={() => {
                  if (tailTimer.current !== null) releaseVideo("native_ended");
                }}
                onEnable={() => {
                  enabledRef.current = true;
                  setEnabled(true);
                }}
                onLog={recordLog}
                logContext={{
                  liveId: live.liveId,
                  playbackId: playback.playbackId,
                  questionId: playback.questionId ?? undefined,
                  playbackKind: playback.kind,
                  mediaSource: playback.mediaSource,
                  sku: playback.kind === "reply"
                    ? live.questions?.find((item) => item.questionId === playback.questionId)?.sku
                    : live.pinnedSku,
                }}
              />
            )}

            <LiveQuestions
              key={live.liveId}
              live={live}
              connected={connection === "connected"}
              onLog={recordLog}
            />
          </section>
        ) : (
          <p className="text-muted">Hiện chưa có phiên live.</p>
        )
      )}

      <section className="grid gap-3 rounded-card border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">Log kiểm thử phiên live</h2>
        <Button type="button" variant="outline" className="w-fit" onClick={() => {
          if (logRef.current) downloadLivePlaybackLog(logRef.current);
        }}>
          Tải log JSON
        </Button>
        <Button type="button" variant="outline" className="w-fit" onClick={() => {
          if (logRef.current) setSummaries(JSON.parse(logRef.current.toJson()).questionSummaries);
        }}>
          Cập nhật tổng hợp câu hỏi
        </Button>
        {summaries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="pb-2 text-left text-muted">
                Thời gian từ gửi đến video trả lời bắt đầu phát trên tab này; chưa xác nhận người xem nghe được tiếng.
              </caption>
              <thead><tr><th>Câu hỏi / SKU</th><th>Server quan sát được</th><th>Gửi → phát</th></tr></thead>
              <tbody>{summaries.map((item) => (
                <tr key={JSON.stringify([item.sessionId, item.liveId, item.questionId])} className="border-t border-line">
                  <td className="p-2 break-all">{item.questionId}<br />{item.sku ?? "SKU chưa rõ"}</td>
                  <td className="p-2">{String(item.serverObservations.at(-1)?.details.status ?? "Chưa rõ")}</td>
                  <td className="p-2">{item.sendToFirstReplyPlaybackMs === null
                    ? `Chưa rõ: ${item.unknownReason}`
                    : `${item.sendToFirstReplyPlaybackMs.toFixed(1)} ms`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-muted">
          Log giữ tối đa 500 sự kiện gần nhất trong bộ nhớ tab. Tải trước khi đóng hoặc tải lại trang.
          Log kiểm thử chưa gửi về backend hoặc dashboard.
        </p>
      </section>
      <Link href="/live/check" className="w-fit text-sm text-brand underline">
        Mở bài kiểm tra video và âm thanh
      </Link>
    </main>
  );
}
