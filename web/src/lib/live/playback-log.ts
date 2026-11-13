export type LiveLogContext = {
  liveId: string;
  questionId?: string;
  playbackId?: string;
  sku?: string;
  playbackKind?: "script" | "reply";
  mediaSource?: "prerecorded" | "make" | "playlist";
};

export type LiveLogDetails = Record<string, string | number | boolean | null>;

export type LiveDiagnosticEvent = LiveLogContext & {
  eventId: string;
  event: string;
  sessionId: string;
  occurredAt: string;
  elapsedMs: number;
  isDemo: true;
  source: "web_live";
  details: LiveLogDetails;
};

const MAX_EVENTS = 500;

// Summaries deliberately use only retained evidence from one page's monotonic clock.
// A retry is not a new send, and a server status is not a browser media event.
export function summarizeLiveQuestions(events: readonly LiveDiagnosticEvent[]) {
  const groups = new Map<string, LiveDiagnosticEvent[]>();
  for (const event of events) {
    if (!event.questionId) continue;
    const key = JSON.stringify([event.sessionId, event.liveId, event.questionId]);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const identity = group[0];
    const send = group.find((item) => item.event === "live_question_sent"
      && item.details.isRetry === false);
    const ack = group.find((item) => item.event === "live_question_accepted");
    const starts = group.filter((item) => item.event === "live_playback_started"
      && item.playbackKind === "reply" && item.playbackId);
    const firstPlayback = starts[0];
    const elapsed = send && firstPlayback
      ? firstPlayback.elapsedMs - send.elapsedMs : null;
    const unknownReason = !send
      ? "Original send is absent: late viewer, evicted event, or incomplete recording."
      : !firstPlayback
        ? "No reply playing event observed in this browser."
        : elapsed === null || !Number.isFinite(elapsed) || elapsed < 0
          ? "Playback predates the send or has an invalid monotonic timestamp."
          : null;
    const delta = (event: LiveDiagnosticEvent | undefined) => {
      const value = send && event ? event.elapsedMs - send.elapsedMs : null;
      return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
    };
    return {
      sessionId: identity.sessionId,
      liveId: identity.liveId,
      questionId: identity.questionId!,
      // SKU comes from the API's captured question, never pinnedSkuAtSend.
      sku: group.find((item) => item.sku)?.sku ?? null,
      originalSend: send ?? null,
      attemptsObserved: group.filter((item) => item.event === "live_question_sent").length,
      acknowledgement: ack ?? null,
      sendToAckMs: delta(ack),
      requestObservations: group.filter((item) => [
        "live_question_accepted", "live_question_rejected", "live_question_delivery_unknown",
      ].includes(item.event)),
      serverObservations: group.filter((item) => item.event === "live_question_status_observed"),
      firstReplyPlayback: firstPlayback ?? null,
      sendToFirstReplyPlaybackMs: unknownReason ? null : elapsed,
      unknownReason,
      // Repeated playing after a stall is evidence for the same playback, not another answer.
      playbacks: [...new Set(group.filter((item) => item.playbackKind === "reply")
        .map((item) => item.playbackId).filter(Boolean))].map((playbackId) => {
        const evidence = group.filter((item) => item.playbackId === playbackId
          && item.playbackKind === "reply");
        return {
          playbackId,
          mediaSource: evidence.find((item) => item.mediaSource)?.mediaSource ?? null,
          firstPlaying: evidence.find((item) => item.event === "live_playback_started") ?? null,
          playingEvents: evidence.filter((item) => item.event === "live_playback_started").length,
          ended: evidence.find((item) => item.event === "live_playback_ended") ?? null,
          interruptions: evidence.filter((item) => [
            "live_playback_waiting", "live_playback_error", "live_playback_released",
          ].includes(item.event)),
        };
      }),
      // Even unmuted playing does not prove sound at the OS, speaker, or listener.
      sendToHeardMs: null,
    };
  });
}

export function createLivePlaybackLog() {
  const sessionId = crypto.randomUUID();
  const startedAt = performance.now();
  const events: LiveDiagnosticEvent[] = [];
  let droppedEvents = 0;

  return {
    sessionId,
    record(event: string, context: LiveLogContext, details: LiveLogDetails = {}) {
      events.push({
        ...context,
        eventId: crypto.randomUUID(),
        event,
        sessionId,
        occurredAt: new Date().toISOString(),
        elapsedMs: performance.now() - startedAt,
        isDemo: true,
        source: "web_live",
        details: { ...details },
      });
      if (events.length > MAX_EVENTS) {
        events.shift();
        droppedEvents += 1;
      }
    },
    toJson() {
      return JSON.stringify({
        schemaVersion: 2,
        scope: "live-playback-diagnostic",
        exportedAt: new Date().toISOString(),
        sessionId,
        droppedEvents,
        questionSummaries: summarizeLiveQuestions(events),
        events,
      }, null, 2);
    },
  };
}

export type LivePlaybackLog = ReturnType<typeof createLivePlaybackLog>;

export function downloadLivePlaybackLog(log: LivePlaybackLog) {
  const blob = new Blob([log.toJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `live-diagnostic-${log.sessionId}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
