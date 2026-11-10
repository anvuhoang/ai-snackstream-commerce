# Live integration checkpoint — 2026-11-11

Branch: `feat/live-playback-log`.

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

Ruff, the full pytest suite, TypeScript typecheck and targeted frontend ESLint checks
passed during implementation. Backend tests cover duplicate/concurrent operations,
FIFO processing, original SKU preservation, pause accounting, exact script-position
restoration, skip/end handling, mode isolation and task lifecycle. A local TCP check
also observed two SSE connections receiving the same reply playback ID, then the
restored script. This transport check did not test browser media playback.

The following results were reported by the user on 2026-11-11; new browser JSON logs or
screen recordings have not been attached to this checkpoint:

| Manual case | Reported result |
| --- | --- |
| Script → prerecorded reply → script in Chrome and Edge | Passed; picture/audio and automatic transitions, without re-enabling playback |
| Pause during reply, wait at least 12 seconds, resume | Passed; no completion while paused, remaining playback then script resumes |
| Queue A and B, skip A during playback | Passed; A skipped, B processed, final return to script, no overlapping replies within one browser |
| Reopen Edge during a reply | Passed; joins the current reply position and returns to script with Chrome, without adding a question |

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
- Real Make results do not yet provide verified reply duration metadata. The current automatic
  playback runtime and `start_ready_reply` are intentionally limited to prerecorded mock replies.
  Switching environment flags alone does not complete real generated-reply playback.
- Add and test callbacks for Make branches that currently stop without a result, including
  unsupported intent, missing product rows, render failure and polling timeout.
- Finish shared catalog/script integration and any remaining admin/comment controls against
  the agreed project requirements.
- Implement the agreed persistent event/answer logs and measure viewer-side send-to-audible-answer
  latency. Server status `answered` reflects the shared playback timeline, not proof that a
  particular viewer heard the answer.
- Sessions and questions currently live in API memory. Use one API worker; restarting loses
  this state. Durable storage and migrations require coordination with An.

This checkpoint is part of the live module. It does not complete N01–N04 or establish
final acceptance of the whole module.
