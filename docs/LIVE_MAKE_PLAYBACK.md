# Make reply playback contract — 2026-11-11

The code supports an authenticated Make `ready` callback through shared reply playback,
completion, FIFO queue release and exact script-position restoration. Verification uses
fake providers; no Make scenario, paid webhook or new D-ID render was used. A real newly
generated Vietnamese D-ID video has **not** been accepted end to end. This does not
complete N01–N04.

The preceding prerecorded diagnostics package was accepted by the user and committed
as `2f14052`. Its evidence remains in [LIVE_MOCK_PLAYBACK.md](LIVE_MOCK_PLAYBACK.md);
the original independent-player smoke evidence is unchanged.

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
2. Obtain the final MP4's measured duration. **A trustworthy duration field in the
   D-ID response has not been verified.** No D-ID/Make field name is asserted here.
   Verify a documented provider metadata field against produced media, or measure
   the exact final asset with a trusted media-probe worker, such as ffprobe on that
   file. This extraction/worker is not implemented in this repository package.
3. Map numeric seconds to `durationSeconds`. If extraction fails, send
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
7. Verify mapping and automatic error routes with fake providers before any paid
   render. Once access/credit and extraction are available, separately accept a newly
   generated Vietnamese D-ID video, actual picture/audio, measured duration, return
   to script and two-viewer behavior.

No Make scenario was edited. The previously reported real provider result was HTTP
402 InsufficientCreditsError, which remains a blocker for real-video acceptance.

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
