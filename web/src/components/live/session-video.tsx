"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { components } from "@/lib/api/schema";

type Playback = components["schemas"]["LivePlaybackOut"];

type Props = {
  playback: Playback;
  serverTime: string;
  receivedAtMs: number;
  connected: boolean;
  enabled: boolean;
  onEnable: () => void;
};

export function SessionVideo({
  playback,
  serverTime,
  receivedAtMs,
  connected,
  enabled,
  onEnable,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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

    const referenceTime = playback.pausedAt ?? serverTime;
    const elapsedSinceSnapshot = playback.pausedAt
      ? 0
      : (performance.now() - receivedAtMs) / 1000;

    const elapsed = Math.max(
      0,
      (Date.parse(referenceTime) - Date.parse(playback.startedAt)) / 1000
        + elapsedSinceSnapshot,
    );

    if (!Number.isFinite(elapsed)) return;

    if (
      video.readyState >= 1 &&
      Number.isFinite(video.duration) &&
      video.duration > 0
    ) {
      const target = elapsed % video.duration;
      const distance = Math.abs(video.currentTime - target);
      const tolerance = playback.pausedAt ? 0.05 : 0.75;

      if (Math.min(distance, video.duration - distance) > tolerance) {
        video.currentTime = target;
      }
    }

    if (allowPlay && !playback.pausedAt && video.paused) {
      void video.play().catch((cause) => {
        if (video !== videoRef.current || !video.isConnected) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError("Chưa phát được video. Bấm Bật hình và tiếng để thử lại.");
      });
    }
  }, [
    connected,
    enabled,
    playback.startedAt,
    playback.pausedAt,
    serverTime,
    receivedAtMs,
  ]);

  useEffect(() => {
    const first = setTimeout(() => sync(), 0);
    const timer = setInterval(() => sync(), 2000);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [sync]);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      video?.pause();
    };
  }, []);

  return (
    <section className="grid gap-3">
      <video
        ref={videoRef}
        src={playback.videoUrl}
        loop
        playsInline
        preload="auto"
        className="aspect-video w-full rounded-card bg-black object-contain"
        aria-label="Video avatar của phiên"
        onLoadedMetadata={() => sync()}
        onLoadStart={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => {
          setLoading(false);
          setError("");
        }}
        onError={() => {
          setLoading(false);
          setError("Không tải được video. Vui lòng thử lại.");
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

      {loading && !playback.pausedAt && (
        <p role="status" className="text-sm text-muted">
          Đang tải video…
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