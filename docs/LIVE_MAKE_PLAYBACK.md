# Make reply playback contract — 2026-11-11

The code supports an authenticated Make `ready` callback through shared reply playback,
completion, FIFO queue release and exact script-position restoration. Automated code
verification uses fake providers. The user has now reported one accepted end-to-end
run creating a new D-ID video; its evidence is recorded below separately from replay
and prior failures. This is **n=1**, not proof of stable latency or completion of N01–N04.
Data and avatars remain experimental; real Odoo is not integrated.

The preceding prerecorded diagnostics package was accepted by the user and committed
as `2f14052`. Its evidence remains in [LIVE_MOCK_PLAYBACK.md](LIVE_MOCK_PLAYBACK.md);
the original independent-player smoke evidence is unchanged.

## Outbound webhook deadline

The backend-to-Make JSON keeps `session_id`, `question_id`, `question`,
`current_live_sku` and `source`, and adds `deadline_unix_ms`: a JSON **integer**
count of milliseconds since the Unix epoch in UTC, not a string or a duration.
It is calculated from the question's `processing_started_at` assigned at claim
plus `LIVE_MAKE_RESULT_TIMEOUT_SECONDS`, using the same `timedelta` arithmetic as
backend expiry/callback admission, then rounded **down** to whole milliseconds.
For example, claim `2026-11-11T00:00:00.123999Z` with timeout 180 seconds produces
`"deadline_unix_ms": 1794355380123`. Fractional configured seconds are supported.
Queue waiting and delayed webhook delivery do not move this deadline. A missing
or timezone-naive/invalid claim timestamp prevents webhook I/O; there is no fallback
to the current time. No public callback/OpenAPI field changes are needed.

Make must preserve this value through every branch and compare its current UTC
Unix milliseconds with it: **stop further processing when `now_ms >= deadline_unix_ms`**.
Check before starting provider work, after each Sleep, before each poll/retry and
before sending a new result; do not derive a budget from Repeater counts or total
Sleep alone. This floor can stop Make less than one millisecond earlier than the
backend's precise deadline. Network transit can still make a callback arrive late;
the backend remains authoritative and rejects a never-accepted expired result.
Previously accepted identical callback retries remain idempotent after deadline.

A deadline check stops subsequent scenario steps; it does **not** cancel provider
work already running. Clock alignment, render/poll/retry budgets and actual Make
mapping still require verification outside this repository.

On 2026-11-11, the user confirmed importing the deadline blueprint into Make and
observing a payload with `deadline_unix_ms = 1` blocked by the entrance filter before
OpenAI 9. That entrance check alone did not verify downstream branches, clock
behavior across Sleep, callbacks or a new D-ID video. The later n=1 happy-path
acceptance below does not establish all branches or timing stability.

## Measure the downloaded MP4

`POST /api/live/media-metadata` accepts **raw binary MP4**, with
`Content-Type: video/mp4` and the same private `X-Live-Make-Token` as callbacks.
It is available only with Make enabled and mock disabled, on both the backend and
the callback gateway (8010). Do not send multipart, a URL, Drive ID, JSON or a command.
Success is HTTP 200 with `{"durationSeconds": 4.365011}` (illustrative fixture result).
The value is the actual uploaded file's ffprobe **container `format.duration`**, a
finite JSON number in `(0, 300]` seconds. No text, bitrate/frame-count estimate,
demo duration or Google Drive metadata is used. At least one video stream is required.
The endpoint never creates/claims a question or changes live/queue state.

Limits are 25 MiB, including streamed/chunked input even with a false/missing
Content-Length, a 15-second body-read deadline, and a 10-second ffprobe timeout.
Uploads must have an MP4 `ftyp` header; malformed files still undergo ffprobe validation.
The temporary file is closed before probing and removed on success, invalid media,
missing executable and timeout. ffprobe runs in a worker thread, with no shell and
only a fixed local input path; remote protocols and MOV external data references
are disabled. Gateway forwarding also runs in a worker, sends exact raw bytes and
token to its fixed backend URL, limits responses to 32 KiB and does not follow redirects.
Its upstream timeout is 15 seconds. Existing `/make-result` forwarding is unchanged.

Prerequisite: install/provide ffprobe on the backend's PATH, or set
`LIVE_FFPROBE_PATH` to an executable path in the backend process environment.
The application still starts without it; only inspection fails with 503
`live_ffprobe_unavailable`. The code does not download/install executables.
Windows portable builds can be obtained from providers linked by the
[official FFmpeg download page](https://www.ffmpeg.org/download.html).
The gateway itself does not need ffprobe. No Dockerfile or shared dependency changed.

Errors use the existing `{ "error": { "code": ..., "message": ... } }` shape:
403 for missing/wrong token; 503 `live_make_disabled` outside Make mode;
415 `live_media_content_type`; 413 `live_media_too_large`;
400 for invalid Content-Length/interrupted body; 408 `live_media_upload_timeout`;
422 `live_media_invalid` or `live_media_duration_invalid` for corrupt/non-video MP4
or missing/non-finite/non-positive/>300-second duration; 504 `live_ffprobe_timeout`.
Gateway backend-connection failures return 502. Do not endlessly retry invalid media.

Make integration contract: **HTTP 20 downloads MP4 → POST those same binary bytes to
`/api/live/media-metadata` → map response `durationSeconds` into HTTP 30's existing
ready callback**. Keep the original IDs/SKU and send a browser-playable HTTPS URL
for that same MP4 as `videoUrl`; this endpoint does not host/upload video. Preserve
`deadline_unix_ms` and check it before measuring, after measuring and before callback;
measurement does not extend the claim deadline. On an unrecoverable inspection error,
send the existing terminal failure before the deadline instead of inventing duration.

An earlier attempt reported D-ID `done` and successful MP4 download/upload, but Drive returned
only ID/mimeType and five metadata reads ended in `failed/generation_failed`.
Local verification uses the supplied MP4 fixture (container duration 4.365011 seconds).
No new render or provider request was made by Codex for that implementation. The
subsequent user-provided acceptance below records one new-video scenario/callback/
playback success; broader coverage and N01–N04 remain unconfirmed.

## User-provided new-video E2E acceptance — 2026-11-11

The user supplied the following correlated evidence for **one newly generated video,
not a replay**. Codex did not execute this scenario, call a provider or independently
rerun the test when recording these results.

| Evidence | User-reported result |
| --- | --- |
| Talk ID | `tlk_q_D04gw8KszhnlNIfipSw` |
| Provider `created_at` | `2026-11-11T13:38:28.748Z` |
| Final HTTP 19 poll | Same Talk ID, `status=done`, `result_url` present |
| HTTP 74 metadata | `durationSeconds=2.971995` |
| HTTP 30 callback | HTTP 200, `received=true`, `applied=true`, `reason=accepted` |
| Diagnostic export | `live-diagnostic-c1886f2c-9e3a-41fa-b480-1edd425f53b7 (1).json` |
| liveId | `0d8ee5540d844051a7228e8b62b4201d` |
| questionId | `0ab5c295-7e42-4692-b49d-2d8d1768d08b` |
| Send-to-first-playing | 73.6826 seconds |
| First playing position / native ended | 0.016199 / 2.971995 seconds |
| User acceptance | Heard the complete reply; script continued |

The export has **`droppedEvents=1925`**. The user reports that this question's
milestones remain retained; the overall log is **not lossless**. Raw evidence stays
outside the repository. Send-to-first-playing covers the whole observed question
path, not provider render time alone.

Keep the attempts distinct: the prior timeout remains an unsuccessful attempt;
the earlier Drive-metadata failure remains `failed/generation_failed`. The accepted
existing-media replay (11.587 seconds to first playing, 5.108005-second clip,
`droppedEvents=0`) is separate from this fresh 73.6826-second E2E run. Do not combine
their log completeness or latency claims.

This accepts one new-video happy path under the current 180-second callback-deadline
configuration. **n=1 does not establish stable latency, repeatability, all error
branches or completion of N01–N04.** Data/avatar are experimental and real Odoo
integration is still absent. Further independent real-world coverage remains needed.

## Successful callback

`POST /api/live/make-result`, JSON, authenticated with the configured
`X-Live-Make-Token` header. The token stays in private server/Make configuration,
never in the browser. Make mode must be enabled and mock mode disabled. The
development callback-only gateway validates and forwards the same body.

Example body: the IDs, URL, text and 12.345-second duration below are illustrative,
not a measurement from a generated D-ID video:

```json
{
  "liveId": "live-example-001",
  "questionId": "question-example-001",
  "sku": "BT-XIKE-01",
  "status": "ready",
  "replyText": "Nội dung trả lời tương ứng với video đã render.",
  "videoUrl": "https://media.example.invalid/rendered-reply.mp4",
  "durationSeconds": 12.345,
  "providerTalkId": "provider-example-001"
}
```

- `durationSeconds` is required for `ready`: a finite JSON number in `(0, 300]`.
  Numeric strings, booleans, NaN and infinity are rejected. It measures the **actual
  final rendered media** at `videoUrl`, not text length, estimated speech duration
  or the fixed prerecorded demo duration.
- `replyText` is nonempty and at most 1500 characters; `videoUrl` is HTTPS without
  embedded username/password. `errorCode` must be absent/null for `ready`.
  `providerTalkId` is optional; if supplied, it has 1–160 characters.
- Existing ID/SKU validation remains. The callback SKU must match the question's
  API-captured SKU, regardless of subsequent pinning changes. All request context
  must survive the Make pipeline.
- The server assigns `mediaSource: make`; do not include that field in the callback.
  The question exposes the value as `videoDurationSeconds`; its reply playback
  exposes `durationSeconds`, `questionId`, `playbackId` and `mediaSource`.
  Existing `isDemo: true` session/question semantics are unchanged.
- The API validates supplied metadata but does not fetch/probe the URL or prove its
  duration truthful. Media reachability, codecs, URL expiry and measured duration
  must be verified by the provider integration.

Accepted callbacks return HTTP 200 with
`{"received":true,"applied":true,"reason":"accepted"}`. Retrying the same validated
result returns `duplicate` without replaying video or releasing a newer question's
slot. Equality includes duration; a changed saved duration/URL/text/SKU/status returns
409 `live_make_result_conflict`.

Before a result is saved: wrong captured SKU returns 409 `live_make_sku_mismatch`,
unknown question returns 404, inactive/expired question returns 409
`live_question_not_active`. Well-formed old-session/ended-session callbacks return
`stale_session`/`session_ended` without applying. A skipped in-flight question can
acknowledge its late result as `question_skipped` but is not restored. Authentication
is still required. The full machine-readable schema is in `api/openapi.json`.

## Missing metadata and finite recovery

Missing/null/invalid duration on `ready`, invalid URLs and invalid result fields
return 422 without partially saving/caching a result. Make may measure/fix the
metadata and retry the same IDs **before the processing deadline**, or send a valid
terminal failure. Until then the question remains `processing`, with
`processingStartedAt` visible in API state.

`LIVE_MAKE_RESULT_TIMEOUT_SECONDS` defaults to 180 and accepts finite values in
`(0, 1800]`. The deadline starts at the API's dispatch claim, not webhook ACK or
viewer join. Runtime checks continue every 250 ms while paused and while a webhook
ACK is blocked. Without a valid result, processing becomes `failed` with
`errorCode: generation_timeout`; the active slot is released and `resultReceivedAt`
stays null. An already skipped in-flight question stays skipped but its abandoned
slot is released at the same deadline. Accepted ready/answering results do not expire
under this generation deadline.

Callback admission enforces the same deadline as runtime expiry: for an uncached
result, `now >= processingStartedAt + configured timeout` is expired, even when no
runtime tick has run. The router passes the same timeout setting as the runtime.
The service samples `now` after acquiring its lock and validating session/question/SKU,
so a request waiting for that lock is evaluated when admitted, not at network arrival.
One private helper, called with the lock already held, marks timeout and releases
the slot; the callback then returns 409 `live_question_not_active` under that lock.
No public locking method is called from another public locking method.

Previously accepted results are checked for duplicate/conflict before expiry. Their
identical retries remain idempotent after the deadline, including after completion
when the next question owns the slot. An expired, never-accepted result is not cached
and cannot be corrected/retried to resurrect the question. Invalid metadata still
returns 422 without changing the claim time; correction is accepted only before
the deadline. Terminal failed/skipped results also obey the uncached-result deadline.

Queue work resumes when the session is playing; while paused, new work stays queued
and ready media waits for resume. Late callbacks after timeout cannot reclaim an
expired slot. Unknown webhook delivery is recorded without automatic resend, and
the same timeout provides recovery. Existing admin skip/end controls remain usable.

## Terminal callbacks

Preserve original IDs and captured SKU; omit/null both `videoUrl` and
`durationSeconds`. Optional `providerTalkId` can preserve provider correlation.

| Make branch | `status` | `errorCode` |
| --- | --- | --- |
| Unsupported intent | `skipped` | `unsupported_intent` |
| No product row | `failed` | `product_not_found` |
| Render/provider failure, including the previously reported HTTP 402 | `failed` | `generation_failed` |
| Polling deadline | `failed` | `generation_timeout` |

For example:

```json
{
  "liveId": "live-example-001",
  "questionId": "question-example-001",
  "sku": "BT-XIKE-01",
  "status": "failed",
  "errorCode": "generation_timeout"
}
```

## Runtime and viewer behavior

The lifespan runtime runs for either mode. Both modes off leave the queue inactive;
settings reject both enabled and the dispatcher refuses conflicting flags. Mock
mode prepares only its prerecorded fixture and sends no Make webhook. Authenticated
callbacks return 503 `live_make_disabled` when Make is disabled or mock is enabled,
without modifying state.

The runtime tracks at most one webhook dispatch task, offloading synchronous I/O
with `asyncio.to_thread`. API-triggered dispatch uses FastAPI's sync background-task
thread pool. Atomic question claims prevent duplicate dispatch across these paths.
Playback/deadline checks continue independently while the webhook waits; SSE/API
event-loop work remains responsive. The existing transport has a 10-second socket
timeout. Cancelling an async task at shutdown cannot abort a synchronous socket
call already running in its thread. Webhook retries are not automatic.

The service saves the script position, assigns a new reply ID and uses the supplied
duration/source. Only one question answers at a time. Pause/resume excludes paused
time; skip restores script position and paused state; end clears playback. Server
completion advances the queue without viewers or client `ended` callbacks. The API
does not cancel upstream render jobs on skip/timeout; late results cannot restart them.

Late viewers seek to the shared position; expired replies are not replayed. Existing
bounded tail handling remains: up to 750 ms can finish locally after normal completion,
for at most 1 second; skip/pause/end/disconnect stop it. Old media is paused before
replacement. The UI labels Make replies **Video trả lời qua Make.** Actual browser
events carry `mediaSource: make` into diagnostics. Neither server `answered` nor
unmuted browser `playing` proves human hearing.

## Required Make work outside this repository

1. Preserve webhook `session_id` as callback `liveId`, `question_id` as `questionId`,
   and `current_live_sku` as the original captured `sku` through every branch.
2. Obtain the final MP4's measured duration using the raw-byte metadata endpoint
   above. **A trustworthy duration field in the D-ID response has not been verified.**
   No D-ID/Drive metadata field is required or asserted here. The probe worker is
   implemented in code; ffprobe provisioning, service restart and Make mapping remain
   integration work outside this repository change.
3. Map the metadata response's numeric seconds to `durationSeconds`. If extraction fails, send
   `failed/generation_failed`; never guess or use 10.077007 seconds. Keep tokens
   server-side and ensure browser playback needs no exposed provider API credential.
4. Wire all terminal branches above, including automatic provider-error and polling
   timeout routes. Retry identical callback results. Handle 422 by correcting metadata
   before the deadline; reconcile 409 rather than endlessly retrying a conflict.
5. Align Make render/polling and callback retry budgets with the API processing
   deadline. The previously used Repeater 30 / Sleep 10-second configuration can
   spend up to 300 seconds on Sleep alone, excluding the other pipeline steps.
   The current scenario/budget has not been verified. The API default stays at
   180 seconds; do not assume changing it to 300 would cover the complete budget.
   Budget synchronization remains external integration work. No private environment
   values were changed in this work.
6. Update/restart the callback gateway and backend together: legacy `ready` bodies
   without duration now fail 422; failed/skipped bodies without media fields remain
   valid. Backend callback probes also now require Make mode enabled.
7. Continue checking mapping and automatic error routes with fake providers before
   paid renders. The user's n=1 new-video acceptance above is a separate real-world
   checkpoint; repeatability, latency stability and multi-viewer/error coverage
   still require further acceptance.

No Make scenario was edited by this repository implementation. The earlier HTTP 402
InsufficientCreditsError is historical evidence; the user's latest render reached
`done`. The later new-video playback acceptance above covers one reported happy path;
it does not establish complete real-scenario coverage.

## Verification and reproduction

Original Make-package checks on 2026-11-11, before the strict callback-deadline fix:

| Check | Result |
| --- | --- |
| Ruff: live module, tests, main and config | Passed |
| Full backend pytest suite | 173 passed; existing Starlette/httpx deprecation warning only |
| OpenAPI export and TypeScript regeneration | Completed |
| Diagnostics/timing tests | 30 passed |
| Frontend typecheck, full lint and production build | Passed |
| Browser regression, Chrome headless | 13 groups passed |
| Browser regression, Edge headless | 13 groups passed |
| Root working/staged diff checks | Passed; staging remains empty |

Backend cases include authenticated ready/failed/skipped callbacks, strict/missing
duration and corrected retry, conflicting/duplicate results, captured SKU validation,
old/ended sessions, pause/resume, skip/end, FIFO restoration without viewers, local
callback expiry and late results. Fake blocked webhook tests verify actual SSE
generator output, ready-reply completion and timeout recovery before its ACK is
released. The lifespan test runs ready/failed/skipped HTTP callbacks to shared reply
completion with a fake sender and no viewers. These are code checks with synthetic
provider results, not acceptance of a D-ID-generated video.

Strict callback-deadline regression checks, subsequently executed on 2026-11-11:

| Check | Result |
| --- | --- |
| Ruff: live module, tests, main and config | Passed |
| `pytest tests/test_live_make_deadline.py -vv --tb=short` | 35 passed |
| Full backend pytest suite | 208 passed; existing Starlette/httpx warning only |
| Diagnostics/timing tests | 30 passed |
| Working/staged diff checks | Passed; staging remains empty |

The new HTTP tests use fake clocks with both 180-second and 7.5-second settings.
They cover one microsecond before, exactly at, one microsecond after and one second
after the deadline without any tick; pause; a late callback while the next question
is processing; concurrent HTTP callback and expiry workers; valid duplicates after
the deadline in ready/answering/answered/skipped phases; missing/invalid metadata
422 followed by corrected callbacks before/at/after deadline; terminal/skipped expiry;
and existing token/SKU/metadata/old-session/end guards. Queue waiting before claim is
excluded. Original stdout/stderr and JUnit reports were saved outside the repository.
No provider or manual browser check was needed for this backend-only correction.
The HTTP body/response schema is unchanged, so no further OpenAPI/type regeneration
is required for the deadline fix.

Backend checks (from `api`):

```powershell
& ".\.venv\Scripts\python.exe" -m ruff check app/modules/live tests app/main.py app/core/config.py
& ".\.venv\Scripts\python.exe" -m pytest --tb=short
& ".\.venv\Scripts\python.exe" -m app.export_openapi openapi.json
```

From `web`: `npm.cmd run gen:types`, `npm.cmd run test:live`, `npm.cmd run typecheck`,
`npm.cmd run lint`, `npm.cmd run build`. Browser regression:

```powershell
# Separate terminal, from web:
npm.cmd run start -- --hostname 127.0.0.1 --port 3107
# Another terminal, from web:
$env:LIVE_TEST_BASE_URL = 'http://127.0.0.1:3107'
npm.cmd run test:live:browser
$env:LIVE_TEST_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm.cmd run test:live:browser
Remove-Item Env:LIVE_TEST_BROWSER
Remove-Item Env:LIVE_TEST_BASE_URL
```

The harness uses a real local MP4, mocked SSE/question transport, and a synthetic
HTTPS provider URL intercepted before network delivery and served from that local
MP4. It checks Make label/source/diagnostics, duplicate snapshot identity, late join
and script restoration. It does not generate speech, contact D-ID/Make or confirm
human hearing. The ignored MP4 must be supplied locally; temporary profiles stay
outside the repository. The existing standalone-build warning from `next start`
is unchanged.
