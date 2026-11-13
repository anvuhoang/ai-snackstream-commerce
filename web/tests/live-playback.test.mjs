import assert from "node:assert/strict";
import { test } from "node:test";
import { createLivePlaybackLog, summarizeLiveQuestions } from "../src/lib/live/playback-log.ts";
import { canFinishReplyTail, mediaTarget, playbackOffset, playbackPosition, preparationRemaining } from "../src/lib/live/playback-timing.ts";

test("playlist media clamps at its end while legacy script continues looping", () => {
  const playlist = { kind: "script", mediaSource: "playlist" };
  assert.equal(mediaTarget(playlist, 8, 5.108005), 5.108005);
  assert.equal(mediaTarget(playlist, 1.391995, 4.365011), 1.391995);
  assert.equal(mediaTarget({ kind: "script", mediaSource: "prerecorded" }, 8, 5), 3);
});

const context = { sessionId: "page-a", liveId: "live-a", questionId: "question-a" };
function event(name, elapsedMs, extra = {}, details = {}) {
  return {
    ...context, eventId: crypto.randomUUID(), event: name, elapsedMs,
    occurredAt: "2026-11-11T00:00:00Z", isDemo: true, source: "web_live",
    details, ...extra,
  };
}
const send = (ms = 100, details = {}) => event("live_question_sent", ms, {}, { isRetry: false, ...details });
const playing = (ms = 869.6, extra = {}) => event("live_playback_started", ms, {
  playbackKind: "reply", playbackId: "reply-a", mediaSource: "prerecorded", ...extra,
}, { muted: false, volume: 1, paused: false });
const summary = (events) => summarizeLiveQuestions(events)[0];

test("measures same-page send to first reply playing using only monotonic time", () => {
  const result = summary([
    send(), event("live_question_accepted", 188.6, { sku: "CAPTURED-SKU" }), playing(),
  ]);
  assert.equal(result.sendToAckMs, 88.6);
  assert.equal(result.sendToFirstReplyPlaybackMs, 769.6);
  assert.equal(result.sku, "CAPTURED-SKU");
  assert.equal(result.sendToHeardMs, null);
  assert.equal(result.unknownReason, null);
});

test("uncertain delivery retry preserves original send, even when ack arrives after playback", () => {
  const result = summary([
    send(), event("live_question_delivery_unknown", 200),
    send(300, { isRetry: true }), playing(500), event("live_question_accepted", 600),
  ]);
  assert.equal(result.originalSend.elapsedMs, 100);
  assert.equal(result.attemptsObserved, 2);
  assert.equal(result.sendToFirstReplyPlaybackMs, 400);
  assert.equal(result.sendToAckMs, 500);
  assert.deepEqual(result.requestObservations.map((item) => item.event), [
    "live_question_delivery_unknown", "live_question_accepted",
  ]);
});

test("stalls and resumes create only one answer measurement per playback", () => {
  const result = summary([send(), playing(500), event("live_playback_waiting", 600, {
    playbackId: "reply-a", playbackKind: "reply",
  }), playing(900), playing(1100)]);
  assert.equal(result.sendToFirstReplyPlaybackMs, 400);
  assert.equal(result.playbacks.length, 1);
  assert.equal(result.playbacks[0].playingEvents, 3);
  assert.equal(result.playbacks[0].interruptions.length, 1);
});

test("retains separate playback IDs and media sources without replacing first measurement", () => {
  const result = summary([send(), playing(500), playing(900, { playbackId: "reply-b", mediaSource: "make" })]);
  assert.equal(result.sendToFirstReplyPlaybackMs, 400);
  assert.deepEqual(result.playbacks.map((item) => item.mediaSource), ["prerecorded", "make"]);
});

test("same question ID in different live or page sessions never joins clocks", () => {
  const results = summarizeLiveQuestions([
    send(), playing(500, { sessionId: "page-b" }), playing(600, { liveId: "live-b" }),
  ]);
  assert.equal(results.length, 3);
  for (const result of results) assert.equal(result.sendToFirstReplyPlaybackMs, null);
});

for (const [name, events] of [
  ["late viewer", [playing()]],
  ["evicted original send with retained retry", [send(300, { isRetry: true }), playing()]],
  ["missing playback", [send()]],
  ["negative delta", [send(900), playing(500)]],
  ["invalid time", [send(), playing(NaN)]],
  ["selected but never played", [send(), event("live_playback_selected", 500, {
    playbackKind: "reply", playbackId: "reply-a",
  })]],
  ["script playing", [send(), playing(500, { playbackKind: "script" })]],
  ["missing playback identity", [send(), playing(500, { playbackId: undefined })]],
]) {
  test(`${name} remains unknown with an explanation`, () => {
    const result = summary(events);
    assert.equal(result.sendToFirstReplyPlaybackMs, null);
    assert.ok(result.unknownReason);
  });
}

test("initial answered snapshot records a server observation, never earlier browser playback", () => {
  const observation = event("live_question_status_observed", 500, { sku: "API-SKU" }, {
    status: "answered", previousObservedStatus: null, observation: "snapshot",
  });
  const result = summary([observation]);
  assert.deepEqual(result.serverObservations, [observation]);
  assert.equal(result.firstReplyPlayback, null);
  assert.equal(result.sendToFirstReplyPlaybackMs, null);
});

test("rejection and server failure do not become zero latency or a successful answer", () => {
  const result = summary([send(), event("live_question_rejected", 200),
    event("live_question_status_observed", 300, {}, { status: "failed" })]);
  assert.equal(result.sendToFirstReplyPlaybackMs, null);
  assert.equal(result.acknowledgement, null);
  assert.equal(result.requestObservations[0].event, "live_question_rejected");
});

test("recorder bounds retained evidence to 500, counts drops and never invents evicted send", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const log = createLivePlaybackLog();
  log.record("live_question_sent", context, { isRetry: false });
  for (let index = 0; index < 500; index++) {
    now += 10;
    log.record("live_state_received", { liveId: context.liveId });
  }
  log.record("live_playback_started", { ...context, playbackId: "reply-a", playbackKind: "reply" });
  const result = JSON.parse(log.toJson());
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.scope, "live-playback-diagnostic");
  assert.equal(result.events.length, 500);
  assert.equal(result.droppedEvents, 2);
  assert.equal(new Set(result.events.map((item) => item.eventId)).size, 500);
  assert.ok(result.events.every((item) => item.sessionId === log.sessionId));
  assert.equal(result.events.at(-1).elapsedMs, 5000);
  assert.equal(result.questionSummaries[0].sendToFirstReplyPlaybackMs, null);
  assert.match(result.questionSummaries[0].unknownReason, /absent/);
});

test("record copies details and each page receives a distinct session", () => {
  const log = createLivePlaybackLog();
  const details = { status: "queued" };
  log.record("live_question_status_observed", context, details);
  details.status = "answered";
  assert.equal(JSON.parse(log.toJson()).events[0].details.status, "queued");
  assert.notEqual(log.sessionId, createLivePlaybackLog().sessionId);
});

const playback = {
  playbackId: "reply-a", kind: "reply", startedAt: "2026-11-11T00:00:00Z",
  pausedAt: null, durationSeconds: 10.077007, videoUrl: "/live-demo/avatar.mp4",
  mediaSource: "prerecorded",
};

test("late delivery starts at shared server position plus local monotonic elapsed", () => {
  assert.equal(playbackPosition(playback, "2026-11-11T00:00:04Z", 1000, 1250), 4.25);
  assert.equal(mediaTarget(playback, 4.25, 10.077007), 4.25);
  assert.equal(mediaTarget(playback, 100, 10.077007), 10.077007);
});

test("pause freezes position; resume uses adjusted server start instead of adding paused time", () => {
  const paused = { ...playback, pausedAt: "2026-11-11T00:00:03Z" };
  assert.equal(playbackPosition(paused, "2026-11-11T00:00:30Z", 1000, 90000), 3);
  const resumed = { ...playback, startedAt: "2026-11-11T00:01:40Z" };
  assert.equal(playbackPosition(resumed, "2026-11-11T00:01:44Z", 1000, 1000), 4);
});

test("script loops whereas a reply clamps and never wraps to the beginning", () => {
  assert.equal(mediaTarget({ ...playback, kind: "script" }, 25, 10), 5);
  assert.equal(mediaTarget(playback, 25, 10), 10);
});

const nearEnd = { currentTime: 9.86354, duration: 10.077007, paused: false, ended: false };
const restoredScript = { ...playback, kind: "script", mediaSource: "playlist",
  resumeAt: "2026-11-11T00:00:05Z", startedAt: "2026-11-10T23:59:58.074Z" };
test("restore preloads at saved offset and starts content clock only at the shared resume time", () => {
  assert.equal(playbackPosition(restoredScript, "2026-11-11T00:00:01Z", 1000, 4000), 6.926);
  assert.equal(preparationRemaining(restoredScript, "2026-11-11T00:00:01Z", 1000, 4000), 1);
  assert.equal(playbackPosition(restoredScript, "2026-11-11T00:00:01Z", 1000, 6000), 7.926);
  assert.equal(preparationRemaining(restoredScript, "2026-11-11T00:00:01Z", 1000, 6000), 0);
});
test("paused restoration freezes preparation; shifting both dates preserves offset on resume", () => {
  const paused = {...restoredScript, pausedAt: "2026-11-11T00:00:02Z"};
  assert.equal(playbackPosition(paused, "2026-11-11T00:01:00Z", 0, 90000), 6.926);
  assert.equal(preparationRemaining(paused, "2026-11-11T00:01:00Z", 0, 90000), 3);
  const resumed = {...restoredScript, resumeAt: "2026-11-11T00:01:05Z", startedAt: "2026-11-11T00:00:58.074Z"};
  assert.equal(playbackPosition(resumed, "2026-11-11T00:01:03Z", 0, 0), 6.926);
  assert.equal(preparationRemaining(resumed, "2026-11-11T00:01:03Z", 0, 0), 2);
});
test("script without restore metadata retains old clock and reply preparation still lasts five seconds", () => {
  assert.equal(preparationRemaining({...playback, kind: "script"}, "2026-11-11T00:00:01Z", 0, 0), 0);
  assert.equal(playbackPosition({...playback, kind: "script"}, "2026-11-11T00:00:01Z", 0, 0), 1);
  assert.equal(preparationRemaining({...playback, startedAt: "2026-11-11T00:00:05Z"},
    "2026-11-11T00:00:00Z", 0, 0), 5);
});
test("future reply start retains a signed preparation offset while visible position stays zero", () => {
  const upcoming = { ...playback, startedAt: "2026-11-11T00:00:04Z" };
  assert.equal(playbackOffset(upcoming, "2026-11-11T00:00:00Z", 1000, 4000), -1);
  assert.equal(playbackPosition(upcoming, "2026-11-11T00:00:00Z", 1000, 4000), 0);
  assert.equal(playbackOffset(upcoming, "2026-11-11T00:00:00Z", 1000, 5000), 0);
  assert.equal(playbackOffset(upcoming, "2026-11-11T00:00:00Z", 1000, 5500), 0.5);
});
test("pause preserves the remaining preparation window; resume uses the shifted shared start", () => {
  const upcoming = { ...playback, startedAt: "2026-11-11T00:00:04Z",
    pausedAt: "2026-11-11T00:00:01Z" };
  assert.equal(playbackOffset(upcoming, "2026-11-11T00:00:50Z", 1000, 90000), -3);
  const resumed = { ...upcoming, pausedAt: null, startedAt: "2026-11-11T00:01:44Z" };
  assert.equal(playbackOffset(resumed, "2026-11-11T00:01:41Z", 1000, 1000), -3);
});

test("reported 9.86354s tail finishes naturally on normal server completion", () => {
  assert.equal(canFinishReplyTail(playback, nearEnd, "answered", true, true, true), true);
});
for (const [name, media, status, active, connected, enabled] of [
  ["skip", nearEnd, "skipped", true, true, true],
  ["end", nearEnd, "answered", false, true, true],
  ["session pause", nearEnd, "answered", false, true, true],
  ["media pause", { ...nearEnd, paused: true }, "answered", true, true, true],
  ["ended", { ...nearEnd, ended: true }, "answered", true, true, true],
  ["stalled far behind", { ...nearEnd, currentTime: 2 }, "answered", true, true, true],
  ["disabled", nearEnd, "answered", true, true, false],
  ["disconnected", nearEnd, "answered", true, false, true],
  ["invalid duration", { ...nearEnd, duration: NaN }, "answered", true, true, true],
]) {
  test(`${name} cannot defer the authoritative transition`, () => {
    assert.equal(canFinishReplyTail(playback, media, status, active, connected, enabled), false);
  });
}
