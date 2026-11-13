# AI Live integration

## Scope and current status

`/admin/live` manages sessions, scheduled SKUs, pinning, pause/resume, questions and
skip/end controls. `/live` follows the shared session through SSE, submits questions,
plays replies once and resumes the script at its saved position.

Make mode creates a reply through the external AI/voice/avatar scenario. Mock mode
uses prerecorded media without calling Make. Data and avatars are experimental;
real Odoo data and an avatar-customization interface are not integrated. This is
generated-video playback, not continuous real-time avatar streaming.

Sessions and questions are held in API memory. Use one API worker; a restart clears
them. Durable storage and migrations require coordination with the migration owner.

## Local setup

Start the API and web as described in [README](../README.md). Run the backend from
`api` so its local `.env` is loaded. Supply a playable script MP4 at
`web/public/live-demo/avatar.mp4` for legacy sessions/mock replies; this file is ignored by Git.

## Product script playlist (experimental)

When creating a session, admins can add, remove and reorder up to 30 script clips.
All content and avatars remain test data. This feature does not upload, render,
generate scripts or fetch products from Odoo. A create request can include:

```json
{
  "title": "Product introduction (test)",
  "scheduledSkus": ["SKU-A", "SKU-B"],
  "scriptPlaylist": [
    {"name": "Product A", "sku": "SKU-A", "videoUrl": "https://example.invalid/a.mp4", "durationSeconds": 5.108005},
    {"name": "Product B", "sku": "SKU-B", "videoUrl": "https://example.invalid/b.mp4", "durationSeconds": 4.365011}
  ]
}
```

The example durations illustrate measured seconds, not defaults. Supply the actual
container duration of each exact file (for example from ffprobe). The backend
validates a nonempty name, scheduled SKU, HTTP/HTTPS URL without embedded credentials,
and a finite numeric duration in `(0, 3600]`; strings and booleans are rejected.
It does not download or verify remote URLs/durations. Use HTTPS media on HTTPS pages;
HTTP is accepted for local fixtures, subject to browser mixed-content rules.

Playback exposes `mediaSource: "playlist"`, zero-based `scriptIndex`, `scriptName`
and the measured `durationSeconds`. The server's UTC timeline decides each segment
and offset, carries exact segment boundaries across delayed ticks, and updates
`pinnedSku` automatically. Manual pinning returns 409 for playlist sessions.
Question receipt and segment advancement share the lock and timestamp: a question
captures that segment's SKU permanently, including at an exact boundary.
When either Make or mock mode is enabled, the application starts the background
runtime, which advances script segments without viewers. When both modes are off,
there is no background worker: `get_current` and relevant service operations
recalculate the position from the shared clock when called. Questions are not
dispatched in that mode.

A reply freezes the current script segment and offset at selection, including its
shared five-second preparation window. Normal completion or skip restores that
segment/offset; pause/resume preserves both script position and reply preparation.
The Make claim deadline, queue limits and callback idempotency are unchanged.

The playlist runs **once**. At its end `scriptCompleted` becomes true and script
`playback` is null; new questions return 409 (`live_script_completed`). Retries of
already received questions remain idempotent. The session stays active to drain
previously accepted questions through the selected Make/mock mode. Pending callbacks
still expire on their original deadline. Replies are never cut off by the end of
the playlist: the script is frozen during a reply, and replies received after script
completion still play once before returning to no script. Admin can then end the
session. With provider modes disabled, question dispatch remains disabled as before;
admin may skip pending questions or end the session.

Late/reconnecting viewers align to the current segment's shared offset. Playlist
clips do not loop, unlike the legacy demo. Media load/error/early native end never
blocks the server clock; errors are shown in the player and the next segment still
starts on schedule. Delivery is subject to the existing SSE interval and network
delay, so late/slow clients can miss media at a boundary. No viewer acknowledgement
extends a segment. Omitting `scriptPlaylist` or passing `[]` retains legacy demo
looping, manual SKU pinning and question behavior.

## Provider configuration

Choose one mode in `api/.env`:

| Setting | Make mode | Local mock mode |
| --- | --- | --- |
| `LIVE_MAKE_ENABLED` | `true` | `false` |
| `LIVE_MOCK_ENABLED` | `false` | `true` |
| `LIVE_MAKE_WEBHOOK_URL` | Private scenario webhook URL | Unused |
| `LIVE_MAKE_CALLBACK_TOKEN` | Private random token of at least 32 characters | Unused |
| `LIVE_MAKE_RESULT_TIMEOUT_SECONDS` | Defaults to 180 | Unused |
| `LIVE_FFPROBE_PATH` | `ffprobe` on PATH or an absolute executable path | Unused |
| `LIVE_MOCK_VIDEO_DURATION_SECONDS` | Unused for generated replies | Actual duration of the local MP4 |

Both modes default to disabled; enabling both is rejected. The mock duration defaults
to 10.077007 seconds and must be updated when its fixture changes. Mock speech is a
simulation and does not answer the submitted question. Restart after changing API
configuration, then create a fresh session.

The backend needs ffprobe for generated-media inspection. Obtain an executable from
sources linked by the [FFmpeg download page](https://www.ffmpeg.org/download.html).
The application starts without it, but media inspection then returns 503. Production
images must provision ffprobe separately; the application does not install it.

For local public callbacks, the development gateway exposes only the callback and
media-metadata routes and forwards to backend port 8000. From `api`:

```sh
uv run uvicorn dev_callback_gateway:app --host 127.0.0.1 --port 8010
```

Forward gateway port 8010 through HTTPS. Configure Make's saved API-key connection
to send `X-Live-Make-Token` to that origin. The gateway itself does not need ffprobe.
Keep tokens and webhook URLs in private configuration, never browser code.

## Question dispatch and Make mapping

The backend accepts at most three waiting questions and one active question. It
captures the pinned SKU on receipt; later pin changes do not alter that question.
Stable question IDs prevent duplicate submission. Atomic claims and one active slot
keep dispatch serial; uncertain webhook delivery is not automatically resent.

The outbound webhook contains:

| Field | Meaning |
| --- | --- |
| `session_id` | Live ID; map to callback `liveId` |
| `question_id` | Stable question ID; map to `questionId` |
| `question` | Viewer text |
| `current_live_sku` | Captured SKU; map unchanged to `sku` |
| `source` | `web_live` |
| `deadline_unix_ms` | Integer UTC Unix milliseconds: claim time plus configured timeout, rounded down |

Queue waiting and delayed webhook delivery do not extend the deadline. An invalid or
missing claim timestamp prevents outbound I/O. Make must preserve the deadline and
stop work when `now_ms >= deadline_unix_ms`: check before generation, after each
Sleep, before polling/retry and before callbacks. Repeater counts or total Sleep are
not substitutes for the original deadline. Stopping Make does not cancel a provider
job already running; the backend remains authoritative for callback admission.

For a successful result, preserve IDs/SKU through classification and product lookup,
generate the reply, wait for D-ID `done`, download the MP4, measure those exact bytes,
then send the ready callback. In the current scenario, HTTP 20 downloads media,
HTTP 74 measures it and HTTP 30 sends the result. HTTP 17/18/19 use the same D-ID
account; the metadata/callback modules use the callback-token connection.

## Media metadata endpoint

`POST /api/live/media-metadata` requires Make enabled, mock disabled and the private
callback token. Send raw MP4 bytes with `Content-Type: video/mp4`; multipart, JSON,
URLs and Drive IDs are not accepted.

```json
{"durationSeconds": 2.971995}
```

The response is a finite JSON number in `(0, 300]`, measured from the uploaded
container's ffprobe `format.duration`. At least one video stream is required. Map
this number directly to `durationSeconds`; supply a browser-playable HTTPS URL for
the same asset. The endpoint does not host media or change live/queue state. Do not
estimate duration from text or reuse a demo duration. Drive metadata is not required.

Uploads are limited to 25 MiB and 15 seconds; probing is limited to 10 seconds.
ffprobe runs outside the event loop, without a shell, using a temporary local file,
restricted protocols and disabled external media references. Temporary files are
removed on success and failure. Gateway forwarding also runs outside the event loop,
uses a fixed local backend, disables redirects, limits responses to 32 KiB and has a
15-second upstream timeout.

Errors use the shared error shape: 403 for invalid token; 503 for disabled mode or
unavailable ffprobe; 415 for content type; 413 for size; 400 for invalid length or
interrupted upload; 408 for upload timeout; 422 for invalid media/duration; 504 for
probe timeout. Gateway connection/response failures return 502.

## Result callback

`POST /api/live/make-result` requires the same token and mode checks. The full schema
is in `api/openapi.json`. Example values below are illustrative:

```json
{
  "liveId": "live-example-001",
  "questionId": "question-example-001",
  "sku": "BT-XIKE-01",
  "status": "ready",
  "replyText": "Nội dung trả lời tương ứng với video đã render.",
  "videoUrl": "https://media.example.invalid/reply.mp4",
  "durationSeconds": 12.345,
  "providerTalkId": "provider-example-001"
}
```

Ready results require nonempty `replyText` of at most 1500 characters, an HTTPS URL
without embedded credentials and a finite numeric duration in `(0, 300]`. Numeric
strings, booleans, NaN and infinity are rejected. Omit/null `errorCode`.
`providerTalkId` is optional, with 1–160 characters when supplied. The server assigns
`mediaSource: make`; do not include that field in the callback.

For terminal failure/skip, preserve IDs/SKU, include `errorCode`, and omit/null both
`videoUrl` and `durationSeconds`:

| Outcome | `status` | `errorCode` |
| --- | --- | --- |
| Unsupported intent | `skipped` | `unsupported_intent` |
| No product row | `failed` | `product_not_found` |
| Provider/render/metadata failure | `failed` | `generation_failed` |
| Processing deadline reached | `failed` | `generation_timeout` |

Accepted results return HTTP 200 with `received=true`, `applied=true` and
`reason=accepted`. An identical accepted retry returns `duplicate` without replay;
changed saved content returns 409 `live_make_result_conflict`. Wrong captured SKU
returns 409; unknown questions return 404; invalid metadata returns 422 without
partially saving a result. Metadata may be corrected with the same IDs before the
original deadline. Well-formed old/ended-session callbacks are acknowledged without
applying; authentication is still required.

The timeout defaults to 180 seconds and accepts finite values in `(0, 1800]`. Runtime
and callback admission enforce the same claim-based deadline, including while paused
or waiting for webhook I/O. At expiry, processing fails with `generation_timeout`
and releases its slot. Never-accepted results at/after the deadline return 409 and
cannot revive that question. Identical previously accepted retries remain idempotent
after the deadline. Ready/answering results are no longer subject to generation
expiry. A skipped in-flight question cannot be restored by a late result.

## Shared playback and preparation

A valid selected reply reserves its slot, saves/freezes script position and publishes
`startedAt = selection time + 5 seconds`. The viewer preloads while paused and waits
for that shared start. The server finishes at `startedAt + actual duration`; the
five seconds do not change media duration or extend the generation deadline. This
adds a bounded silent preparation interval and does not accelerate D-ID rendering.
Backend and player must be updated together; existing tabs must reload the player.

Pause freezes preparation/playback; resume shifts the same start time by paused
duration. Skipping a selected reply restores script and releases its slot; skipping
while paused leaves script paused. A skipped in-flight generation retains its slot
until a callback or timeout; upstream rendering is not canceled. End clears playback.
Timers and old audio are stopped before replacement. Runtime and FIFO completion
continue with no viewers.

Late join/reconnect follow the shared time; expired replies are not replayed. Loading
longer than the available preparation window may still skip media. No viewer can
postpone the whole session. Server timestamps plus monotonic time after receipt are
not RTT-corrected and allow small viewer offsets. Normal completion permits only the
existing tail of at most 750 ms of media for at most one second; skip/pause/end or
disconnect cancels it. Only one player is audible in a tab.

## Browser diagnostics

`/live` retains at most 500 events in tab memory and exports schema version 2 with
`events`, `droppedEvents` and per-question summaries. Download before closing or
reloading. This is local diagnostics, not persistent analytics or a dashboard feed.

Summaries group only the same `(sessionId, liveId, questionId)`. Send-to-first-playing
uses the original send and the first reply `playing` event on that page's monotonic
clock. Retry/stall events do not create new answer measurements. Missing/evicted
sends, late viewers and invalid timing produce `null` with an explanation, not zero.
Server observations are distinct from media events. `sendToHeardMs` stays null;
unmuted playback and server `answered` do not prove human hearing.

## Verification

From `api`: `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`.
After router/schema changes, regenerate OpenAPI and web types as required by README.
From `web`: `npm run test:live`, `npm run typecheck`, `npm run lint`, `npm run build`.

With a running local web server, `npm run test:live:browser` exercises the actual
player with synthetic SSE/question transport and a local MP4. Select an installed
Chromium browser with `LIVE_TEST_BROWSER` and a local server with `LIVE_TEST_BASE_URL`.
The preparation regression runs via `node tests/live-reply-preparation.browser.mjs`;
set `LIVE_REPLY_FIXTURE` to an external 5.108005-second fixture. It injects a 900 ms
state-publication delay and 3-second media load, checks head/tail, restoration,
pause/resume, skip/end, late join and loading beyond the preparation window.
No browser test creates a new avatar video or proves that a person heard it.

Optional real-probe backend tests use `LIVE_MEDIA_TEST_FIXTURE` (the external
4.365011-second fixture) and `LIVE_MEDIA_TEST_FFPROBE` (the executable path).
Without those variables, fixture-specific tests skip; synthetic validation and
error-path tests still run. Fixtures, raw logs and browser traces stay outside Git.

### Manual acceptance recorded on 2026-11-11

| Run | Send to first playing | Media duration | Result |
| --- | --- | --- | --- |
| Existing-video replay | 11.587 seconds | 5.108005 seconds | Started at zero, native end, complete audio confirmed, script resumed |
| Newly generated D-ID video | 73.6826 seconds | 2.971995 seconds | Started at 0.016199 seconds, native end, complete audio confirmed, script resumed |

The new-video run used Talk `tlk_q_D04gw8KszhnlNIfipSw`, with a matching final
`done` poll, measured duration and HTTP 200 callback with `applied=true`. It completed
within the configured 180-second callback deadline. Its export has 1925 evicted
events; this question's send/play/end/restore milestones are retained. The separate
replay export has no evicted events. Raw evidence is retained outside this repository.

The earlier provider timeout and Drive-metadata failure remain unsuccessful attempts.
The fresh success is **n=1**; it does not establish stable latency, all real error
routes, production readiness or completion of N01–N04. Automated provider/transport
tests and manual human-audio acceptance cover different parts of the integration.

### Local playlist listening acceptance on 2026-11-13

At commit `c4951f9`, one listening run used the real backend, frontend and SSE with
Make disabled and mock enabled. This records the log and listening confirmation
supplied by the user; it is not an agent-run listening test. The videos were already
available, and this was not a newly generated D-ID video run.

Alpha transitioned to Beta with the corresponding SKU change, and one question was
accepted with `SKU-BETA`. The user confirmed hearing the complete reply, no
overlapping audio and Beta continuing afterward. The log contains 45 events with
`droppedEvents=0`, no recorded playback errors or disconnections, and final session
status `ended`.

Send to first reply playing was **5.1109 seconds**, including the five-second shared
preparation window; this is not AI video-generation latency. The reply played from
0.012599 to 10.077007 seconds and ended naturally. Beta stopped on the client at
about 6.926 seconds and resumed at about 7.915 seconds according to the shared clock
and SSE. This does not establish seamless restoration of every spoken word.

The user ended the session manually before Beta finished. This run did not verify
automatic playlist exhaustion or draining multiple queued questions.
