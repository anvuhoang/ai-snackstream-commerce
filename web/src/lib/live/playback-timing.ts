import type { components } from "../api/schema";

type Playback = components["schemas"]["LivePlaybackOut"];

export const REPLY_TAIL_SECONDS = 0.75;
export const REPLY_TAIL_TIMEOUT_MS = 1000;

export function playbackOffset(
  playback: Playback, serverTime: string, receivedAtMs: number, nowMs: number,
) {
  const reference = playbackReference(playback, serverTime, receivedAtMs, nowMs);
  const contentTime = playback.kind === "script" && playback.resumeAt
    ? Math.max(reference, Date.parse(playback.resumeAt)) : reference;
  return (contentTime - Date.parse(playback.startedAt)) / 1000;
}

function playbackReference(playback: Playback, serverTime: string, receivedAtMs: number, nowMs: number) {
  return Date.parse(playback.pausedAt ?? serverTime)
    + (playback.pausedAt ? 0 : Math.max(0, nowMs - receivedAtMs));
}

export function preparationRemaining(
  playback: Playback, serverTime: string, receivedAtMs: number, nowMs: number,
) {
  const gate = playback.kind === "reply" ? playback.startedAt : playback.resumeAt;
  return gate ? Math.max(0,
    (Date.parse(gate) - playbackReference(playback, serverTime, receivedAtMs, nowMs)) / 1000) : 0;
}

export function playbackPosition(
  playback: Playback, serverTime: string, receivedAtMs: number, nowMs: number,
) {
  return Math.max(0, playbackOffset(playback, serverTime, receivedAtMs, nowMs));
}

export type MediaProgress = {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
};

export function canFinishReplyTail(
  playback: Playback, media: MediaProgress, status: string | undefined,
  sessionPlaying: boolean, connected: boolean, enabled: boolean,
) {
  const remaining = media.duration - media.currentTime;
  return playback.kind === "reply" && status === "answered" && sessionPlaying
    && connected && enabled && !media.paused && !media.ended
    && Number.isFinite(remaining) && remaining > 0 && remaining <= REPLY_TAIL_SECONDS;
}

export function mediaTarget(playback: Playback, elapsed: number, duration: number) {
  return playback.kind === "reply" || playback.mediaSource === "playlist"
    ? Math.min(elapsed, duration) : elapsed % duration;
}
