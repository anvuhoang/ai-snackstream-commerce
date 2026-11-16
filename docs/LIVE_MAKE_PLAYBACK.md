# Live Make callbacks and playback

LiveService owns the session, question queue, received SKU and DB answer facts,
claim and callback idempotency. Make and prerecorded mock dispatch are mutually
exclusive. Legacy video/playlist playback and Simli host are separate opt-in paths.

## Settings and execution

Set LIVE_MAKE_ENABLED=true and LIVE_MOCK_ENABLED=false for Make, with private
LIVE_MAKE_WEBHOOK_URL and LIVE_MAKE_CALLBACK_TOKEN supplied server-side.
LIVE_MAKE_RESULT_TIMEOUT_SECONDS defaults to 180 seconds from claim
(`processing_started_at`), not webhook send time. Sending the webhook has its own
finite I/O timeout and runs outside the event loop; it does not extend the claim.

Use private `api/.env` when starting the API from `api`, the root private `.env`
for Docker Compose, or the deployment's API environment. Process values override
the file; restart the intended API before a session. See
[operator setup](LIVE_SIMLI_HOST.md) for dependencies, accounts and offline mode.

Configure the external scenario separately for each environment:

- Success text callback: `https://<backend-origin>/api/live/make-answer`.
- Every failed/skipped/timeout branch: `https://<backend-origin>/api/live/make-result`.
- Only the retained MP4 path uses `https://<backend-origin>/api/live/media-metadata`.

Use the API's deployed domain, or its public HTTPS tunnel during local work, not
the frontend URL or a different developer's backend. There is no fixed tunnel/port
or callback-base setting to copy from an acceptance launcher. The callback URL is
configured in Make; `LIVE_MAKE_WEBHOOK_URL` is the opposite, outbound direction.

Create a private random `LIVE_MAKE_CALLBACK_TOKEN` on the server (for example,
`python -c "import secrets; print(secrets.token_urlsafe(32))"` in a private terminal).
In Make's HTTP API-key connection, set placement **In the header**, parameter
**X-Live-Make-Token**, and value to that exact callback token, without `Bearer`.
Keep URL restrictions enabled and add the backend's **HTTPS origin only** to
Allowed service origins (no path/query). Check the connections used by **all**
terminal branches, not just the success callback. This secret is neither the
Simli/ElevenLabs API key nor Make's answer-generation connection credential.
Keep secrets out of exports, screenshots, frontend configuration and Git.

Select immediate webhook processing, inspect/clear only confirmed expired test
items, then enable the intended scenario before a deliberate paid run. Do not
retry old queue items to test configuration. The same callback token/origin must
be configured on any optional gateway, which is not required if Make reaches the
API directly. No scenario import, provider connection or deployment is performed
automatically by this repository.

Runtime starts when Make, mock or Simli is enabled and advances/expiries need no
viewer. With all three disabled there is no background worker: service reads/actions
refresh the shared video clock, and no question is dispatched.

## Outbound webhook

```json
{
  "session_id": "live-id",
  "question_id": "question-id",
  "question": "viewer question",
  "current_live_sku": "PRODUCT-01",
  "source": "web_live",
  "deadline_unix_ms": 0,
  "product": {"sku":"PRODUCT-01","name":"Product","facts":"Verified public facts"},
  "reply_format": "simli_audio"
}
```

The six existing fields remain; product is resolved from the web catalog for the
question's captured SKU before dispatch (never narration input). A missing/inactive/
hidden product or catalog query failure ends that question without sending Make;
there is no Sheets/session-facts fallback. See [answer data](LIVE_PRODUCT_CONTENT.md).
The product.sku/name/facts shape is unchanged. reply_format is included
only for Simli audio. deadline_unix_ms is an integer UTC Unix epoch millisecond
deadline, floored from the backend's exact claim-time deadline.
The illustrative value 0 is expired and must be filtered before provider work.

In Make use immediate webhook processing. Validate product, require
product.sku == current_live_sku and a valid supported intent, and check current
time < deadline before generation and after waits. Map question/product into
answer generation; do not fall back silently to Sheets or another catalog.
This repository does not deploy a Make scenario or manage its connections.
The accepted external scenario configuration must be set separately.

## Simli audio success path (accepted current integration)

Requires LIVE_SIMLI_REPLY_AUDIO_ENABLED=true and LIVE_CONTENT_ENABLED=true.
Make generates answer text and sends:
```http
POST /api/live/make-answer
X-Live-Make-Token: <private callback secret>
Content-Type: application/json
```
```json
{"liveId":"live-id","questionId":"question-id","sku":"PRODUCT-01","replyText":"Answer from supplied facts."}
```

Map replyText from the existing answer module's result. Use Make's structured
JSON body, or correctly escape strings in JSON-string mode. Bypass Make TTS,
D-ID, Drive and render polling for this path. The same HTTP connection must allow
the current backend HTTPS origin and send the callback token under the header
above, without a Bearer prefix. Do not reuse a provider credential.

First valid text admission returns received=true, applied=true, reason=processing.
Backend ElevenLabs TTS runs outside the live lock; measured valid PCM then becomes
ready via SSE with replyKind=simli_audio and audioDurationSeconds.
Only the current producer can retrieve that reply PCM with its valid lease.
The reply and narration use the same Simli session/mixer/broadcast.
This path does not create or play a D-ID reply video.

## Retained video success path

For video/playlist or Simli with audio replies disabled, keep:
```json
{"liveId":"live-id","questionId":"question-id","sku":"PRODUCT-01","status":"ready","replyText":"Answer","videoUrl":"https://media.example/reply.mp4","durationSeconds":5.108005}
```
POST to /api/live/make-result with X-Live-Make-Token. Duration must come from
the actual video (finite, positive, at most 300 seconds); never infer it from text
or the duration of a different fixture. Video URL must be HTTPS without credentials.

If provider metadata is unavailable, POST downloaded raw MP4 bytes to
/api/live/media-metadata with Content-Type video/mp4 and the same token.
A configured LIVE_FFPROBE_PATH or ffprobe on PATH is required. The bounded upload
is probed outside the event loop with a subprocess timeout and temporary-file cleanup.
It returns {"durationSeconds": <number>}; send that number in the ready callback.
This is the retained download -> measure -> ready mapping; no provider field
name for duration is assumed. The standalone callback gateway must support the
chosen endpoints; /make-answer requires routing to this backend.

## Terminal, expiry and duplicate rules

POST failed/skipped to /api/live/make-result with IDs, snapshot SKU, status and
errorCode, without video/duration:
unsupported intent -> skipped/unsupported_intent;
missing product -> skipped/product_not_found;
generation/TTS/render failure -> failed/generation_failed;
polling/generation timeout -> failed/generation_timeout.

Backend validates token, mode, session, question/slot, SKU and metadata.
At now >= claim deadline, an unsaved result is refused under the same lock that
expires the question/releases its slot, even before a runtime tick.
A result accepted before deadline remains idempotent afterwards; duplicates do not
repeat TTS/playback or alter the next question. Conflicting callbacks are refused.
Invalid metadata returns 422; corrected data may be submitted before deadline.
It cannot revive the question after deadline or after end/skip.

Releasing a queue slot does not cancel an already running Make/provider task.
An old scenario's 30 repetitions x 10-second Sleep already exceed 180 seconds
before other processing; this is not a measured end-to-end budget.
Do not raise backend deadlines without reconciling the actual scenario.
Simli's independent 90-second host cap includes startup and is not extended by
a 180-second Make deadline. Ask early enough to fit answer/TTS/restore.

## Video compatibility and acceptance

Video playlists support ordered product segments and shared server time.
Questions keep the SKU received at submission. Reply/skip restores the saved
segment and position with bounded preparation; pause/resume and late join follow
the shared clock. At playlist completion new questions stop, accepted work drains
and the session ends without cutting a currently playing reply.
Legacy sessions without a playlist retain configured demo-video looping.

User-provided listening evidence covers local playlist switching/reply restoration
and the current one-product Simli flow with a newly generated answer and smooth
restoration. The current Simli acceptance used text -> backend TTS -> Simli audio,
not D-ID. Earlier video-generation acceptance is historical evidence for the
separate video path, not evidence for every current integration point.
The user subsequently accepted the live layout, smooth host picture/speech and
pinned product display. Database grounding/shared-cart integration are checked
automatically with a test database and fake providers; no new human checkout or
Odoo synchronization acceptance is implied. Production broadcasting and full
N01-N04 completion have not been established. Automated tests use fake providers;
no claim of provider closure follows from SDK disconnect/local cleanup.
