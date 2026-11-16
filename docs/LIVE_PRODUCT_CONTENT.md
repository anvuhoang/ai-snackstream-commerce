# Live product and narration

The Simli admin accepts one product (SKU, name and verified public facts) per
session for narration preparation. Answer evidence is read separately from the web
catalog database, never from these entered facts or directly from Odoo.

## Admin workflow

1. Create an AI Host session using input-script narration. This makes no provider call.
2. Paste/edit a Vietnamese script prepared and reviewed outside the application.
   Maximum length is 2000 characters; 30-45 seconds is a writing suggestion, not
   a measured duration. There is no web endpoint for OpenAI script generation.
3. Click Confirm narration, then deliberately Create voice. ElevenLabs receives
   the exact confirmed script. No OpenAI/Gemini key is needed for this workflow.
4. Check measured duration, then deliberately start live and confirm usage.
   Any script edit invalidates prior audio and confirmation. Editing is locked
   after acquire/start. Ended sessions no longer display preparation controls.
   A new session starts with empty product/script input, not a previous SKU's script.

Product facts and narration are separate. Questions keep the SKU captured when
received, including through queue/retry. At dispatch, the backend resolves that
exact active variant using the catalog's published-product read rules and binds
the DB answer facts to the question. Later pin changes cannot change its SKU.
Narration edits still invalidate audio; pinning never changes the script/audio.

The current live service keeps session/product/script/PCM in process memory.
Backend restart loses that state. There is no script library, versioning,
upload manager or automatic fallback to configured sample audio.

## Audio and API

Set process environment `LIVE_CONTENT_ENABLED=true`, `ELEVENLABS_API_KEY`,
`ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`. These module-local settings do not
read a private .env file. See [Simli host](LIVE_SIMLI_HOST.md) for host settings.

ElevenLabs is requested with `wav_16000` and `language_code=vi`.
The result must be complete, non-silent, uncompressed mono PCM16 WAV at 16000 Hz,
1-90 seconds. Duration is measured from actual samples. Only validated PCM is
bound to the same session/product/script. Provider failures are explicit and
have finite I/O bounds, with no automatic retry or sample fallback.

Existing admin authentication/CSRF protects:
- GET /api/admin/live/{live_id}/content: product/script/readiness/duration, no secrets.
- PUT .../content/script with `{"script":"..."}`: save/clear manually; changed text
  invalidates audio atomically, identical text preserves it.
- POST .../content/audio with `{"script":"exact reviewed text"}`: deliberate TTS;
  stale review, busy work or started/ended sessions reject the request.
  An already saved matching audio result is idempotent.

The producer obtains PCM only through its lease-protected host routes.
Viewers receive the common broadcast, not PCM or provider credentials.
End/replacement during TTS discards a late result; an already sent provider task
cannot be recalled and may have consumed usage.

## Answer data and acceptance

Make receives `product.sku/name/facts`, `current_live_sku`, `question` and the
existing IDs/deadline. It must require matching SKU and answer only from supplied
facts, treating question/facts as data rather than instructions. Missing information
must not be invented or silently replaced with another catalog.
Facts include the exact variant price/weight and available description, verified
ingredients, storage, allergens, spice level and nutrition. Absent optional fields
are explicitly unknown, not claims of absence. No descriptive facts produces
`live_product_incomplete`; missing/hidden/inactive SKU produces `product_not_found`;
query failure produces `live_catalog_unavailable`. These fail the question and free
the queue without calling Make or falling back to session input/Sheets. DB I/O runs
in the existing dispatch worker, outside the live lock/event loop; the original
claim deadline still applies. The `product.sku/name/facts` wire shape is unchanged;
the current Make scenario needs no mapping change.

Admin pin choices come from catalog variants within the session's scheduled SKUs.
`POST /api/admin/live/{live_id}/pin` accepts `sku: null` to hide the card while retaining
the current question/narration SKU (`productPinned=false`). Repinning requires a
published, active catalog SKU. Simli remains bound to one audio SKU; playlist SKU
still follows its clock. Each playlist segment selects its own product card.
Viewers resolve `/api/live/products/{sku}` with the shop's stock/image presenter,
open `/products/{slug}`, and add the exact variant through the shared cart provider.
Out/unknown stock disables adding; the shared cart validates again on submission.
See [Make contract](LIVE_MAKE_PLAYBACK.md) for text and video callbacks.

The user confirmed a successful real one-product flow including narration, a new
answer and smooth restoration. This evidence was supplied by the user.
Automated tests use fake TTS/host transports; they do not establish voice quality
or provider closure. The catalog/pin/cart extension is tested with a test database
and fake providers. The user subsequently accepted the rectangular live layout,
smooth host picture/speech and pinned product display. The user reports the Make
configuration errors have been resolved. Database grounding is established by the
automated tests above, not an additional provider run by Codex. Cart integration
remains automatically checked, without a new user checkout acceptance. Odoo
synchronization, menu/checkout acceptance and full N01-N04 acceptance remain outside this work.
