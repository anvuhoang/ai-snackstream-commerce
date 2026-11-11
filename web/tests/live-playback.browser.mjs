// Browser regression against a running local web server, using the real MP4 and
// mocked SSE/question transport. No Make, D-ID, catalog, or paid calls are made.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.LIVE_TEST_BASE_URL ?? "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname), "Local server required");
const executable = process.env.LIVE_TEST_BROWSER
  ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "snackstream-live-browser-"));
const browser = spawn(executable, [
  "--headless=new", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank",
], { windowsHide: true, stdio: "ignore" });
let launchError;
browser.on("error", (error) => { launchError = error; });
const sockets = [];

async function until(action, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}

const injection = `
  window.streams = [];
  window.requests = [];
  window.deliveryMode = 'success';
  window.mediaEvents = [];
  window.downloadedLog = null;
  const originalFetch = window.fetch.bind(window);
  window.EventSource = class extends EventTarget {
    constructor(url) { super(); if (url !== '/api/live/events') throw new Error('Unexpected SSE'); window.streams.push(this); }
    close() { window.streams = window.streams.filter(item => item !== this); }
  };
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === 'POST' && /\\/api\\/live\\/[^/]+\\/questions$/.test(new URL(request.url).pathname)) {
      const body = await request.json();
      window.requests.push(body);
      if (window.deliveryMode === 'lost') throw new TypeError('Simulated uncertain delivery');
      const status = window.deliveryMode === 'server_error' ? 503 : window.deliveryMode === 'rejected' ? 429 : 200;
      return new Response(JSON.stringify(status === 200 ? {
        ...body, sku: 'BT-XIKE-01', status: 'queued', receivedAt: new Date().toISOString(),
        liveId: 'browser-live-001', isDemo: true, source: 'web_live',
      } : {error: {code: 'live_queue_full', message: 'Test rejection'}}), {
        status, headers: {'Content-Type': 'application/json'},
      });
    }
    return originalFetch(input, init);
  };
  for (const name of ['playing', 'pause', 'ended', 'seeked']) {
    document.addEventListener(name, event => {
      if (event.target instanceof HTMLVideoElement) window.mediaEvents.push({
        event: name, position: event.target.currentTime, loop: event.target.loop,
      });
    }, true);
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[download]');
    if (!link) return;
    event.preventDefault();
    window.downloadedLog = null;
    originalFetch(link.href).then(response => response.json()).then(log => window.downloadedLog = log);
  });
`;

async function page(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const response = JSON.parse(data);
    if (response.method === "Fetch.requestPaused") {
      // Substitute media locally before any request reaches the synthetic provider.
      void command("Fetch.continueRequest", {
        requestId: response.params.requestId, url: `${baseUrl}/live-demo/avatar.mp4`,
      }).catch((error) => { console.error(error); process.exitCode = 1; });
    }
    const request = pending.get(response.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(response.id);
      if (response.error) request.reject(new Error(JSON.stringify(response.error)));
      else request.resolve(response.result);
    }
  };
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const next = ++id;
      const timer = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(next, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: next, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await command("Page.enable");
  await command("Fetch.enable", { patterns: [{ urlPattern: "https://provider.example.invalid/*" }] });
  await command("Page.addScriptToEvaluateOnNewDocument", { source: injection });
  await command("Page.navigate", { url: `${baseUrl}/live` });
  await until(() => evaluate("window.streams?.length > 0"), "viewer subscribes to SSE");
  return {
    evaluate,
    emit: (snapshot) => evaluate(`window.streams.forEach(stream => stream.dispatchEvent(new MessageEvent('state', {data: ${JSON.stringify(JSON.stringify(snapshot))}})))`),
    click: (text) => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('Button missing/disabled'); button.click(); })()`),
    ready: () => until(() => evaluate("document.querySelector('video')?.readyState >= 2"), "actual media ready"),
    playing: () => until(() => evaluate("!!document.querySelector('video') && !document.querySelector('video').paused && !document.querySelector('video').seeking"), "actual media playing"),
    log: async () => {
      await evaluate("window.downloadedLog = null");
      await evaluate("[...document.querySelectorAll('button')].find(item => item.textContent === 'Tải log JSON').click()");
      return until(() => evaluate("window.downloadedLog"), "diagnostic JSON download");
    },
  };
}

const duration = 10.077007;
function state(kind = "script", options = {}) {
  const now = Date.now();
  const {
    id = `${kind}-${crypto.randomUUID()}`, elapsed = 0, status = "playing", questions = [],
    mediaSource = "prerecorded", videoUrl = "/live-demo/avatar.mp4",
  } = options;
  return {
    serverTime: new Date(now).toISOString(),
    session: {
      liveId: "browser-live-001", title: "Browser playback regression", isDemo: true,
      scheduledSkus: ["BT-XIKE-01", "KG-LC-250"], pinnedSku: "KG-LC-250", status, questions,
      playback: status === "ended" ? null : {
        playbackId: id, videoUrl, kind, mediaSource,
        questionId: kind === "reply" ? questions.at(-1)?.questionId : null,
        durationSeconds: kind === "reply" ? duration : null,
        startedAt: new Date(now - elapsed * 1000).toISOString(),
        pausedAt: status === "paused" ? new Date(now).toISOString() : null,
      },
    },
  };
}
const question = (id, status = "answering") => ({
  questionId: id, liveId: "browser-live-001", text: "Playback regression question",
  sku: "BT-XIKE-01", status, receivedAt: new Date().toISOString(),
  mediaSource: "prerecorded", isDemo: true, source: "web_live",
});
async function fill(viewer, text) {
  await viewer.evaluate(`(() => {
    const field = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
}
async function check(name, action) {
  await action();
  console.log(`PASS ${name}`);
}

try {
  const port = await until(async () => {
    if (launchError) throw launchError;
    try { return Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); }
    catch { return false; }
  }, "headless browser starts");
  const a = await page(port);
  await check("disabled player and paused controls", async () => {
    await a.emit(state("script", { status: "paused", elapsed: 3 }));
    await a.ready();
    assert.equal(await a.evaluate("document.querySelector('video').paused"), true);
    assert.equal(await a.evaluate("[...document.querySelectorAll('button')].find(item => item.textContent === 'Bật hình và tiếng').disabled"), true);
    await a.emit(state());
    await a.ready();
    assert.equal(await a.evaluate("document.querySelector('video').paused"), true);
    await a.click("Bật hình và tiếng");
    await a.playing();
  });

  let qid;
  await check("lost delivery and retry reuse question ID and original send", async () => {
    await a.evaluate("window.deliveryMode = 'lost'");
    await fill(a, "Question with uncertain delivery");
    await a.click("Gửi câu hỏi");
    await until(() => a.evaluate("document.querySelector('[role=alert]')?.textContent.includes('Chưa xác nhận')"), "uncertain delivery message");
    qid = await a.evaluate("window.requests[0].questionId");
    await a.evaluate("window.deliveryMode = 'success'");
    await a.click("Gửi câu hỏi");
    await until(() => a.evaluate("document.querySelector('textarea').value === ''"), "acknowledgement");
    assert.equal(await a.evaluate("window.requests[1].questionId"), qid);
  });

  await check("5xx retry keeps ID; 4xx rejection releases ID; concurrent submit is guarded", async () => {
    const start = await a.evaluate("window.requests.length");
    await a.evaluate("window.deliveryMode = 'server_error'");
    await fill(a, "Question with HTTP failure");
    await a.click("Gửi câu hỏi");
    await until(() => a.evaluate("document.querySelector('[role=alert]')?.textContent.includes('Chưa xác nhận')"), "5xx unknown delivery");
    const retryId = await a.evaluate(`window.requests[${start}].questionId`);
    await a.evaluate("window.deliveryMode = 'rejected'; document.querySelector('form').dispatchEvent(new Event('submit', {bubbles:true,cancelable:true})); document.querySelector('form').dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}))");
    await until(() => a.evaluate("!!document.querySelector('[role=alert]') && !document.querySelector('fieldset').disabled"), "4xx rejection");
    assert.equal(await a.evaluate("window.requests.length"), start + 2);
    assert.equal(await a.evaluate(`window.requests[${start + 1}].questionId`), retryId);
    await a.evaluate("window.deliveryMode = 'success'");
    await a.click("Gửi câu hỏi");
    await until(() => a.evaluate("document.querySelector('textarea').value === ''"), "new request accepted");
    assert.notEqual(await a.evaluate(`window.requests[${start + 2}].questionId`), retryId);
    const item = (await a.log()).questionSummaries.find(item => item.questionId === retryId);
    assert.deepEqual(item.requestObservations.map(item => item.event), ["live_question_delivery_unknown", "live_question_rejected"]);
    assert.equal(item.sendToFirstReplyPlaybackMs, null);
  });

  let reply;
  await check("sub-750ms initial seek and two viewers playing the same reply", async () => {
    reply = state("reply", { elapsed: 0.3, questions: [question(qid)] });
    await a.emit(reply);
    await a.ready();
    await a.playing();
    assert.ok(await a.evaluate("document.querySelector('video').currentTime >= 0.29"));
    const b = await page(port);
    await b.emit({ ...reply, serverTime: new Date().toISOString() });
    await b.ready();
    await b.click("Bật hình và tiếng");
    await b.playing();
    const [logA, logB] = await Promise.all([a.log(), b.log()]);
    const summaryA = logA.questionSummaries.find(item => item.questionId === qid);
    const summaryB = logB.questionSummaries.find(item => item.questionId === qid);
    assert.ok(summaryA.sendToFirstReplyPlaybackMs > 0);
    assert.equal(summaryA.attemptsObserved, 2);
    assert.equal(summaryA.sku, "BT-XIKE-01");
    assert.equal(summaryB.sendToFirstReplyPlaybackMs, null);
    assert.match(summaryB.unknownReason, /absent/);
    assert.equal(summaryA.firstReplyPlayback.playbackId, summaryB.firstReplyPlayback.playbackId);
    assert.notEqual(logA.sessionId, logB.sessionId);
    await b.emit(state("script", { status: "ended", questions: [question(qid, "skipped")] }));
    await until(() => b.evaluate("document.querySelector('video') === null"), "second viewer ends");
  });

  await check("reply pause/resume freezes media without a second answer measurement", async () => {
    const paused = structuredClone(reply);
    paused.session.status = "paused";
    paused.session.playback.pausedAt = new Date(Date.parse(reply.session.playback.startedAt) + 3000).toISOString();
    await a.emit(paused);
    await until(() => a.evaluate("document.querySelector('video').paused && !document.querySelector('video').seeking"), "reply paused");
    const before = await a.evaluate("document.querySelector('video').currentTime");
    await delay(200);
    assert.equal(await a.evaluate("document.querySelector('video').currentTime"), before);
    reply = state("reply", { id: reply.session.playback.playbackId, elapsed: 3, questions: [question(qid)] });
    await a.emit(reply);
    await a.playing();
    const result = (await a.log()).questionSummaries.find(item => item.questionId === qid);
    assert.equal(result.playbacks.length, 1);
    assert.ok(result.playbacks[0].playingEvents >= 2);
  });

  await check("normal deadline preserves final tail and never overlaps players", async () => {
    await a.evaluate("window.oldVideo = document.querySelector('video'); oldVideo.currentTime = oldVideo.duration - 0.5");
    await until(() => a.evaluate("!oldVideo.seeking && !oldVideo.paused"), "seek near reply end");
    await a.emit(state("script", { questions: [question(qid, "answered")] }));
    assert.equal(await a.evaluate("document.querySelector('video') === oldVideo"), true);
    await until(() => a.evaluate("document.querySelector('video') !== oldVideo"), "native end releases next player");
    assert.equal(await a.evaluate("oldVideo.ended && oldVideo.paused && document.querySelectorAll('video').length === 1"), true);
    const released = (await a.log()).events.find(item => item.event === "live_playback_released" && item.playbackId === reply.session.playback.playbackId);
    assert.equal(released.details.reason, "native_ended");
  });

  await check("skip near end immediately replaces reply and stops old audio", async () => {
    const nextQ = "browser-skip-question";
    await a.emit(state("reply", { questions: [question(nextQ)], elapsed: 9.6 }));
    await a.ready();
    await a.playing();
    await a.evaluate("void (window.skippedVideo = document.querySelector('video'))");
    await a.emit(state("script", { questions: [question(nextQ, "skipped")] }));
    await until(() => a.evaluate("document.querySelector('video') !== skippedVideo"), "skip replaces player");
    assert.equal(await a.evaluate("skippedVideo.paused"), true);
  });

  await check("stalled final tail is bounded and releases a queued next reply", async () => {
    const oldQ = "browser-tail-timeout";
    const nextQ = "browser-tail-next";
    await a.emit(state("reply", { elapsed: 9.5, questions: [question(oldQ)] }));
    await a.ready();
    await a.playing();
    await a.evaluate("window.stalledVideo = document.querySelector('video'); stalledVideo.playbackRate = 0.0625");
    const next = state("reply", { questions: [question(oldQ, "answered"), question(nextQ)] });
    await a.emit(next);
    assert.equal(await a.evaluate("document.querySelector('video') === stalledVideo"), true);
    await until(() => a.evaluate("document.querySelector('video') !== stalledVideo"), "tail timeout releases queued reply", 2000);
    assert.equal(await a.evaluate("stalledVideo.paused"), true);
    await a.ready();
    await a.playing();
    const log = await a.log();
    assert.ok(log.events.some(item => item.event === "live_playback_released"
      && item.questionId === oldQ && item.details.reason === "tail_timeout"));
    assert.ok(log.questionSummaries.find(item => item.questionId === nextQ).firstReplyPlayback);
  });

  await check("pause and end interrupt an active tail immediately", async () => {
    for (const status of ["paused", "ended"]) {
      const q = `browser-tail-${status}`;
      await a.emit(state("reply", { elapsed: 9.5, questions: [question(q)] }));
      await a.ready();
      await a.playing();
      await a.evaluate("window.interruptedVideo = document.querySelector('video'); interruptedVideo.playbackRate = 0.0625");
      const next = state("script", { questions: [question(q, "answered")] });
      await a.emit(next);
      assert.equal(await a.evaluate("document.querySelector('video') === interruptedVideo"), true);
      const stop = structuredClone(next);
      stop.session.status = status;
      if (status === "paused") stop.session.playback.pausedAt = stop.serverTime;
      else stop.session.playback = null;
      await a.emit(stop);
      await until(() => a.evaluate("document.querySelector('video') !== interruptedVideo"), `tail interrupted by ${status}`);
      assert.equal(await a.evaluate("interruptedVideo.paused && !interruptedVideo.ended"), true);
    }
  });

  await check("disconnect pauses media and reconnect is labelled as a snapshot", async () => {
    await a.emit(state("reply", { questions: [question("browser-tail-next")] }));
    await a.ready();
    await a.playing();
    await a.evaluate("window.streams.forEach(stream => stream.onerror())");
    await until(() => a.evaluate("document.querySelector('video').paused"), "disconnect pauses");
    const reconnect = state("reply", { questions: [question("browser-tail-next")] });
    await a.emit(reconnect);
    await a.ready();
    await a.playing();
    const result = (await a.log()).questionSummaries.find(item => item.questionId === "browser-tail-next");
    assert.equal(result.serverObservations.at(-1).details.observation, "snapshot");
  });

  await check("expired late reply is not replayed; first terminal snapshot remains observation", async () => {
    const late = state("reply", { elapsed: 20, questions: [question("browser-expired-question")] });
    await a.emit(late);
    await a.ready();
    assert.equal(await a.evaluate("document.querySelector('video').paused"), true);
    const result = (await a.log()).questionSummaries.find(item => item.questionId === "browser-expired-question");
    assert.equal(result.firstReplyPlayback, null);
    await a.emit(state("script", { status: "ended", questions: [question("terminal-first-snapshot", "answered")] }));
    await until(() => a.evaluate("document.querySelector('video') === null"), "session end removes media");
    const terminal = (await a.log()).questionSummaries.find(item => item.questionId === "terminal-first-snapshot");
    assert.equal(terminal.serverObservations[0].details.observation, "snapshot");
    assert.equal(terminal.sendToFirstReplyPlaybackMs, null);
  });
  await check("Make reply label, HTTPS source, duplicate snapshot, late join and diagnostics", async () => {
    const q = { ...question("browser-make-reply"), mediaSource: "make" };
    const make = state("reply", {
      elapsed: 0.3, questions: [q], mediaSource: "make",
      videoUrl: "https://provider.example.invalid/reply.mp4",
    });
    await a.emit(make);
    await a.ready();
    await a.playing();
    assert.equal(await a.evaluate("document.querySelector('video').src"), make.session.playback.videoUrl);
    assert.ok(await a.evaluate("document.body.textContent.includes('Video trả lời qua Make.')"));
    assert.equal(await a.evaluate("document.querySelector('video').loop"), false);
    await a.evaluate("void (window.makeVideo = document.querySelector('video'))");
    await a.emit({ ...make, serverTime: new Date().toISOString() });
    assert.equal(await a.evaluate("document.querySelector('video') === makeVideo"), true);
    const b = await page(port);
    await b.emit({ ...make, serverTime: new Date().toISOString() });
    await b.ready();
    await b.click("Bật hình và tiếng");
    await b.playing();
    const [logA, logB] = await Promise.all([a.log(), b.log()]);
    for (const log of [logA, logB]) {
      const summary = log.questionSummaries.find(item => item.questionId === q.questionId);
      assert.equal(summary.firstReplyPlayback.mediaSource, "make");
      assert.equal(summary.firstReplyPlayback.playbackId, make.session.playback.playbackId);
      assert.equal(summary.playbacks.length, 1);
      assert.equal(summary.playbacks[0].mediaSource, "make");
      assert.equal(summary.sendToFirstReplyPlaybackMs, null);
    }
    await b.emit(state("script", { status: "ended", questions: [{ ...q, status: "skipped" }] }));
    await until(() => b.evaluate("document.querySelector('video') === null"), "Make viewer end");
    await a.evaluate("makeVideo.currentTime = makeVideo.duration - 0.5");
    await until(() => a.evaluate("!makeVideo.seeking && !makeVideo.paused"), "Make reply tail");
    await a.emit(state("script", { questions: [{ ...q, status: "answered" }] }));
    await until(() => a.evaluate("document.querySelector('video') !== makeVideo"), "Make reply returns to script");
    assert.equal(await a.evaluate("makeVideo.ended && makeVideo.paused && document.querySelector('video').loop"), true);
  });
  await check("JSON accounting caps events, counts eviction and keeps IDs unique", async () => {
    const ended = state("script", { status: "ended" });
    await a.evaluate(`for (let index = 0; index < 510; index++) window.streams.forEach(stream => stream.dispatchEvent(new MessageEvent('state', {data: ${JSON.stringify(JSON.stringify(ended))}})))`);
    const log = await a.log();
    assert.equal(log.events.length, 500);
    assert.ok(log.droppedEvents > 0);
    assert.equal(new Set(log.events.map(item => item.eventId)).size, 500);
    assert.ok(log.events.every(item => item.sessionId === log.sessionId));
  });
  console.log("Browser regression completed (real media; mocked transport; no human audio confirmation).");
} finally {
  for (const ws of sockets) ws.close();
  browser.kill();
  if (browser.exitCode === null && !launchError) await Promise.race([
    new Promise(resolve => browser.once("exit", resolve)), delay(5000),
  ]);
  // Remove only the unique profile created by this process, outside the repository.
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
  assert.ok(profile.startsWith(join(tmpdir(), "snackstream-live-browser-")));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
