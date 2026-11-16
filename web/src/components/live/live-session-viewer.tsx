"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { components } from "@/lib/api/schema";
import { SimliHostReceiver } from "./simli-host-receiver";
import { SessionVideo } from "./session-video";
import { LiveQuestions } from "./live-questions";
import { LiveProductCard } from "./live-product-card";
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
  connected: "Đã kết nối",
  reconnecting: "Mất kết nối, đang thử lại. Thông tin bên dưới có thể chưa cập nhật.",
  invalid: "Không đọc được trạng thái. Hãy tải lại trang.",
};

const HOST_LABELS: Record<string, string> = {preparing: "Đang kết nối…", script: "Đang live", handoff: "Đang chuẩn bị trả lời…", reply: "Đang trả lời", restoring: "Đang tiếp tục kịch bản…", complete: "Đã hết lời dẫn"};

const STATUS_LABELS = {
  not_started: "Phiên chưa bắt đầu",
  playing: "Đang live",
  paused: "Phiên đang tạm dừng",
  ended: "Phiên đã kết thúc",
};

function subscribeDebug(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
const readDebug = () => new URLSearchParams(window.location.search).get("debug") === "1";
const serverDebug = () => false;

export function LiveSessionViewer() {
  const [snapshot, setSnapshot] = useState<TimedSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [enabled, setEnabled] = useState(false);
  const [videoSnapshot, setVideoSnapshot] = useState<TimedSnapshot | null>(null);
  const debug = useSyncExternalStore(subscribeDebug, readDebug, serverDebug);
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
            status: session.status ?? null,
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
                status: item.status ?? null,
                previousObservedStatus: previous ?? null,
                observation: firstSnapshot || previous === undefined ? "snapshot" : "update",
                receivedAt: item.receivedAt,
                errorCode: item.errorCode ?? null,
              });
              observedStatuses.set(key, item.status ?? "");
            }
          }

          if (playback && selectedPlaybackId.current !== playback.playbackId) {
            log.record("live_playback_selected", context, {
              startedAt: playback.startedAt,
              resumeAt: playback.resumeAt ?? null,
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
  const statusLabel = live?.status === "playing" && live.host
    ? HOST_LABELS[live.host.phase] ?? STATUS_LABELS[live.status]
    : live?.status ? STATUS_LABELS[live.status] : "";

  return (
    <main className="mx-auto grid max-w-5xl gap-3 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="min-w-0 text-2xl font-extrabold sm:text-3xl">{live?.title ?? "AI Live"}</h1>
        <div className="grid gap-0.5 text-sm">
          {live && <p role="status" className="font-semibold">{statusLabel} · {live.pinnedSku}</p>}
          <p role="status" className="text-xs text-muted">{CONNECTION_LABELS[connection]}</p>
        </div>
      </header>

      {snapshot !== null && (
        live ? (
          <section className="grid gap-3 rounded-card border border-line bg-surface p-3">
            {debug && <p className="break-all text-sm text-muted">Mã phiên: {live.liveId}</p>}
            {live.scriptCompleted && live.status !== "ended" && (
              <p role="status" className="text-sm text-muted">
                Đã hết lời dẫn. Đang trả lời các câu hỏi đã nhận; không nhận câu mới.
              </p>
            )}
            {live.hostMode === "simli" && <SimliHostReceiver key={`host-${live.liveId}`} live={live} connected={connection === "connected"} onLog={recordLog} />}
            {live.hostMode !== "simli" && (live.status === "playing" || live.status === "paused") && playback && videoSnapshot?.serverTime && (
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

            {live.productPinned !== false && <LiveProductCard key={`${live.liveId}:${live.pinnedSku}`} sku={live.pinnedSku} ended={live.status === "ended"} />}

            <LiveQuestions
              key={live.liveId}
              live={live}
              connected={connection === "connected"}
              onLog={recordLog}
            />
          </section>
        ) : (
          <div className="grid gap-3">
            <p className="text-lg font-semibold">Hiện chưa có phiên live.</p>
            <p className="text-muted">Phiên live sẽ hiện ở đây khi cửa hàng bắt đầu. Trong lúc chờ, bạn có thể xem sản phẩm hoặc hỏi trợ lý ở nút chat góc dưới.</p>
            <Link href="/products" className="w-fit border-b-2 border-accent font-semibold">
              Xem cửa hàng
            </Link>
          </div>
        )
      )}

      {debug && <section data-testid="live-diagnostics" className="grid gap-3 rounded-card border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">Diagnostics phiên live</h2>
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
      </section>}
    </main>
  );
}
