# AI host Simli

Simli is opt-in inside the existing live admin and viewer. The normal path is
one product per session: paste a reviewed script, create ElevenLabs narration,
start Simli, receive a Make answer, speak the answer through the **same Simli
session**, restore narration, then end. This path does not render D-ID video.

## Configure and run

Use server-side process/deployment configuration; never commit credentials or media.

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

Content settings read process environment only. See [product content](LIVE_PRODUCT_CONTENT.md)
and [Make callbacks](LIVE_MAKE_PLAYBACK.md). No OpenAI/Gemini key is needed by the web
backend; Make manages its own answer-generation connection.

Run API dependencies with `uv sync --frozen` in `api`, migrate the intended database
with `uv run python -m app.cli migrate`, then run `uv run uvicorn app.main:app`.
In `web`, run `npm ci`, set `API_URL` to that backend, then build/start or use the
project development workflow. Use the repository's existing admin login and CSRF.
Do not point a test instance at another developer's database.

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
  broadcasting and production scaling are not established.
- The same-origin proxy bounds only the new host POST JSON routes before
  buffering: 4096 bytes for commands, 604096 for SDP offer/answer (100000
  characters at worst-case JSON escaping plus bounded IDs/overhead).
  Declared or streamed overflow returns 413; other routes keep streaming.
- Host cap is 90 seconds including startup; startup limit is 20 seconds.
  Heartbeat runs every 750 ms, lease is 6 seconds, slot hold is 120 seconds from
  acquire even after cleanup. No automatic new token/session is issued on error.
- Queue, SKU/product snapshots, callback deadline and idempotency stay in LiveService.
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

## Acceptance and remaining scope

The user reported a successful real run: reviewed external script -> generated
narration -> smooth Simli picture/speech -> new question and correct real answer ->
smooth narration restoration. This is user-supplied listening/viewing evidence for
one product per session, not an automated acoustic test or stability/load guarantee.
The accepted reply used Make text + backend ElevenLabs PCM + the existing Simli
session; D-ID video is a separate retained compatibility path.

Automated tests use fake providers/local media and cover lifecycle, permissions,
queue, late/duplicate events, byte limits, reply/restore, legacy video and UI guards.
Odoo product input, product-pin/menu/cart integration in Simli, broad-network
broadcasting and N01-N04 completion have not been accepted.
