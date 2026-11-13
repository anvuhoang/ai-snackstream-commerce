// Real MP4 restoration regression; controlled SSE/media transport, no providers or human-hearing claims.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const base = process.env.LIVE_TEST_BASE_URL ?? "http://127.0.0.1:3107";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const replyFixture = await readFile(process.env.LIVE_REPLY_FIXTURE);
const scriptFixture = await readFile(process.env.LIVE_RESTORE_SCRIPT_FIXTURE);
const scriptDuration = 61.41644;
const expectedDuration = 5.108005;
const baseline = process.env.LIVE_RESTORE_BASELINE === "1";
const profile = await mkdtemp(join(tmpdir(), "snackstream-script-restore-"));
const browser = spawn(process.env.LIVE_TEST_BROWSER
  ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const sockets = [];
const evidence = [];
let launchError;
browser.on("error", error => { launchError = error; });
async function until(action, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await delay(20);
  }
  throw new Error(`Timed out: ${label}`);
}

const injection = `
window.streams=[]; window.mediaEvents=[]; window.mediaElements=[]; window.downloadedLog=null;
window.pageErrors=[];
window.addEventListener('error',e=>window.pageErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>window.pageErrors.push(String(e.reason)));
window.EventSource=class extends EventTarget {
  constructor(){super();window.streams.push(this)}
  close(){window.streams=window.streams.filter(x=>x!==this)}
};
for(const name of ['loadstart','loadedmetadata','playing','pause','ended','seeked','waiting']){
  document.addEventListener(name,e=>{
    const v=e.target;if(!(v instanceof HTMLVideoElement))return;
    if(!window.mediaElements.includes(v))window.mediaElements.push(v);
    window.mediaEvents.push({event:name,at:Date.now(),src:v.src,currentTime:v.currentTime,
      duration:Number.isFinite(v.duration)?v.duration:null,muted:v.muted,volume:v.volume,
      decodedFrames:v.getVideoPlaybackQuality?.().totalVideoFrames??null,
      audioDecodedBytes:v.webkitAudioDecodedByteCount??null,
      active:window.mediaElements.filter(x=>!x.paused&&!x.ended&&!x.muted&&x.volume>0).length});
  },true);
}
document.addEventListener('click',e=>{
  const a=e.target.closest('a[download]');if(!a)return;e.preventDefault();
  fetch(a.href).then(r=>r.json()).then(x=>window.downloadedLog=x);
});`;

async function page(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise((yes, no) => { ws.onopen = yes; ws.onerror = no; });
  let id = 0;
  const pending = new Map();
  const deliveries = [];
  function command(method, params = {}) {
    return new Promise((yes, no) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); no(new Error(`CDP timeout ${method}`)); }, 15000);
      pending.set(key, { yes, no, timer });
      ws.send(JSON.stringify({ id: key, method, params }));
    });
  }
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      const fixture = url.pathname.startsWith("/script") ? scriptFixture : replyFixture;
      const ms = Number(url.searchParams.get("delay") ?? 0);
      const range = Object.entries(request.headers).find(([name]) => name.toLowerCase() === "range")?.[1];
      const match = range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), fixture.length - 1) : fixture.length - 1;
      const bytes = fixture.subarray(start, end + 1);
      deliveries.push({ url: request.url, delayMs: ms, requestedAt: Date.now(), range });
      void delay(ms).then(() => command("Fetch.fulfillRequest", {
        requestId, responseCode: match ? 206 : 200,
        responseHeaders: [{ name: "Content-Type", value: "video/mp4" },
          { name: "Content-Length", value: String(bytes.length) },
          { name: "Accept-Ranges", value: "bytes" },
          ...(match ? [{ name: "Content-Range", value: `bytes ${start}-${end}/${fixture.length}` }] : []),
          { name: "Cache-Control", value: "no-store" }], body: bytes.toString("base64"),
      })).catch(() => {}); // Page may end/skip and cancel its outstanding request.
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    if (message.error) request.no(new Error(JSON.stringify(message.error)));
    else request.yes(message.result);
  };
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await command("Page.enable");
  await command("Fetch.enable", { patterns: [{ urlPattern: "https://reply.example.invalid/*" }] });
  await command("Page.addScriptToEvaluateOnNewDocument", { source: injection });
  await command("Page.navigate", { url: `${base}/live` });
  try {
    await until(() => evaluate("window.streams?.length>0"), "SSE subscription", 30000);
  } catch (error) {
    console.log("PAGE_DIAGNOSTIC", await evaluate("JSON.stringify({url:location.href,errors:window.pageErrors,streams:window.streams?.length,text:document.body.innerText.slice(0,1200)})"));
    throw error;
  }
  return {
    evaluate, deliveries,
    emit: snapshot => evaluate(`window.streams.forEach(s=>s.dispatchEvent(new MessageEvent('state',{data:${JSON.stringify(JSON.stringify(snapshot))}})))`),
    enable: () => evaluate("[...document.querySelectorAll('button')].find(x=>/Bật.*hình và tiếng/.test(x.textContent)).click()"),
    ready: () => until(() => evaluate("document.querySelector('video')?.readyState>=2"), "media ready"),
    playing: () => until(() => evaluate("!!document.querySelector('video')&&!document.querySelector('video').paused&&!document.querySelector('video').seeking"), "media playing"),
    log: async () => {
      await evaluate("window.downloadedLog=null;[...document.querySelectorAll('button')].find(x=>x.textContent==='Tải log JSON').click()");
      return until(() => evaluate("window.downloadedLog"), "diagnostic log");
    },
  };
}

const saved = 6.926;
function script({offset = saved, at = Date.now(), windowMs = baseline ? 0 : 5000,
  mediaDelay = 3000, id = crypto.randomUUID(), source = "playlist", pausedAt = null} = {}) {
  return {
    playbackId: id, kind: "script", mediaSource: source,
    scriptIndex: source === "playlist" ? 1 : null, scriptName: "Beta",
    videoUrl: `https://reply.example.invalid/script-${id}.mp4?delay=${mediaDelay}`,
    startedAt: new Date(at + windowMs - offset * 1000).toISOString(),
    ...(windowMs ? {resumeAt: new Date(at + windowMs).toISOString()} : {}),
    durationSeconds: source === "playlist" ? scriptDuration : null, pausedAt,
  };
}
function reply({start = Date.now() + 5000, id = crypto.randomUUID()} = {}) {
  return {playbackId: id, kind: "reply", mediaSource: "prerecorded", questionId: id,
    videoUrl: `https://reply.example.invalid/reply-${id}.mp4`,
    startedAt: new Date(start).toISOString(), pausedAt: null, durationSeconds: expectedDuration};
}
function state(playback, {status = "playing", qstatus = "answered", completed = false} = {}) {
  return {serverTime: new Date().toISOString(), session: {
    liveId: "restore-regression-live", title: "Restore regression (test media)", status,
    pinnedSku: "SKU-BETA", scheduledSkus: ["SKU-ALPHA", "SKU-BETA"], isDemo: true,
    scriptCompleted: completed, questions: [{questionId: playback?.questionId ?? "completed-reply",
      liveId: "restore-regression-live", sku: "SKU-BETA", text: "Mock reply", status: qstatus,
      mediaSource: "prerecorded", receivedAt: new Date().toISOString()}],
    playback: status === "ended" ? null : playback,
  }};
}
async function publish(viewer, playback, lagMs = 1000, options) {
  await delay(lagMs);
  return viewer.emit(state(playback, options));
}
async function finish(viewer, name, extra = {}) {
  const result = {name, ...extra, deliveries: structuredClone(viewer.deliveries),
    events: await viewer.evaluate("window.mediaEvents"), log: await viewer.log()};
  assert.ok(result.events.every(e => e.active <= 1), "never overlap audible elements");
  evidence.push(result);
  await viewer.emit(state(null, {status: "ended"}));
  console.log(`PASS ${name}`);
  return result;
}
async function firstFor(viewer, playback) {
  return until(() => viewer.evaluate(`window.mediaEvents.find(e=>e.event==='playing'&&e.src===${JSON.stringify(playback.videoUrl)})`), "first script playing");
}
async function sharedRestore(port) {
  const viewers = [];
  for (let index = 0; index < 2; index++) {
    const viewer = await page(port);
    viewers.push(viewer);
    await viewer.emit(state(script({windowMs: 0, mediaDelay: 0})));
    await viewer.ready(); await viewer.enable(); await viewer.playing();
  }
  const shared = script();
  // Same playback, URL, saved offset and gate; only SSE publication differs.
  await Promise.all(viewers.map((viewer, index) => publish(viewer, shared, index ? 0 : 1000)));
  await Promise.all(viewers.map(async viewer => {await viewer.ready(); await viewer.playing();}));
  const first = await Promise.all(viewers.map(viewer => firstFor(viewer, shared)));
  assert.ok(first.every(event => Math.abs(event.currentTime - saved) <= 0.2));
  assert.ok(first.every(event => event.at >= Date.parse(shared.resumeAt) - 25));
  assert.ok(Math.abs(first[0].at - first[1].at) <= 200, "both viewers start within 200ms on common gate");
  for (const [index, viewer] of viewers.entries()) {
    await finish(viewer, `shared restoration viewer ${index + 1}`, {
      sharedPlaybackId: shared.playbackId, resumeAt: shared.resumeAt, firstPlaying: first[index],
      interViewerStartDifferenceMs: Math.abs(first[0].at - first[1].at),
    });
  }
}
try {
  const port = await until(async () => {
    if (launchError) throw launchError;
    try { return Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); }
    catch { return false; }
  }, "browser startup");
  if (!baseline) await sharedRestore(port);
  if (process.env.LIVE_RESTORE_SYNC_ONLY !== "1") {
  const a = await page(port);
  await a.emit(state(script({windowMs: 0, mediaDelay: 0})));
  await a.ready(); await a.enable(); await a.playing();
  const answer = reply();
  await a.emit(state(answer, {qstatus: "answering"})); await a.ready(); await a.playing();
  await delay(Math.max(0, Date.parse(answer.startedAt) + expectedDuration * 1000 - Date.now()));
  const restoredAt = Date.now();
  const restored = script({at: restoredAt});
  await publish(a, restored); await a.ready();
  if (!baseline) {
    await until(() => a.evaluate(`document.querySelector('video').paused&&!document.querySelector('video').seeking
      &&Math.abs(document.querySelector('video').currentTime-${saved})<0.02`), "pre-seek saved offset while paused");
    assert.ok(Date.now() < Date.parse(restored.resumeAt), "preloaded before shared resume");
  }
  await a.playing();
  const first = await firstFor(a, restored);
  const error = first.currentTime - saved;
  if (baseline) assert.ok(error >= 3.8, `old timeline loses SSE+media delay: ${error}`);
  else {
    assert.ok(Math.abs(error) <= 0.2, `saved offset error <=200ms: ${error}`);
    assert.ok(first.at >= Date.parse(restored.resumeAt) - 25, "no early script playback");
  }
  const whole = await finish(a, baseline ? "baseline SSE 1s + media 3s loses script" : "SSE 1s + media 3s resumes saved script", {
    savedOffsetSeconds: saved, firstPlaying: first, resumeErrorSeconds: error,
    restoredAt, resumeAt: restored.resumeAt ?? null,
  });
  assert.ok(whole.events.some(e => e.event === "ended" && e.src === answer.videoUrl), "previous reply ends naturally");
  console.log(`MEASURE saved=${saved} first=${first.currentTime} error=${error}`);
  if (!baseline) {
    const paused = script({mediaDelay: 0});
    await publish(a, paused); await a.ready();
    const pausedAt = Date.now(); paused.pausedAt = new Date(pausedAt).toISOString();
    await a.emit(state(paused, {status: "paused"}));
    await delay(Math.max(0, Date.parse(paused.resumeAt) + 200 - Date.now()));
    assert.equal(await a.evaluate("document.querySelector('video').paused"), true);
    const pausedFor = Date.now() - pausedAt;
    const resumed = {...paused, pausedAt: null,
      resumeAt: new Date(Date.parse(paused.resumeAt) + pausedFor).toISOString(),
      startedAt: new Date(Date.parse(paused.startedAt) + pausedFor).toISOString()};
    await a.emit(state(resumed)); await a.playing();
    const pauseFirst = await firstFor(a, resumed);
    assert.ok(Math.abs(pauseFirst.currentTime - saved) <= 0.2);
    await finish(a, "pause/resume freezes remaining restore preparation", {firstPlaying: pauseFirst});

    const canceled = script({mediaDelay: 0});
    await publish(a, canceled); await a.ready();
    const nextReply = reply();
    await a.emit(state(nextReply, {qstatus: "answering"})); await a.ready();
    await a.playing();
    assert.equal(await a.evaluate(`window.mediaEvents.some(e=>e.event==='playing'&&e.src===${JSON.stringify(canceled.videoUrl)})`), false);
    await delay(Math.max(0, Date.parse(nextReply.startedAt) + expectedDuration * 1000 - Date.now()));
    const again = script();
    await publish(a, again); await a.ready(); await a.playing();
    const againFirst = await firstFor(a, again);
    assert.ok(Math.abs(againFirst.currentTime - saved) <= 0.2);
    await finish(a, "next reply cancels old script timer and final restore keeps offset", {firstPlaying: againFirst});

    const endCanceled = script({mediaDelay: 0});
    await publish(a, endCanceled); await a.ready();
    await a.emit(state(null, {status: "ended"}));
    await delay(Math.max(0, Date.parse(endCanceled.resumeAt) + 150 - Date.now()));
    assert.equal(await a.evaluate("document.querySelector('video')"), null);
    await finish(a, "end during restore preparation cancels pending start");

    const offline = script({mediaDelay: 0});
    await publish(a, offline); await a.ready();
    await a.evaluate("window.streams.forEach(s=>s.onerror?.())");
    await delay(Math.max(0, Date.parse(offline.resumeAt) + 600 - Date.now()));
    assert.equal(await a.evaluate("document.querySelector('video').paused"), true);
    await a.emit(state(offline)); await a.playing();
    assert.ok((await firstFor(a, offline)).currentTime >= saved + 0.5);
    await finish(a, "disconnect prevents pending play; reconnect catches shared clock");

    const slow = script({mediaDelay: 6000});
    await publish(a, slow); await a.ready(); await a.playing();
    const slowFirst = await firstFor(a, slow);
    assert.ok(slowFirst.currentTime >= saved + 1.8, "over-budget media cannot delay everyone");
    await finish(a, "over-budget load catches up instead of extending schedule", {firstPlaying: slowFirst});

    const late = await page(port);
    const alreadyRunning = script({at: Date.now()-7000, mediaDelay: 0});
    await late.emit(state(alreadyRunning)); await late.ready(); await late.enable(); await late.playing();
    assert.ok((await firstFor(late, alreadyRunning)).currentTime >= saved + 2);
    await finish(late, "late viewer follows common resumed timeline");

    const nearEnd = script({offset: scriptDuration - 0.3});
    await publish(a, nearEnd); await a.ready(); await a.playing();
    const nearFirst = await firstFor(a, nearEnd);
    assert.ok(nearFirst.currentTime < scriptDuration - 0.1, "near-end saved part is not skipped");
    await until(() => a.evaluate("document.querySelector('video').ended"), "near-end native completion");
    await a.emit(state(null, {completed: true}));
    await until(() => a.evaluate("!document.querySelector('video')"), "completed playlist has no restore player");
    await finish(a, "near-end segment renders remainder then completed playlist stays empty", {firstPlaying: nearFirst});

    const legacy = script({offset: scriptDuration + saved, source: "prerecorded"});
    await publish(a, legacy); await a.ready(); await a.playing();
    assert.equal(await a.evaluate("document.querySelector('video').loop"), true);
    assert.ok(Math.abs((await firstFor(a, legacy)).currentTime - saved) <= 0.2);
    await finish(a, "legacy looping script restores modulo offset with preparation");
  }
  }
} finally {
  if (process.env.LIVE_RESTORE_EVIDENCE) await writeFile(process.env.LIVE_RESTORE_EVIDENCE, JSON.stringify(evidence, null, 2));
  for (const socket of sockets) socket.close();
  browser.kill();
  if (browser.exitCode === null && !launchError) await Promise.race([
    new Promise(resolve => browser.once("exit", resolve)), delay(5000),
  ]);
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
  assert.ok(profile.startsWith(join(tmpdir(), "snackstream-script-restore-")));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
