"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { components } from "@/lib/api/schema";
import type { LiveLogContext, LiveLogDetails, LivePlaybackLog } from "@/lib/live/playback-log";
import { mediaTarget, playbackOffset } from "@/lib/live/playback-timing";

type Playback = components["schemas"]["LivePlaybackOut"];

type Props = {
  playback: Playback;
  serverTime: string;
  receivedAtMs: number;
  connected: boolean;
  enabled: boolean;
  onEnable: () => void;
  logContext: LiveLogContext;
  onLog: LivePlaybackLog["record"];
  videoRef: RefObject<HTMLVideoElement | null>;
  finishing: boolean;
  onEnded: () => void;
};

export function SessionVideo({
  playback, serverTime, receivedAtMs, connected, enabled, onEnable, logContext, onLog,
  videoRef, finishing, onEnded,
}: Props) {
  const replyEnded = useRef(false);
  const aligned = useRef(false);
  const preparingLogged = useRef(false);
  const isReply = playback.kind === "reply";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const record = useCallback((
    event: string, video: HTMLVideoElement, details: LiveLogDetails = {},
  ) => {
    onLog(event, logContext, {
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : null,
      muted: video.muted,
      volume: video.volume,
      paused: video.paused,
      readyState: video.readyState,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
      ...details,
    });
  }, [logContext, onLog]);

  const sync = useCallback((allowPlay = enabled) => {
    const video = videoRef.current;
    if (!video) return;

    if (!connected) {
      video.pause();
      return;
    }

    if (!allowPlay || playback.pausedAt) {
      video.pause();
    }

    if (isReply && replyEnded.current) {
      video.pause();
      return;
    }

    // A normally completed server reply may finish a small local tail. Do not seek
    // it to the deadline; the parent bounds this grace and never mounts two players.
    if (finishing) return;

    const offset = playbackOffset(playback, serverTime, receivedAtMs, performance.now());
    if (!Number.isFinite(offset)) return;
    if (isReply && offset < 0) {
      video.pause();
      setPreparing(true);
      if (!preparingLogged.current) {
        preparingLogged.current = true;
        record("live_reply_preparing", video, { startsInSeconds: -offset });
      }
      return;
    }
    setPreparing(false);
    const elapsed = Math.max(0, offset);

    if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) {
      const duration = video.duration;
      // A late viewer must not replay a reply whose shared deadline has passed.
      if (isReply && !aligned.current && elapsed >= (playback.durationSeconds ?? duration)) {
        replyEnded.current = true;
        video.pause();
        record("live_reply_expired_before_start", video);
        return;
      }
      const target = mediaTarget(playback, elapsed, duration);
      const distance = Math.abs(video.currentTime - target);
      const drift = isReply ? distance : Math.min(distance, duration - distance);
      const tolerance = playback.pausedAt ? 0.05 : 0.75;
      // Always align the initial position, including sub-tolerance delivery delay.
      // Once running near the end, let native ended preserve the final syllable.
      const nearEnd = isReply && duration - video.currentTime <= 0.75;
      if (!aligned.current || (drift > tolerance && !nearEnd) || playback.pausedAt) {
        if (distance > 0.01) {
          video.currentTime = target;
          record("live_playback_seek_requested", video, { targetSeconds: target, elapsedSeconds: elapsed });
        }
        aligned.current = true;
      }
    }

    if (allowPlay && !playback.pausedAt && video.readyState >= 2
      && video.paused && !video.ended && !video.seeking) {
      void video.play().catch((cause) => {
        if (video !== videoRef.current || !video.isConnected) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        record("live_playback_error", video, {
          reason: "play_rejected",
          errorName: cause instanceof Error ? cause.name : "UnknownError",
        });
        setError("Chưa phát được video. Bấm Bật hình và tiếng để thử lại.");
      });
    }
  }, [
    connected, enabled, isReply,
    playback,
    serverTime, receivedAtMs, record,
    finishing, videoRef,
  ]);

  useEffect(() => {
    const first = setTimeout(() => sync(), 0);
    const offset = playbackOffset(playback, serverTime, receivedAtMs, performance.now());
    const start = isReply && !playback.pausedAt && Number.isFinite(offset) && offset < 0
      ? setTimeout(() => sync(), -offset * 1000 + 5) : null;
    const timer = setInterval(() => sync(), 2000);

    return () => {
      clearTimeout(first);
      if (start !== null) clearTimeout(start);
      clearInterval(timer);
    };
  }, [sync, isReply, playback, serverTime, receivedAtMs]);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      video?.pause();
    };
  }, [videoRef]);

  return (
    <section className="grid gap-3">
      <p role="status" className="text-sm text-muted">
        {isReply
          ? playback.mediaSource === "prerecorded"
            ? "Video trả lời mô phỏng — dùng clip có sẵn."
            : "Video trả lời qua Make."
          : "Video nội dung live."}
      </p>
      <video ref={videoRef} src={playback.videoUrl} loop={!isReply} playsInline preload="auto"
        className="aspect-video w-full rounded-card bg-black object-contain"
        aria-label="Video avatar của phiên"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          record("live_media_ready", video, {
            durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
          });
          sync();
        }}
        onLoadStart={() => setLoading(true)}
        onCanPlay={() => { setLoading(false); sync(); }}
        onWaiting={(event) => {
          setLoading(true);
          record("live_playback_waiting", event.currentTarget);
        }}
        onPlaying={(event) => {
          setLoading(false);
          setError("");
          record("live_playback_started", event.currentTarget);
        }}
        onSeeked={(event) => {
          record("live_playback_seeked", event.currentTarget);
          sync();
        }}
        onPause={(event) => record("live_playback_paused", event.currentTarget)}
        onVolumeChange={(event) => record("live_volume_changed", event.currentTarget)}
        onEnded={(event) => {
          if (isReply) replyEnded.current = true;
          setLoading(false);
          record("live_playback_ended", event.currentTarget);
          onEnded();
        }}
        onError={(event) => {
          setLoading(false);
          setError("Không tải được video. Vui lòng thử lại.");
          record("live_playback_error", event.currentTarget, {
            reason: "media_error",
            mediaErrorCode: event.currentTarget.error?.code ?? 0,
          });
        }}
      />

      <Button
        type="button"
        className="w-fit"
        disabled={!connected || Boolean(playback.pausedAt)}
        onClick={() => {
          const video = videoRef.current;
          if (!video) return;

          setError("");
          if (video.error) video.load();

          video.muted = false;
          video.volume = 1;
          aligned.current = false;
          record("live_playback_enable_requested", video);
          onEnable();
          sync(true);
        }}
      >
        {enabled ? "Bật lại hình và tiếng" : "Bật hình và tiếng"}
      </Button>

      {playback.pausedAt && (
        <p role="status" className="text-sm text-muted">
          Avatar đang tạm dừng. Video sẽ tiếp tục khi quản trị viên cho phát lại.
        </p>
      )}

      {(loading || preparing) && !playback.pausedAt && (
        <p role="status" className="text-sm text-muted">
          {preparing ? "Đang chuẩn bị video trả lời…" : "Đang tải video…"}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
