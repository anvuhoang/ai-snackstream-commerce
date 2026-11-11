# Live integration checkpoint — 2026-11-11

Branch: `feat/live-playback-log`.

The user subsequently accepted the prerecorded diagnostics package, committed as
`2f14052`. The next code package supports Make reply playback with a measured-duration
contract and fake-provider verification; see [LIVE_MAKE_PLAYBACK.md](LIVE_MAKE_PLAYBACK.md).
The prerecorded evidence below remains the earlier checkpoint.

## Current result

The web can receive questions, prepare a prerecorded reply, interrupt the shared script,
play the reply once, and resume the script at its saved position. The user reported
successful manual checks in Chrome and Edge. This checkpoint verifies prerecorded
playback and control flow; it does not establish acceptance of newly generated AI replies
or N04 question-to-audible-answer latency.

The earlier independent-player smoke-test evidence remains in
[LIVE_PLAYBACK_24H.md](LIVE_PLAYBACK_24H.md) and
`docs/verification/live-playback-24h/`. Those JSON exports describe the earlier smoke
test, not the interrupt/resume tests recorded below.

## Implemented behavior

- Admin session creation, start/end, pause/resume, scheduled SKU list and pinning.
- Viewer and admin state updates through SSE.
- Question IDs prevent duplicate submissions; the SKU is captured when the question arrives.
- Up to three waiting questions and one active question; replies run serially.
- Server-side playback timing; a viewer's `ended` event does not advance the shared queue.
- The reply plays once; the script loops and resumes at its saved position after completion.
- Skipping a playing reply restores the script and releases the next question.
- Pausing freezes playback progress; skipping while paused keeps the restored script paused.
- Late viewers seek to the current shared playback position.
- Initial media alignment includes delivery delays below 750 ms and waits for seeking
  before starting playback. An expired reply is not started again by a late viewer.
- A normally answered reply already playing within 750 ms of the media end can finish
  its local tail before the next player mounts. The grace expires after 1 second;
  skip, session pause/end, invalid state and disconnect cancel it immediately. The old
  element is paused before replacement, so two reply players do not overlap in a tab.
  A viewer stalled farther behind follows the server instead of delaying the queue;
  release reason and actual media position remain in the diagnostic export.
- Question and playback metadata identify prerecorded media; the UI labels the simulation.
- Make delivery, authenticated result callback, and a development callback-only gateway.

The mock uses the same local MP4 for both script and reply. Its speech is prerecorded
and does not answer the newly submitted question. The source label and playback kind
distinguish the two phases.

## Local mock configuration

Set these values in `api/.env`:

```dotenv
LIVE_MAKE_ENABLED=false
LIVE_MOCK_ENABLED=true
LIVE_MOCK_VIDEO_DURATION_SECONDS=10.077007
```

The duration corresponds to the existing verified clip at
`web/public/live-demo/avatar.mp4`. If that file is replaced, measure and update its
duration before testing. The MP4 is ignored by Git and must be supplied locally.
Both modes default to disabled in `.env.example`; enabling both is rejected.

Run from `api`:

```powershell
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --reload --timeout-graceful-shutdown 3
```

Run from `web` in a separate terminal:

```powershell
npm run dev
```

The mock playback task starts with the API when mock mode is enabled and is cancelled
on shutdown. No separate playback process or callback tunnel is required for mock mode.
Restart the API after changing environment configuration, then create a new test session.

## Verification

Executed on 2026-11-11 for the prerecorded checkpoint committed as `2f14052`, before
the Make runtime change. New Make-package checks are recorded in
[LIVE_MAKE_PLAYBACK.md](LIVE_MAKE_PLAYBACK.md):

| Check | Result |
| --- | --- |
| `api`: `.\.venv\Scripts\python.exe -m ruff check app/modules/live tests` | Passed; existing live-router import spacing corrected |
| `api`: `.\.venv\Scripts\python.exe -m pytest --tb=short` | 128 passed; existing Starlette/httpx deprecation warning only |
| `web`: `npm.cmd run test:live` | 30 passed (Node 24.15.0 native TypeScript support; no new dependencies) |
| `web`: `npm.cmd run typecheck` | Passed |
| `web`: `npm.cmd run lint` | Passed, no warnings |
| `web`: `npm.cmd run build` | Passed |
| `web`: `npm.cmd run test:live:browser` | 12 browser regression groups passed in headless Chrome and Edge; real local MP4, mocked SSE/question transport |
| Root: `git diff --check` | Passed |

Backend tests cover duplicate/concurrent operations,
FIFO processing, original SKU preservation, pause accounting, exact script-position
restoration, skip/end handling, mode isolation and task lifecycle, including queue
progress with no viewers. A previous local TCP check
also observed two SSE connections receiving the same reply playback ID, then the
restored script. This transport check did not test browser media playback.

The browser regression exercises the actual `/live` components and MP4, including
disabled and paused controls, uncertain delivery/retry, HTTP 5xx/4xx, concurrent submit
guard, sub-tolerance initial seek, two viewers sharing a reply ID, late-viewer unknown
latency, pause/resume, native reply end, bounded stalled tail with the next queued reply,
immediate skip/pause/end, disconnect/reconnect, expired reply suppression and 500-event
accounting. It uses isolated temporary profiles outside the repository and captures
JSON in memory. It does not test real SSE network delivery, provider calls, human
hearing, or production autoplay permissions. Backend/transport checks and human audio
acceptance cover different parts of the flow.

Reproduce the automated browser checks with the local MP4 supplied. Run from `web`:

```powershell
npm.cmd run test:live
npm.cmd run build
# Keep this running in a separate terminal (no backend required for mocked transport).
npm.cmd run start -- --hostname 127.0.0.1
# In another terminal:
npm.cmd run test:live:browser
$env:LIVE_TEST_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm.cmd run test:live:browser
Remove-Item Env:LIVE_TEST_BROWSER
```

`next start` currently warns about the repository's `output: standalone` setting;
the local test run served the pages and MP4 successfully. `npm.cmd` avoids a Windows
PowerShell script-execution-policy restriction; `npm` works where that restriction
does not apply. `LIVE_TEST_BASE_URL` can select a different local server port;
`LIVE_TEST_BROWSER` can select another Chromium executable. The harness rejects
non-local base URLs. No browser package download is needed.

The following results were reported by the user on 2026-11-11, before this final timing
change. They remain human reports rather than new audio acceptance of this revision:

| Manual case | Reported result |
| --- | --- |
| Script → prerecorded reply → script in Chrome and Edge | Passed; picture/audio and automatic transitions, without re-enabling playback |
| Pause during reply, wait at least 12 seconds, resume | Passed; no completion while paused, remaining playback then script resumes |
| Queue A and B, skip A during playback | Passed; A skipped, B processed, final return to script, no overlapping replies within one browser |
| Reopen Edge during a reply | Passed; joins the current reply position and returns to script with Chrome, without adding a question |

## Per-question browser diagnostics

`/live` records up to 500 events in the current page's memory, with unique event IDs,
a per-page `sessionId`, monotonic `elapsedMs` and an eviction counter. Use **Cập nhật
tổng hợp câu hỏi** for a readable snapshot and **Tải log JSON** before closing/reloading
the tab. Export scope is `live-playback-diagnostic`, schema version 2, containing
`events`, `droppedEvents` and `questionSummaries`. This is a client diagnostic artifact,
not a persistent analytics/N04 contract.

Each summary groups only the same `(sessionId, liveId, questionId)`:

- `sendToFirstReplyPlaybackMs` subtracts the original non-retry send's `elapsedMs`
  from the first actual reply `playing` event in this page. Retries with the same ID
  preserve the original baseline; repeated `playing` events after a stall/resume do
  not create more answer measurements. `sendToAckMs` is separate.
- `playbacks` keeps distinct playback IDs, media sources, first playing, playing-event
  counts, native ended evidence and interruptions/release reasons. The API-captured
  question SKU is used; `pinnedSkuAtSend` is only request context.
- Late viewers, evicted/missing original sends, missing playback and invalid/negative
  deltas produce `null` plus `unknownReason`. No server/browser wall-clock subtraction
  or zero substitute is used.
- `requestObservations` retains acceptance, rejection and uncertain delivery.
  `serverObservations` retains observed question statuses separately from browser
  media evidence. First sight of a question, and the first snapshot after reconnect,
  is labelled `snapshot`; `previousObservedStatus` is a previous observation, not
  proof that the browser saw all server transitions or played the answer.
- `sendToHeardMs` stays `null`. Unmuted `playing`, volume 1 and an API `answered`
  status do not prove that the listener heard audio. No new audio-confirmation UI
  or inference from OS/speaker state is added.

The separately supplied `live-diagnostic-05db9b06-1d77-439e-8cc1-2b1db7a320f2.json`
was reported as 35 events with no dropped events/errors, one question, 88.6 ms send-to-ack
and 769.6 ms send-to-first-reply-playing. It is one prerecorded sample, not AI
generation latency or a guarantee. No local attachment path is asserted here.
Its pause at 9.86354 s of 10.077007 s motivated the timing investigation. The previous
player could leave sub-750 ms startup lag uncorrected and stop/unmount at the server
deadline; this is a reproducible clipping mechanism, not proof of that sample's cause.
Regression checks now cover precise initial alignment and the final local tail.

## One final human acceptance pass (10–15 minutes)

With the local mock configuration above, open `/live` in Chrome and Edge and the
admin controls. Enable picture/audio separately in each viewer. Send a question and
listen through the last syllable of the reply and the return to script. During another
reply, pause for at least 12 seconds and resume; queue another question and skip the
current reply. Confirm the next reply plays without overlapping audio, then end the
session and confirm silence. Download both JSON exports and review the question
summary; a viewer that did not submit the question should show unknown send latency.
This pass is for actual picture/sound and browser permissions, not the automated matrix.

## Make and D-ID status

The real web question reached Make and D-ID `POST /talks`. D-ID returned HTTP 402 with
`InsufficientCreditsError`; no new avatar video was produced by that request.

Connectivity and result handling verified separately:

- The development HTTPS callback path reached the local API through the callback-only gateway.
- A standalone callback with fake IDs was acknowledged as `stale_session` and not applied.
- A manual failure result for the active failed generation was accepted.
- The HTTP failure notification module was tested separately with the same IDs and acknowledged
  as `duplicate`. Its automatic execution on the D-ID error route has not yet been observed.

Keep private Make webhook URLs and callback tokens in local configuration or the Make
connection. Do not put them in source files, this document, or browser-side configuration.

## Remaining work and limits

- Restore sufficient D-ID API credit and verify a newly generated Vietnamese reply end to end.
- The code now accepts Make replies with validated measured `durationSeconds` and runs
  them through the shared playback runtime. Real duration extraction and Make callback
  mapping remain unverified; switching environment flags alone does not supply that
  metadata or complete real generated-reply acceptance. See the new contract above.
- Add and test callbacks for Make branches that currently stop without a result, including
  unsupported intent, missing product rows, render failure and polling timeout. Required
  terminal results to `/api/live/make-result` are:

  | Make branch | Suggested status | Required `errorCode` |
  | --- | --- | --- |
  | Unsupported intent | `skipped` | `unsupported_intent` |
  | Missing product row | `failed` | `product_not_found` |
  | Render/provider failure, including HTTP 402 | `failed` | `generation_failed` |
  | Polling deadline | `failed` | `generation_timeout` |

  Every callback must preserve the original `liveId`, `questionId`, API-captured `sku`
  and authenticate with `X-Live-Make-Token`. Terminal failures have no `videoUrl`.
  Retry the identical result for the same IDs; conflicting duplicate results are
  rejected. Verify automatic error-route execution, queue release and late/stale
  callbacks with mocked providers before spending credit. Make scenarios were not
  edited during this checkpoint. Ready results also need `replyText`, an HTTPS
  `videoUrl`, measured `durationSeconds` and optional `providerTalkId`. The code path
  now supports these results; external metadata extraction/mapping still needs
  verification under the new contract.
- Finish shared catalog/script integration and any remaining admin/comment controls against
  the agreed project requirements.
- Implement the agreed persistent event/answer logs and measure viewer-side send-to-audible-answer
  latency. Server status `answered` reflects the shared playback timeline, not proof that a
  particular viewer heard the answer.
- Sessions and questions currently live in API memory. Use one API worker; restarting loses
  this state. Durable storage and migrations require coordination with An.

This checkpoint is part of the live module. It does not complete N01–N04 or establish
final acceptance of the whole module.
