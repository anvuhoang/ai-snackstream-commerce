// Playlist regression with real local MP4 bytes and synthetic SSE; no providers called.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const base = process.env.LIVE_TEST_BASE_URL ?? "http://127.0.0.1:3107";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const adminOnly = process.env.LIVE_PLAYLIST_ADMIN_ONLY === "1";
const fixtureBytes = adminOnly ? null : await readFile(process.env.LIVE_REPLY_FIXTURE);
const expectedDuration = 5.108005;
const secondFixture = adminOnly ? null : await readFile(process.env.LIVE_SCRIPT_SECOND_FIXTURE);
const secondDuration = 4.365011;
const profile = await mkdtemp(join(tmpdir(), "snackstream-script-playlist-"));
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

async function page(port, { origin = base, route = "/live" } = {}) {
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
      if (url.pathname === "/broken.mp4") {
        void command("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" });
        return;
      }
      const fixture = url.pathname === "/b.mp4" ? secondFixture : fixtureBytes;
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
  await command("Page.navigate", { url: `${origin}${route}` });
  await until(() => evaluate(route === "/live" ? "window.streams?.length>0"
    : `Object.entries(document.querySelector('form')??{}).some(([key,props])=>
      key.startsWith('__reactProps$')&&typeof props.onSubmit==='function')`), "page hydrated");
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

function script(index, offset = 0, extra = {}) {
  return {
    playbackId: crypto.randomUUID(), kind: "script", mediaSource: "playlist",
    scriptIndex: index, scriptName: index ? "Product B" : "Product A",
    videoUrl: `https://reply.example.invalid/${index ? "b" : "a"}.mp4`,
    durationSeconds: index ? secondDuration : expectedDuration,
    startedAt: new Date(Date.now() - offset * 1000).toISOString(), pausedAt: null, ...extra,
  };
}
function snapshot(playback, extra = {}) {
  return {
    serverTime: new Date().toISOString(), session: {
      liveId: "playlist-browser-live", title: "Experimental product videos", isDemo: true,
      status: "playing", pinnedSku: playback?.scriptIndex === 1 ? "SKU-B" : "SKU-A",
      scheduledSkus: ["SKU-A", "SKU-B"], scriptPlaylist: [
        { name: "Product A", sku: "SKU-A", videoUrl: "https://reply.example.invalid/a.mp4", durationSeconds: expectedDuration },
        { name: "Product B", sku: "SKU-B", videoUrl: "https://reply.example.invalid/b.mp4", durationSeconds: secondDuration },
      ], scriptCompleted: false, questions: [], playback, ...extra,
    },
  };
}
async function save(viewer, name) {
  const item = { name, deliveries: structuredClone(viewer.deliveries),
    events: await viewer.evaluate("window.mediaEvents"), log: await viewer.log() };
  assert.ok(item.events.every(e => e.active <= 1), "only one audible element");
  evidence.push(item);
  console.log(`PASS ${name}`);
}

async function adminForm(port) {
  // Both SSR and browser API traffic use this disposable transport. No real
  // backend, auth configuration, provider, database or private env is used.
  const requests = [];
  let current = null;
  let success = false;
  const api = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/api/admin/auth/me") {
      res.end(JSON.stringify({user: {id: 1, email: "test@example.invalid", role: "admin"}, csrf: "test-only"}));
    } else if (req.method === "GET" && req.url === "/api/live/current") {
      res.end(JSON.stringify({session: current, serverTime: new Date().toISOString()}));
    } else if (req.method === "POST" && req.url === "/api/admin/live") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      requests.push({payload, status: success ? 201 : 422});
      await delay(350);
      if (!success) {
        res.statusCode = 422;
        res.end(JSON.stringify({detail: [{loc: ["body", "scriptPlaylist", 0, "sku"],
          msg: "Simulated validation failure", type: "value_error"}]}));
      } else {
        current = { ...payload, liveId: "admin-playlist-created", status: "not_started", isDemo: true,
          pinnedSku: payload.scheduledSkus[0], scriptCompleted: false, playback: null, questions: [] };
        res.statusCode = 201;
        res.end(JSON.stringify(current));
      }
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({error: {code: "test_route_not_found"}}));
    }
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${api.address().port}`;
  const web = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"),
    "start", "--hostname", "127.0.0.1", "--port", "0"], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, API_URL: apiUrl, NODE_ENV: "production" },
  });
  let output = "", errors = "", startError;
  web.stdout.on("data", chunk => { output += chunk; });
  web.stderr.on("data", chunk => { errors += chunk; });
  web.on("error", error => { startError = error; });
  const result = {name: "admin form", requests};
  evidence.push(result);
  try {
    const origin = await until(() => {
      if (startError) throw startError;
      assert.equal(web.exitCode, null, "isolated frontend must remain running");
      return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    }, "isolated admin frontend startup");
    await until(async () => {
      try { return (await fetch(`${origin}/admin/live`, {redirect: "manual"})).status === 200; }
      catch { return false; }
    }, "isolated admin route");
    const admin = await page(port, {origin, route: "/admin/live"});
    const evaluate = admin.evaluate;
    const click = text => evaluate(`Array.from(document.querySelectorAll('form button'))
      .find(x=>x.textContent===${JSON.stringify(text)}).click()`);
    const segmentCount = () => evaluate("document.querySelectorAll('form fieldset fieldset').length");
    const read = () => evaluate(`({title:document.querySelector('[name=title]').value,
      skus:document.querySelector('[name=skus]').value,
      segments:Array.from(document.querySelectorAll('form fieldset fieldset')).map(f=>
        Array.from(f.querySelectorAll('input')).map(x=>x.value))})`);
    const fill = async (selector, values) => {
      await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).forEach((input,i)=>{
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(values)}[i]);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })`);
    };
    await fill("form input[name]", ["Ordered product videos", "SKU-A, SKU-B"]);
    const a = ["Product Alpha", "SKU-A", "https://media.example.invalid/alpha.mp4", "5.108005"];
    const b = ["Product Beta", "SKU-B", "https://media.example.invalid/beta.mp4", "4.365011"];
    await click("Thêm đoạn video (tối đa 30)");
    await until(async () => await segmentCount() === 1, "first segment added");
    await fill("form fieldset fieldset input", a);
    await click("Thêm đoạn video (tối đa 30)");
    await until(async () => await segmentCount() === 2, "second segment added");
    await fill("form fieldset fieldset:last-of-type input", b);
    await evaluate("document.querySelectorAll('form fieldset fieldset')[1].querySelector('button').click()");
    await until(async () => (await read()).segments[0][0] === b[0], "second segment moves up");
    assert.deepEqual((await read()).segments, [b, a]);
    await evaluate("document.querySelectorAll('form fieldset fieldset')[1].querySelectorAll('button')[2].click()");
    await until(async () => await segmentCount() === 1, "segment deleted");
    assert.deepEqual((await read()).segments, [b]);
    await click("Thêm đoạn video (tối đa 30)");
    await until(async () => await segmentCount() === 2, "segment re-added");
    assert.deepEqual((await read()).segments[1], ["", "", "", ""]);
    await fill("form fieldset fieldset:last-of-type input", a);
    const entered = await read();
    assert.deepEqual(entered.segments, [b, a]);
    result.entered = entered;
    console.log("PASS admin adds distinct clips, reorders, deletes and re-adds without mixing fields");

    const expected = {title: entered.title, scheduledSkus: ["SKU-A", "SKU-B"], scriptPlaylist: [b, a].map(
      ([name, sku, videoUrl, seconds]) => ({name, sku, videoUrl, durationSeconds: Number(seconds)}))};
    await evaluate("document.querySelector('form').requestSubmit()");
    await until(() => requests.length === 1, "validation request captured");
    assert.deepEqual(requests[0].payload, expected);
    assert.ok(requests[0].payload.scriptPlaylist.every(x => typeof x.durationSeconds === "number"));
    await until(() => evaluate("!!document.querySelector('form [role=alert]')"), "validation error visible");
    assert.deepEqual(await read(), entered, "422 must retain title, SKUs, order and every clip field");
    result.validationError = await evaluate("document.querySelector('form [role=alert]').textContent");
    console.log("PASS admin 422 preserves all entered fields and ordered numeric-duration payload");

    success = true;
    await evaluate("document.querySelector('form').requestSubmit()");
    await until(() => requests.length === 2, "retry captured");
    assert.deepEqual(await read(), entered, "pending success must not discard input");
    assert.deepEqual(requests[1].payload, expected, "retry must resend the complete ordered payload");
    await until(() => evaluate("document.querySelector('form [role=status]')?.textContent.includes('Đã tạo phiên mới')"),
      "success notice");
    await until(() => evaluate("document.body.textContent.includes('admin-playlist-created')"), "refresh shows created session");
    assert.deepEqual(current.scriptPlaylist, expected.scriptPlaylist);
    assert.equal(await segmentCount(), 0, "form resets only after confirmed success");
    result.created = current;
    result.afterSuccess = await read();
    result.successNotice = await evaluate("document.querySelector('form [role=status]').textContent");
    console.log("PASS admin retry succeeds with unchanged data, confirms creation and then resets the form");
  } finally {
    result.frontendStdout = output;
    result.frontendStderr = errors;
    web.kill();
    if (web.exitCode === null && !startError) await Promise.race([
      new Promise(resolve => web.once("exit", resolve)), delay(5000),
    ]);
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
  }
}
try {
  const port = await until(async () => {
    if (launchError) throw launchError;
    try { return Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); }
    catch { return false; }
  }, "browser startup");
  await adminForm(port);
  if (!adminOnly) {
  const a = await page(port);
  await a.emit(snapshot(script(0)));
  await a.ready(); await a.enable(); await a.playing();
  assert.equal(await a.evaluate("document.querySelector('video').loop"), false);
  const bAt = script(1);
  await delay(200);
  await a.emit(snapshot(bAt)); await a.ready(); await a.playing();
  assert.match(await a.evaluate("document.body.textContent"), /SKU-B/);
  await save(a, "playlist switches URL and SKU without looping or overlapping audio");

  const late = await page(port);
  await late.emit(snapshot(script(1, 2.25))); await late.ready(); await late.enable(); await late.playing();
  assert.ok(await late.evaluate("document.querySelector('video').currentTime") >= 2.25);
  await save(late, "late viewer seeks within current segment");
  await late.emit(snapshot(null, {status: "ended"}));

  const paused = script(0, 1.25, {pausedAt: new Date().toISOString()});
  await a.emit(snapshot(paused, {status: "paused"})); await a.ready();
  await delay(300);
  const pausePosition = await a.evaluate("document.querySelector('video').currentTime");
  await delay(300);
  assert.equal(await a.evaluate("document.querySelector('video').paused"), true);
  assert.ok(Math.abs(await a.evaluate("document.querySelector('video').currentTime") - pausePosition) < 0.02);
  const resumed = { ...paused, pausedAt: null, startedAt: new Date(Date.now() - 1250).toISOString() };
  await a.emit(snapshot(resumed)); await a.playing();
  assert.ok(Math.abs(await a.evaluate("document.querySelector('video').currentTime") - 1.25) < 0.2);
  await save(a, "pause and resume retain script position");

  const replyStart = Date.now() + 5000;
  const reply = {
    playbackId: crypto.randomUUID(), kind: "reply", mediaSource: "make", questionId: "playlist-reply-question",
    videoUrl: "https://reply.example.invalid/reply.mp4?delay=3000", durationSeconds: expectedDuration,
    startedAt: new Date(replyStart).toISOString(), pausedAt: null,
  };
  const answering = { questionId: "playlist-reply-question", status: "answering", sku: "SKU-A",
    text: "Test", liveId: "playlist-browser-live", receivedAt: new Date().toISOString(), mediaSource: "make" };
  await a.emit(snapshot(reply, {questions: [answering]})); await a.ready();
  assert.equal(await a.evaluate("document.querySelector('video').paused"), true);
  await a.playing();
  await a.evaluate("void(window.oldReply=document.querySelector('video'))");
  const first = await a.evaluate("window.mediaEvents.find(e=>e.event==='playing'&&e.src.includes('reply.mp4'))");
  assert.ok(first.currentTime < 0.15);
  await delay(Math.max(0, replyStart + expectedDuration * 1000 - Date.now()));
  await a.emit(snapshot(script(0, 1.5), {questions: [{...answering, status: "answered"}]}));
  await until(() => a.evaluate("document.querySelector('video')!==oldReply"), "restore script after reply");
  await a.ready(); await a.playing();
  const ended = await a.evaluate("window.mediaEvents.find(e=>e.event==='ended'&&e.src.includes('reply.mp4'))");
  assert.ok(ended && Math.abs(ended.currentTime - expectedDuration) < 0.001);
  assert.ok(Math.abs(await a.evaluate("document.querySelector('video').currentTime") - 1.5) < 0.4);
  await save(a, "five-second preparation plays real reply head/tail then restores script offset");

  await a.emit(snapshot({...reply, playbackId: crypto.randomUUID(), startedAt: new Date().toISOString(),
    videoUrl: "https://reply.example.invalid/skip-reply.mp4?delay=0"}, {questions: [answering]}));
  await a.ready(); await a.playing(); await a.evaluate("void(window.skippedReply=document.querySelector('video'))");
  await a.emit(snapshot(script(1, 1.1), {questions: [{...answering, status: "skipped"}]}));
  await a.ready(); await a.playing();
  assert.equal(await a.evaluate("skippedReply.paused"), true);
  assert.ok(Math.abs(await a.evaluate("document.querySelector('video').currentTime") - 1.1) < 0.4);
  await save(a, "skip stops reply immediately and restores another script segment");

  await a.emit(snapshot(script(0, 0, {videoUrl: "https://reply.example.invalid/broken.mp4"})));
  await until(() => a.evaluate("!!document.querySelector('[role=alert]')"), "media error is visible");
  await a.emit(snapshot(script(1))); await a.ready(); await a.playing();
  await save(a, "broken clip reports error and next server segment still plays");

  // A native ended event does not loop or advance the authoritative server state.
  await a.emit(snapshot(script(1))); await a.ready(); await a.playing();
  await until(() => a.evaluate("document.querySelector('video').ended"), "playlist native ended", 7000);
  await delay(250);
  assert.equal(await a.evaluate("document.querySelector('video').paused"), true);
  await a.emit(snapshot(null, {scriptCompleted: true}));
  await until(() => a.evaluate("!document.querySelector('video')"), "final playlist completion removes player");
  assert.equal(await a.evaluate("document.querySelector('textarea').matches(':disabled')"), true);
  await save(a, "end of playlist stops once and closes question submission");

  await a.emit(snapshot(script(0, 0, {mediaSource: "prerecorded", scriptIndex: null, scriptName: null,
    durationSeconds: null}), {scriptPlaylist: []})); await a.ready(); await a.playing();
  assert.equal(await a.evaluate("document.querySelector('video').loop"), true);
  await save(a, "legacy script remains distinguishable and loops");
  await a.emit(snapshot(null, {status: "ended"}));
  assert.equal(await a.evaluate("document.querySelector('video')"), null);
  }
} finally {
  if (process.env.LIVE_PLAYLIST_EVIDENCE) await writeFile(process.env.LIVE_PLAYLIST_EVIDENCE, JSON.stringify(evidence, null, 2));
  for (const socket of sockets) socket.close();
  browser.kill();
  if (browser.exitCode === null && !launchError) await Promise.race([
    new Promise(resolve => browser.once("exit", resolve)), delay(5000),
  ]);
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
  assert.ok(profile.startsWith(join(tmpdir(), "snackstream-script-playlist-")));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
