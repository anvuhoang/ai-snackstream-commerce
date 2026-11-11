# Bounded reply preparation — 2026-11-11

The reported existing-video replay lost its head because the server started the
reply clock before the browser finished loading metadata. In the supplied trace,
`startedAt=2026-11-11T10:55:39.731889Z`, metadata arrived at `10:55:42.578Z`, and
the first `playing` position was 2.845399 seconds of a 5.108005-second container.
This is media-loading delay, not new-video generation latency.

## Shared schedule

When a ready Make or prerecorded result becomes the selected reply, the server
freezes/saves the exact script position and reserves the existing answer slot.
It publishes that reply with **`startedAt = selected time + 5 seconds`**. This is
one shared preparation window, not a duration override or per-viewer grace period.
`durationSeconds` remains the measured media duration. The authoritative finish
is still **`startedAt + durationSeconds`**; the runtime continues without viewers.
No viewer acknowledgement/readiness API, callback retry or network event extends it.

An already connected viewer mounts the reply immediately, stops the old script
audio and preloads while paused. The player keeps a signed offset from the supplied
server time plus locally elapsed monotonic time, and schedules a timer for the
future start. It does not call play before that start, even when enabled or ready.
At the shared start, media that has loaded plays from approximately zero; the
loading interval no longer consumes its playback interval. `canplay` also retries
synchronization if metadata preceded enough decoded media. Diagnostics record
`live_reply_preparing`, the ordinary media events and actual seek/playing positions.

The viewer component still owns exactly one displayed player, pauses it before
replacement and permits only the existing bounded normal-completion tail (at most
750 ms of media for at most one second). This change does not force the local
position to zero after the shared start or extend that tail. A ready but scheduled
reply uses the existing `answering` status; future `startedAt` denotes preparation.
There is no new HTTP field, so OpenAPI/types do not need regeneration for this fix.
Backend and player changes must be released together; existing tabs need the new
player loaded. An older player does not wait for a future `startedAt`.

## Control and synchronization limits

- Pause during preparation freezes the remaining preparation time. Resume shifts
  `startedAt` by the paused duration, preserving the same playback ID. Pause during
  playback retains the existing media-position behavior.
- Skip/end immediately discard the pending player/start timer and restore script
  or end the session. The old media cannot begin later. FIFO ownership is retained
  through preparation and playback; a subsequent reply gets its own shared window.
- Initial late join and reconnect use the current shared time. Joining before the
  start may benefit from the remaining preparation time; joining after it seeks
  forward, and an already expired reply is not replayed.
- The five-second window budgets for about one second of SSE polling/delivery,
  up to 750 ms of the previous reply tail, and about three seconds of media loading.
  Additional SSE delivery delay, severe stalls, autoplay restrictions,
  background-tab timer throttling or loading beyond the available window can still
  cause missed media. Such a viewer catches up or misses the expired reply; it
  cannot delay everyone else. No finite preload window guarantees all networks.
- The client extrapolates from the last server timestamp and monotonic receipt time;
  transport delay is not an RTT-corrected clock estimate. Runtime ticks (250 ms),
  browser scheduling and native media clocks permit small timing differences.
- The original claim-based Make callback deadline, accepted-result idempotency and
  SKU/token/metadata validation are unchanged. The preparation window begins only
  after a valid result is accepted/selected; it does not extend the generation budget.

## Verification scope

Browser automation uses `D:\CodexTasks\snackstream\fixtures\did-reply-02.mp4`
outside the repository (container duration 5.108005 seconds). CDP supplies those
exact bytes with valid HTTP byte-range responses after approximately three seconds;
SSE transport is synthetic, including a 900 ms state-delivery delay for the fixed
established-viewer case. Baseline Chrome and Edge both reproduced a first
playing position around 3.03 seconds. Tests distinguish an established viewer from
a late join, verify scheduled start and native end, script restoration, no overlapping
audible elements, pause/resume, skip/end and a slower-than-budget viewer.

Fake-clock backend tests verify preparation/start/end boundaries, unchanged actual
duration, pause in preparation, skip/end, queue advancement without viewers and
duplicate protection in both modes. Existing runtime/deadline/browser regressions
remain relevant; original raw outputs and traces are saved outside the repository.
The unfinished media-metadata package and existing `web/next-env.d.ts` are preserved.

No Make scenario, provider, new render or private environment change is required by
these code checks. Real-browser unmuted playback/native end establishes media
behavior, not that a person heard the audio. End-to-end real Make/D-ID acceptance
and completion of N01–N04 are not claimed.

## User-reported replay acceptance — 2026-11-11

The user supplied results from `live-diagnostic-c1886f2c-9e3a-41fa-b480-1edd425f53b7.json`:
reply playback began at `currentTime=0`, reached native `ended` at 5.108005 seconds,
the question became `answered`, script continued, and `droppedEvents=0`. The user
confirmed hearing the complete beginning and end. This is user-provided acceptance
evidence, not an additional test run performed by Codex.

Send-to-first-playing was approximately 11.587 seconds for **replay of existing
media**; it does not measure new-video generation latency. Successful new-video
generation through playback within the 180-second deadline remains unaccepted.
Completion of N01–N04 is not confirmed.
