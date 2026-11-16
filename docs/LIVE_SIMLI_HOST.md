# AI host Simli

Simli is opt-in inside the existing live admin and viewer. The normal path is
one product per session: paste a reviewed script, create ElevenLabs narration,
start Simli, receive a Make answer, speak the answer through the **same Simli
session**, restore narration, then end. This path does not render D-ID video.

## Configure and run

Requires Python 3.12+, uv and Node 22+; dependencies are locked in `api/uv.lock`
and `web/package-lock.json`. Use the existing database/auth/catalog, not an
acceptance database or a shared admin account. Never commit credentials or media.

### Normal checkout

1. In `api`, copy `.env.example` to `.env` **only when the file does not exist**.
   Set `DATABASE_URL` to the intended database and a private `SECRET_KEY`.
   Empty `DATABASE_URL` uses local SQLite for a first offline check; deployment
   uses PostgreSQL. Leave unrelated integrations disabled for that check.
2. From `api`, run `uv sync --frozen`, then `uv run python -m app.cli migrate`.
   For an isolated test database only, `uv run python -m app.cli seed-catalog`
   supplies labelled demo products, including `KG-LC-250`. Real operation requires
   published active variants with usable public facts and current stock in the web
   catalog; live does not query Odoo or import a personal database.
3. Create each operator with `uv run python -m app.cli create-admin operator@example.com`.
   It prompts for that person's password. Repeat with another email for another
   admin. `BOOTSTRAP_ADMIN_*` creates only the first admin, not additional accounts.
4. From `api`, run `uv run uvicorn app.main:app --host 127.0.0.1 --port 8000`.
   From `web`, run `npm ci`, put `API_URL=http://127.0.0.1:8000` in private
   `.env.local`, then `npm run build` and `npm run start` (or `npm run dev`).
   Choose unused ports and change `API_URL` accordingly for a parallel instance.
5. Check backend `/api/readyz` returns `ok=true`, `database=up`; sign into the
   web `/admin` with the operator's own account, then open `/admin/live` and `/live`.
   The web proxies API requests, preserving the existing cookie and CSRF flow.

API settings, including narration/TTS, read `.env` relative to the **API working
directory**, with process/deployment environment taking precedence. No private
launcher or `providers.json` is needed. Restart only the intended API after changing
configuration, before creating a session; cached settings do not reload during live.

### Real narration and answers

Set these in the API's private `.env` or deployment environment:

```dotenv
LIVE_SIMLI_ENABLED=true
LIVE_SIMLI_TRANSPORT=simli
LIVE_SIMLI_API_KEY=<server secret>
LIVE_CONTENT_ENABLED=true
LIVE_SIMLI_REPLY_AUDIO_ENABLED=true
ELEVENLABS_API_KEY=<server secret>
ELEVENLABS_VOICE_ID=<Vietnamese-compatible voice>
ELEVENLABS_MODEL_ID=<configured TTS model>
LIVE_MAKE_ENABLED=true
LIVE_MOCK_ENABLED=false
LIVE_MAKE_WEBHOOK_URL=<private webhook>
LIVE_MAKE_CALLBACK_TOKEN=<private callback secret>
```

See [product content](LIVE_PRODUCT_CONTENT.md)
and [Make callbacks](LIVE_MAKE_PLAYBACK.md). No OpenAI/Gemini key is needed by the web
backend; Make manages its own answer-generation connection.

The reviewed-script -> ElevenLabs -> same-session Simli answer path requires
neither ffprobe nor an external sample PCM/MP4. There is no sample-audio fallback.
Create script/audio and start are deliberate paid-service actions; opening/F5 a
page does not issue a Simli token. Check provider allowance before starting.

### No-charge local check

Use the normal configuration above with the following overrides. All provider
keys, webhook and callback token must be blank. This uses synthetic/configured
audio, not TTS or a meaningful answer:

```dotenv
LIVE_SIMLI_ENABLED=true
LIVE_SIMLI_TRANSPORT=mock
LIVE_CONTENT_ENABLED=false
LIVE_SIMLI_REPLY_AUDIO_ENABLED=true
LIVE_MAKE_ENABLED=false
LIVE_MOCK_ENABLED=true
LIVE_SIMLI_AUDIO_SKU=KG-LC-250
LIVE_SIMLI_AUDIO_PATH=<absolute path to your narration.pcm>
LIVE_SIMLI_MOCK_REPLY_WAV_PATH=<absolute path to your reply.wav>
```

Supply non-silent PCM16 LE mono 16 kHz narration and PCM16 mono 16 kHz WAV reply,
each 1-90 seconds. To make disposable fixtures without a download/provider/helper,
run this from `api` with `uv run python -c` and the quoted code below (or paste
the code into `uv run python`); it prints only the generated temporary directory:

```python
import math, random, struct, tempfile, wave
from pathlib import Path
folder = Path(tempfile.mkdtemp(prefix="live-offline-"))
rng = random.Random(7)
levels = [rng.uniform(0.1, 0.8) for _ in range(30 * 50)]
pcm = b"".join(struct.pack("<h", round(10000 * levels[i // 320] * math.sin(2 * math.pi * 220 * i / 16000))) for i in range(16000 * 30))
(folder / "narration.pcm").write_bytes(pcm)
with wave.open(str(folder / "reply.wav"), "wb") as wav:
    wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
    wav.writeframes(pcm[:16000 * 2 * 3])
print(folder)
```

Choose configured-file narration for the matching SKU. Start explicitly, send a
question early, observe mock reply/restoration, then end. These tones check routing,
not Vietnamese speech or lip quality. Test coverage also exercises the input-script
and TTS pipeline with a fake HTTP transport, without introducing a fake TTS mode
into production. Do not enable Make and mock simultaneously.

### Team deployment

Follow [deployment](DEPLOY.md) for the existing API/web/database setup. Docker
Compose now forwards the optional live variables from the root private `.env`
to **API only**; all modes default off. Run `docker compose run --rm api python
-m app.cli create-admin operator@example.com` for each operator. Optional fixture
paths are container paths and need an explicit private mount; they are not needed
for real script/TTS operation. Do not copy `.env` into an image or the web bundle.

Set the deployed web `API_URL` to its API. Use HTTPS for producer and viewers
(loopback is the browser's local exception); plain LAN HTTP does not provide the
secure browser context required by AudioWorklet/WebRTC. Keep **one API process /
worker / instance**, since session, lease, script, PCM and queue are in memory.
Restarts, sleeping services and load balancing across instances interrupt live.
The hosting proxy must preserve SSE; platform stream time limits still apply.
No Docker, PostgreSQL deployment or physical cross-machine broadcast is certified
by the SQLite/provider-fake checks for this handoff.

In /admin/live select AI Host and input-script narration, enter product information,
create the session, paste and confirm the script, then create the voice.
Start live deliberately and confirm the usage prompt. Viewers use /live and may need
to click to enable sound. Page load/F5 never starts a provider session.

Simli SDK is pinned to 3.2.0. The preset is
`bf13113a-355a-4d97-8b90-4edccd1da7b2`, framing 768 x 768, contain.
The provider key stays on the backend; only the authenticated producer can obtain
a session token. Valid decoded video can establish readiness in a hidden tab;
this is not a claim that a human has heard audio.

## Playback and safety

- One producer owns a lease, coordinator, mixer and broadcast. Up to two viewers
  receive that one mixed output over local WebRTC; viewers never create SimliClient.
  Current peer connections have no STUN/TURN configuration, so cross-network
  broadcasting and production scaling are not established. HTTPS alone does not
  resolve NAT traversal; test the actual producer/viewer networks before deployment.
- The same-origin proxy bounds only the new host POST JSON routes before
  buffering: 4096 bytes for commands, 604096 for SDP offer/answer (100000
  characters at worst-case JSON escaping plus bounded IDs/overhead).
  Declared or streamed overflow returns 413; other routes keep streaming.
- Host cap is 90 seconds including startup; startup limit is 20 seconds.
  Heartbeat runs every 750 ms, lease is 6 seconds, slot hold is 120 seconds from
  acquire even after cleanup. No automatic new token/session is issued on error.
- Admin permissions use the logged-in user's ID, never an acceptance email/account.
  A second admin can create/operate a new session after end and slot release, but
  cannot acquire/control the running producer with another login, client or lease.
  Existing admin end/skip/pin permissions are unchanged; staff/anonymous cannot
  operate the host. Keep the producer browser open, connected and its device awake.
- Queue, captured question SKU, DB answer facts, callback deadline and idempotency stay in LiveService.
  Simli position comes from observed decoded audio, never the amount of PCM sent.
- Replies use a muted 1.2-second matchable narration prefix plus 0.3 seconds silence
  before answer PCM. The exclusive output opens only after valid alignment.
  EOF detection also matches decoded quiet against an analysis-only reference tail;
  that tail is not sent as extra audio. Missing/ambiguous evidence still times out.
- Restore uses the saved narration position, 1.2-second muted preroll, a 200 ms replay
  guard and at most one existing 500 ms rewind retry. Exact word-level continuity
  on every device is not guaranteed. Audio sources are never deliberately summed.
- Skip, end, lost lease/connection and late events cannot restart a stopped host.
  EOF stops accepting new questions and drains accepted work within the 90-second cap.
  Pause/resume is currently available for video/playlist, not Simli.
- SDK disconnect/local cleanup is not proof of provider-side session closure.

For offline checks set Make off, mock on, Simli transport=mock and provider
credentials/webhook blank. Use external PCM/WAV/MP4 fixtures:
`LIVE_SIMLI_MOCK_REPLY_WAV_PATH` for same-session audio replies;
`LIVE_SIMLI_MOCK_VIDEO_PATH` for the retained MP4 path.
The configured-file alternative uses `LIVE_SIMLI_AUDIO_PATH` (PCM16 LE, mono,
16 kHz, 1-90 seconds) and `LIVE_SIMLI_AUDIO_SKU`; SKU must match exactly.
The normal product-backed flow does not require or fall back to that file.
The output AudioWorklet in web/public/live is a runtime asset and must ship.

Common setup failures: content unavailable means check `LIVE_CONTENT_ENABLED`
and all three ElevenLabs values in the **running API**; audio/SKU mismatch means
prepare narration for the session's exact single SKU. A reserved slot requires
waiting until 120 seconds from the previous acquire, not changing accounts to
bypass it. For Make connection-origin errors check every callback's HTTPS origin
and header in [Make callbacks](LIVE_MAKE_PLAYBACK.md). A 180-second callback budget
does not extend the 90-second host cap: ask early enough for generation/TTS/restore.

## Acceptance and remaining scope

For the operational handoff, the user confirmed the admin/viewer mock flow worked
normally on two separate browser profiles on the same machine, using a distinct
admin account, normal `.env` configuration and existing local audio. This was a
no-charge mock check, not a new real-provider run, Docker/PostgreSQL deployment,
cross-machine test or Internet/NAT traversal acceptance.

The user reported a successful real run: reviewed external script -> generated
narration -> smooth Simli picture/speech -> new question and correct real answer ->
smooth narration restoration. This is user-supplied listening/viewing evidence for
one product per session, not an automated acoustic test or stability/load guarantee.
The accepted reply used Make text + backend ElevenLabs PCM + the existing Simli
session; D-ID video is a separate retained compatibility path.

Automated tests use fake providers/local media and cover lifecycle, permissions,
queue, late/duplicate events, byte limits, reply/restore, legacy video and UI guards.
Database-grounded answers and catalog pin/cart are extensions checked with fake
providers; they are separate from that user acceptance. Odoo synchronization,
menu/checkout acceptance, broad-network broadcasting and N01-N04 completion
have not been established by this work. See [product content](LIVE_PRODUCT_CONTENT.md).
