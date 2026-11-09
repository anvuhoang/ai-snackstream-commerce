# Live playback check: 24-hour milestone

Status: playback smoke-test accepted by the user in Chrome and Edge on 2026-11-07; the two exported
client logs were inspected. Agreement with An on the proposed log extension remains pending.
This small N01 test does not complete N01-N04 or P6.

## Run

Use branch `feat/live-playback-log` from `dev`. Run the API and web as described in the project README.
Copy a playable existing Q-014 MP4 to `web/public/live-demo/avatar.mp4`, creating the folders as needed.
The copy is ignored by Git; keep the original evidence file. No new avatar generation is needed.

Open `/live/check` in Chrome and Edge on the same computer. Both fetch the same media file, but have independent
playback controls and client sessions. This proves neither shared broadcast nor Make integration,
host control, question handling or interrupt/resume. It tests the HTTP media path and client playback.

Preparation checks: TypeScript typecheck, ESLint, Next.js production build and `git diff --check` pass.
Browser automation could not run in the preparation environment (browser launch/socket and preview
connection restrictions). No automated browser test is claimed as passed. The user subsequently
reported successful picture, sound and JSON download in Chrome and Edge; see the evidence below.

## Observed viewer evidence: 2026-11-07

The unmodified client exports are stored in `docs/verification/live-playback-24h/`:

| Check | Log session `9e7dff1d...` | Log session `6f266f93...` |
| --- | --- | --- |
| Total events | 20 | 4 |
| `live_join` | 1 | 1 |
| `live_playback_started` | 2 | 1 |
| `live_playback_ended` | 2 | 1 |
| `live_audio_confirmed` | 1 | 1 |
| `live_playback_error` before first successful playback | 7 | 0 |
| `live_playback_error` after first successful playback | 0 | 0 |

Both logs use `LIVE-PLAYBACK-DEMO-001`, with distinct client session IDs. All 24 events have unique
event IDs, ordered ISO-8601 UTC timestamps, `isDemo: true`, `source: "web_live"` and the expected envelope.
Both explicit audio confirmations have `muted: false`, `volume: 1`, and `confirmedBy: "viewer"`.
The first log includes five retry actions before metadata and successful playback; the reported duration
and ended position are about 10.077 seconds. It therefore records recovery, not an error-free first run.

The early failures record `NotSupportedError` or media error code 4; the logs alone do not establish the
underlying file, delivery or codec cause. Keep these errors as evidence. The exports do not record
browser name/version, so do not infer which file is Chrome or Edge from filenames or upload order.

Acceptance is based on the user's picture/sound confirmation plus these client logs. It is not proof
of shared broadcast, server-persisted logging, Make question handling, N04 answer latency or continuous
operation. The new event names/fields below are still a proposal for An's review.

## Manual acceptance

1. Without the file, verify a useful error state instead of a blank screen.
2. Add the MP4 and click **Thu tai lai**. Verify the player becomes ready.
3. In Chrome, click **Phat video**, verify moving images, enable sound and listen to the avatar.
4. Only after hearing it, click **Toi nghe duoc tieng**. Download the JSON log.
5. Repeat in Edge with the same URL. Enable sound separately and download its JSON log.
6. Verify the exports share `liveId`, have different `sessionId` values and contain playback and explicit
   viewer audio-confirmation events. Save a short screen recording from the viewer side.
7. Check phone-width layout. Record browsers, actual results and manual intervention.

The direct media URL is `/live-demo/avatar.mp4`. If it cannot play directly, inspect the file and codec.
Do not infer playback success from HTTP 200 alone.

## Proposed log extension

Keep ARCHITECTURE.md's envelope: `event`, `sessionId`, `liveId`, `occurredAt` (ISO-8601 UTC), `isDemo: true`,
`source: "web_live"`. Add `eventId` and `details` for this smoke test:

```json
{
  "eventId": "client-generated-uuid",
  "event": "live_playback_started",
  "sessionId": "uuid-per-page-load",
  "liveId": "LIVE-PLAYBACK-DEMO-001",
  "occurredAt": "2026-11-07T00:00:00.000Z",
  "isDemo": true,
  "source": "web_live",
  "details": {
    "mediaUrl": "/live-demo/avatar.mp4",
    "currentTime": 0,
    "muted": false,
    "volume": 1
  }
}
```

- `live_join`: once per page mount, guarded against development Strict Mode effect replay.
- `live_media_ready`: metadata loaded; includes duration, not proof of playback.
- `live_playback_started`: HTML `playing` event; includes mute/volume, not proof of audible speech.
- `live_playback_paused`, `live_playback_waiting`, `live_playback_ended`: playback lifecycle.
- `live_playback_error`: media failure or rejected play request; includes error classification.
- `live_playback_retry`, `live_volume_changed`: viewer actions.
- `live_audio_confirmed`: viewer confirmation; enabled only while playing with sound enabled.

Logs stay in tab memory (last 200 events), export to JSON and reset on reload. No ingestion endpoint or
database table is added. New names and fields require agreement with An before dashboard integration;
only `live_join` is already in the common event list. The P6 question log contract remains unchanged.

Question-to-audible-answer latency cannot be measured by this test: there is no new question. Do not
substitute media loading time for N04 response latency. Later associate `questionId` with send/playback
timing from the same viewer clock and explicitly handle muted playback.

## Next integration

Agree on one shared session and its playback/queue control with An. Add the `live` module and SSE inside
the common FastAPI app; use catalog/cart interfaces when available. An owns migrations. Then integrate
web questions with Make and measure Vietnamese avatar responses before claiming N03/N04 acceptance.
