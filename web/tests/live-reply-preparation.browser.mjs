// Real external MP4 + CDP-delayed delivery; SSE is synthetic, no providers called.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const base = process.env.LIVE_TEST_BASE_URL ?? "http://127.0.0.1:3107";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const fixture = await readFile(process.env.LIVE_REPLY_FIXTURE);
const expectedDuration = 5.108005;
const baseline = process.env.LIVE_REPLY_BASELINE === "1";
const preparationSeconds = baseline ? 0 : 5;
const profile = await mkdtemp(join(tmpdir(), "snackstream-reply-preparation-"));
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
      const ms = Number(url.searchParams.get("delay") ?? 3000);
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
  await until(() => evaluate("window.streams?.length>0"), "SSE subscription");
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
function state(kind, { start = Date.now(), id = crypto.randomUUID(), status = "playing",
  qstatus = "answering", delayMs = 3000, pausedAt = null } = {}) {
  return {
    serverTime: new Date().toISOString(), session: {
      liveId: "reply-preparation-live", title: "Delayed media regression", isDemo: true,
      status, pinnedSku: "BT-XIKE-01", scheduledSkus: ["BT-XIKE-01"],
      questions: [{ questionId: "reply-preparation-question", liveId: "reply-preparation-live",
        status: qstatus, sku: "BT-XIKE-01", text: "Existing MP4 replay", mediaSource: "make",
        receivedAt: new Date().toISOString(), isDemo: true, source: "web_live" }],
      playback: status === "ended" ? null : {
        playbackId: id, kind, mediaSource: kind === "reply" ? "make" : "prerecorded",
        videoUrl: kind === "reply" ? `https://reply.example.invalid/${id}.mp4?delay=${delayMs}` : "/live-demo/avatar.mp4",
        questionId: kind === "reply" ? "reply-preparation-question" : null,
        startedAt: new Date(start).toISOString(), pausedAt,
        durationSeconds: kind === "reply" ? expectedDuration : null,
      },
    },
  };
}
async function watching(viewer) {
  await viewer.emit(state("script")); await viewer.ready(); await viewer.enable(); await viewer.playing();
}
async function save(viewer, name, extra = {}) {
  const entry = { name, ...extra, deliveries: viewer.deliveries,
    events: await viewer.evaluate("window.mediaEvents"), log: await viewer.log() };
  evidence.push(entry);
  assert.ok(entry.events.every(event => event.active <= 1), "no overlapping audible elements");
  return entry;
}

try {
  const port = await until(async () => {
    if (launchError) throw launchError;
    try { return Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); }
    catch { return false; }
  }, "browser startup");
  const a = await page(port);
  await watching(a);
  const start = Date.now() + preparationSeconds * 1000;
  const reply = state("reply", { start });
  // SSE polling delays publication; its serverTime is sampled when the state is sent.
  const sseDelayMs = baseline ? 0 : 900;
  await delay(sseDelayMs);
  reply.serverTime = new Date().toISOString();
  await a.emit(reply);
  await a.ready();
  if (!baseline) {
    assert.equal(await a.evaluate("document.querySelector('video').paused"), true, "ready before scheduled start remains paused");
  }
  await a.playing();
  const first = await a.evaluate("window.mediaEvents.find(e=>e.event==='playing'&&e.src.includes('reply.example.invalid'))");
  await a.evaluate("void(window.replyVideo=document.querySelector('video'))");
  const restore = delay(Math.max(0, start + expectedDuration * 1000 - Date.now())).then(() => a.emit(state("script", { qstatus: "answered" })));
  await until(() => a.evaluate("document.querySelector('video')!==replyVideo"), "server completion returns script", 12000);
  await restore;
  await a.ready(); await a.playing();
  const result = await save(a, baseline ? "baseline loss reproduced" : "established viewer full clip", { first, scheduledStart: start, sseDelayMs });
  const end = result.events.find(e => e.event === "ended" && e.src.includes("reply.example.invalid"));
  if (baseline) {
    assert.ok(first.currentTime >= 2.5, "baseline reproduces first 3 seconds lost");
    assert.ok(end, "baseline restores script after shortened reply");
    console.log(`REPRODUCED first playing=${first.currentTime.toFixed(3)} / ${end.duration}`);
  } else {
    assert.ok(first.currentTime < 0.15, `reply starts near zero: ${first.currentTime}`);
    assert.ok(first.at >= start - 30, "no early playback");
    assert.ok(end && end.currentTime >= expectedDuration - 0.05, "native ended includes final media tail");
    assert.ok(end.at - first.at >= (expectedDuration - 0.15) * 1000, "full media duration rendered");
    console.log("PASS established viewer: delayed MP4 plays complete head/tail and restores script");
  }
  const late = await page(port);
  const lateStart = Date.now() - 500;
  await late.emit(state("reply", { start: lateStart }));
  await late.enable(); await late.ready(); await late.playing();
  const lateEvidence = await save(late, "late join aligns after its own download", { scheduledStart: lateStart });
  const lateFirst = lateEvidence.events.find(e => e.event === "playing");
  assert.ok(lateFirst.currentTime >= 3, "late viewer seeks to shared time, not replay from zero");
  await late.emit(state("script", { status: "ended" }));
  console.log("PASS late join seeks to shared timeline; it does not delay the session");
  if (!baseline) {
    for (const status of ["paused", "ended"]) {
      await watching(a);
      const upcoming = state("reply", { start: Date.now() + 5000 });
      await a.emit(upcoming);
      await delay(500);
      const stop = status === "paused" ? structuredClone(upcoming) : state("script", { status: "ended" });
      if (status === "paused") {
        stop.session.status = "paused"; stop.session.playback.pausedAt = new Date().toISOString();
      }
      await a.emit(stop); await delay(3200);
      assert.equal(await a.evaluate("document.querySelector('video')?.paused??true"), true);
      await save(a, `preparation ${status} interrupts pending start`);
      console.log(`PASS ${status} during preparation never starts old media`);
      if (status === "paused") {
        const pausedFor = Date.now() - Date.parse(stop.session.playback.pausedAt);
        const resume = structuredClone(upcoming);
        resume.serverTime = new Date().toISOString();
        resume.session.playback.startedAt = new Date(Date.parse(upcoming.session.playback.startedAt) + pausedFor).toISOString();
        await a.emit(resume);
        assert.equal(await a.evaluate("document.querySelector('video').paused"), true);
        await a.playing();
        const resumed = await save(a, "resume retains remaining preparation", { scheduledStart: Date.parse(resume.session.playback.startedAt) });
        const first = resumed.events.find(e => e.event === "playing" && e.src === upcoming.session.playback.videoUrl);
        assert.ok(first.currentTime < 0.15);
        assert.ok(first.at >= Date.parse(resume.session.playback.startedAt) - 30);
        await a.evaluate("void(window.skippedVideo=document.querySelector('video'))");
        await a.emit(state("script", { qstatus: "skipped" }));
        await until(() => a.evaluate("document.querySelector('video')!==skippedVideo"), "skip stops resumed reply");
        assert.equal(await a.evaluate("skippedVideo.paused"), true);
        console.log("PASS resume preserves remaining preparation and skip stops audio immediately");
      }
    }
    await watching(a);
    const bounded = state("reply", { start: Date.now() + 5000, delayMs: 7000 });
    await a.emit(bounded); await a.ready(); await a.playing();
    const limited = await save(a, "over-budget viewer rejoins shared position");
    const beyond = limited.events.find(e => e.event === "playing" && e.src === bounded.session.playback.videoUrl);
    assert.ok(beyond.currentTime >= 1.8, "slow viewer cannot extend shared preparation");
    await a.emit(state("script", { status: "ended" }));
    console.log("PASS media slower than preparation stays bounded and aligns with shared time");
  }
} finally {
  if (process.env.LIVE_REPLY_EVIDENCE) await writeFile(process.env.LIVE_REPLY_EVIDENCE, JSON.stringify(evidence, null, 2));
  for (const socket of sockets) socket.close();
  browser.kill();
  if (browser.exitCode === null && !launchError) await Promise.race([
    new Promise(resolve => browser.once("exit", resolve)), delay(5000),
  ]);
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
  assert.ok(profile.startsWith(join(tmpdir(), "snackstream-reply-preparation-")));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
