// Existing Next admin/viewer + real backend/SSE; fake host transport, real PCM/MP4/WebRTC.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const base=process.env.LIVE_TEST_BASE_URL??'http://127.0.0.1:3107';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const credentials=JSON.parse((await readFile(process.env.LIVE_SIMLI_TEST_CONFIG,'utf8')).replace(/^\uFEFF/,''));
const scenario=process.env.LIVE_SIMLI_CASE??'happy';
const matrixHidden=process.env.LIVE_SIMLI_MATRIX_HIDDEN==='true',matrixStall=process.env.LIVE_SIMLI_MATRIX_STALL==='true';
const output=process.env.LIVE_SIMLI_EVIDENCE;
const profile=await mkdtemp(join(tmpdir(),'snackstream-simli-integration-'));
const chrome=spawn(process.env.LIVE_TEST_BROWSER??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  ...(process.env.LIVE_SIMLI_HEADFUL==='true'?[]:['--headless=new']),'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,
  '--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank',
],{windowsHide:process.env.LIVE_SIMLI_HEADFUL!=='true',stdio:'ignore'});
const sockets=[],results=[],pages=[];
let browser,debug;
async function until(action,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){const value=await action();if(value)return value;await delay(60);}throw Error('Timed out: '+label);}
async function link(url){
  const ws=new WebSocket(url);sockets.push(ws);await new Promise((yes,no)=>{ws.onopen=yes;ws.onerror=no;});
  let id=0;const pending=new Map(),handlers=new Map();
  ws.onmessage=({data})=>{const m=JSON.parse(data);handlers.get(m.method)?.(m.params);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.no(Error(m.error.message)):p.yes(m.result);}};
  return {on:(name,fn)=>handlers.set(name,fn),command:(method,params={})=>new Promise((yes,no)=>{const seq=++id,timer=setTimeout(()=>{pending.delete(seq);no(Error('CDP '+method+' timeout'));},20000);pending.set(seq,{yes,no,timer});ws.send(JSON.stringify({id:seq,method,params}));})};
}
async function page(port,path,{producer=false,context}={}){
  context??=(await browser.command('Target.createBrowserContext')).browserContextId;
  const {targetId}=await browser.command('Target.createTarget',{url:'about:blank',browserContextId:context,...((process.env.LIVE_SIMLI_HEADFUL==='true'||scenario==='acceptance')?{newWindow:true}:{})});
  const c=await link(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);let external=0;const requests=[],questionBodies=[],sessionBodies=[],responses=[],writes=[];
  let acceptStart=true,confirmCount=0;
  c.on('Page.javascriptDialogOpening',dialog=>{
    assert.equal(dialog.type,'confirm');confirmCount++;
    void c.command('Page.handleJavaScriptDialog',{accept:acceptStart});
  });
  c.on('Network.responseReceived',value=>responses.push({url:value.response.url,status:value.response.status}));await c.command('Network.enable');
  c.on('Fetch.requestPaused',r=>{
    requests.push(r.request.url);
    if(r.request.method!=='GET')writes.push({method:r.request.method,path:new URL(r.request.url).pathname});
    if(producer&&scenario==='slow-media'&&r.request.url.endsWith('/host/mock-video')){setTimeout(()=>void c.command('Fetch.continueRequest',{requestId:r.requestId}).catch(()=>{}),3000);return;}
    if(producer&&scenario==='admin-end'&&r.request.url.endsWith('/host/action')&&r.request.postData&&JSON.parse(r.request.postData).action==='stop'){setTimeout(()=>void c.command('Fetch.continueRequest',{requestId:r.requestId}).catch(()=>{}),1000);return;}
    if(r.request.url.endsWith('/api/admin/live')&&r.request.method==='POST'&&r.request.postData)sessionBodies.push(JSON.parse(r.request.postData));
    if(producer&&scenario==='early-skip'&&r.request.url.endsWith('/host/action')&&r.request.postData&&JSON.parse(r.request.postData).action==='handoff'){
      setTimeout(()=>void c.command('Fetch.continueRequest',{requestId:r.requestId}).catch(()=>{}),800);return;
    }
    if(/\/api\/live\/[^/]+\/questions$/.test(r.request.url)&&r.request.method==='POST'&&r.request.postData)questionBodies.push(JSON.parse(r.request.postData));
    if(!r.request.url.startsWith(base+'/')){external++;void c.command('Fetch.failRequest',{requestId:r.requestId,errorReason:'BlockedByClient'}).catch(()=>{});return;}
    if(producer&&((scenario==='media-error'&&r.request.url.endsWith('/host/mock-video'))||(scenario==='audio-error'&&r.request.url.includes('/host/reply-audio/')))){
      void c.command('Fetch.fulfillRequest',{requestId:r.requestId,responseCode:404,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from('{"error":{"code":"test_media_missing"}}').toString('base64')}).catch(()=>{});return;
    }
    void c.command('Fetch.continueRequest',{requestId:r.requestId}).catch(()=>{});
  });
  const evaluate=async(expression,gesture=false)=>{
    const r=await c.command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:gesture});
    if(r.exceptionDetails)throw Error('Browser eval: '+(r.exceptionDetails.exception?.description??r.exceptionDetails.text));return r.result.value;
  };
  await c.command('Page.enable');await c.command('Fetch.enable',{patterns:[{urlPattern:'http*'}]});
  await c.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.loadInstance=crypto.randomUUID();window.hostEvents=[];window.hostFrames=[];window.pageErrors=[];window.receiverEvents=[];document.addEventListener('live-simli-viewer',e=>window.receiverEvents.push(e.detail));document.addEventListener('live-simli-producer',e=>window.hostEvents.push(e.detail));document.addEventListener('live-simli-frame',e=>{window.hostFrames.push(e.detail);if(window.hostFrames.length>2000)window.hostFrames.shift()});window.addEventListener('error',e=>window.pageErrors.push(e.message));`});
  if(producer&&process.env.LIVE_SIMLI_TIMER_REPLAY==='true')await c.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const nativeTimeout=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window),nativeInterval=window.setInterval.bind(window),nativeClearInterval=window.clearInterval.bind(window);
    const intervals=new Map();let seq=-1;
    window.setTimeout=(fn,ms=0,...args)=>nativeTimeout(fn,document.hidden?Math.max(1000,Number(ms)||0):ms,...args);
    window.setInterval=(fn,ms=0,...args)=>{
      if(typeof fn!=='function')return nativeInterval(fn,ms,...args);
      const id=seq--,entry={handle:null};intervals.set(id,entry);
      const tick=()=>{if(!intervals.has(id))return;fn(...args);if(intervals.has(id))entry.handle=window.setTimeout(tick,ms);};
      entry.handle=window.setTimeout(tick,ms);return id;
    };
    window.clearInterval=id=>{const entry=intervals.get(id);if(entry){intervals.delete(id);nativeClear(entry.handle);}else nativeClearInterval(id);};
    window.timerPolicyReplayMs=1000;
  })()`});
  // A provider's decoded frames do not run on the producer's window timers.
  // Under the deliberate 1Hz timer replay, use the existing local MP4 decoder
  // as the mock video source, while keeping the mock PCM echo/audio unchanged.
  if(producer&&scenario==='cadence'&&process.env.LIVE_SIMLI_TIMER_REPLAY==='true')await c.command('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('live-simli-producer',event=>{
    if(event.detail.event!=='transport_created'||event.detail.transport!=='mock')return;
    const root=document.querySelector('[data-testid=simli-producer]');let fiber=root[Object.keys(root).find(k=>k.startsWith('__reactFiber$'))],engine;
    for(let i=0;fiber&&i<40;fiber=fiber.return,i++)for(let h=fiber.memoizedState,n=0;h&&n<60;h=h.next,n++){const p=h.memoizedState?.current;if(p?.client&&p.coordinator)engine=p;}
    if(!engine)throw Error('Missing mock producer');
    const client=engine.client,start=client.start.bind(client),stop=client.stop.bind(client);let decoder,url;
    client.start=async()=>{await start();clearInterval(client.draw);const old=engine.hostVideo.srcObject;
      const bytes=await engine.api('mock-video',{},true);url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));decoder=document.createElement('video');decoder.muted=true;decoder.volume=0;decoder.loop=true;decoder.playsInline=true;decoder.src=url;await decoder.play();
      const video=decoder.captureStream().getVideoTracks()[0];await video.applyConstraints({frameRate:{max:25}});engine.hostVideo.srcObject=new MediaStream([video]);await engine.hostVideo.play();old?.getTracks().forEach(t=>t.stop());};
    client.stop=async()=>{try{await stop();}finally{decoder?.pause();if(url)URL.revokeObjectURL(url);}};
  });`});
  // Throughput follows the real transport's observer policy: no mock-only
  // per-frame GPU readback/burn-in. Functional cases retain the pixel stamps.
  if(scenario==='cadence')await c.command('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('${producer?'live-simli-producer':'live-simli-viewer'}',event=>{
    if(event.detail.event!=='${producer?'host_ready':'live_simli_viewer_playing'}')return;
    const root=document.querySelector('[data-testid=${producer?'simli-producer':'simli-receiver'}]');if(!root)return;let fiber=root[Object.keys(root).find(k=>k.startsWith('__reactFiber$'))];
    for(let i=0;fiber&&i<40;fiber=fiber.return,i++)for(let h=fiber.memoizedState,n=0;h&&n<60;h=h.next,n++){const p=h.memoizedState?.current;if(${producer?'p?.broadcast':'p?.pc&&p?.video'}){${producer?'p.broadcast.markFrames=false':'p.measureFrames=false'};window.cadencePixelReadback=false;}}
  });`});
  await c.command('Page.navigate',{url:base+path});
  const p={...c,evaluate,context,targetId,requests,questionBodies,sessionBodies,responses,writes,external:()=>external,acceptStart:value=>{acceptStart=value;},confirmations:()=>confirmCount};pages.push(p);debug=p;return p;
}
async function getSession(p){return p.evaluate(`fetch('/api/live/current').then(r=>r.json()).then(x=>x.session)`);}
async function adminSetup(p){
  await until(()=>p.evaluate('document.readyState==="complete"'),'app readiness',60000);
  const auth=await p.evaluate(`fetch('/api/admin/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({email:credentials.email,password:credentials.password})})}).then(r=>r.json())`,true);
  assert.ok(auth.csrf);await p.evaluate(`window.testCsrf=${JSON.stringify(auth.csrf)}`);
  const capabilities=await p.evaluate(`fetch('/api/admin/live/host-capabilities',{headers:{'X-CSRF-Token':window.testCsrf}}).then(async r=>{if(!r.ok)throw Error('Mock capability preflight HTTP '+r.status);return r.json();})`);
  assert.equal(capabilities.enabled,true);assert.equal(capabilities.transport,'mock','This browser harness must never acquire a real provider host');
  const leftover=await getSession(p);
  if(leftover&&leftover.status!=='ended'){
    const status=await p.evaluate(`fetch('/api/admin/live/${leftover.liveId}/end',{method:'POST',headers:{'X-CSRF-Token':window.testCsrf}}).then(r=>r.status)`);
    assert.equal(status,200,'End only leftover isolated mock test session before form test');
  }
  if(['content','manual-content','content-audio-reply'].includes(scenario)){
    await p.command('Page.navigate',{url:base+'/admin/live'});
    await until(()=>p.evaluate('!!document.querySelector("form select option[value=simli]")'),'content form capabilities');
    await p.evaluate(`{const s=document.querySelector('form select');s.value='simli';s.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await until(()=>p.evaluate('!!document.querySelector("form option[value=generated]")'),'generated narration selector');
    await p.evaluate(`{const s=document.querySelector('form option[value=generated]').closest('select');s.value='generated';s.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await until(()=>p.evaluate('!!document.querySelector("textarea[name=productFacts]")'),'product data fields');
    await p.evaluate(`{for(const [name,value] of Object.entries({title:'Khô gà lá chanh',skus:'KG-LC-250',productName:'Khô gà lá chanh 250 g',productFacts:'Thông tin sản phẩm do admin cung cấp.\\nBảo quản theo nhãn.'})){const input=document.querySelector('[name='+name+']');Object.getOwnPropertyDescriptor(name==='productFacts'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}}`,true);
    await p.evaluate(`document.querySelector('form button[type=submit]').click()`,true);
    const session=await until(async()=>{const s=await getSession(p);return s?.products?.[0]?.sku==='KG-LC-250'&&s.status==='not_started'?s:null;},'created product session');
    await until(()=>p.evaluate(`!!document.querySelector('[data-testid=live-content]')&&document.body.innerText.includes('${session.liveId}')`),'content editor mounted');
    assert.equal(await p.evaluate('document.querySelector("[data-testid=host-start]").disabled'),true);
    assert.equal(await p.evaluate('window.hostEvents.filter(e=>e.event==="transport_created").length'),0);
    await until(()=>p.evaluate('document.querySelector("[data-testid=manual-script]")?.disabled===false'),'manual script editor');
    assert.equal(await p.evaluate('document.querySelector("[data-testid=manual-script]").value'),'');
    assert.equal(await p.evaluate('document.querySelectorAll("input[type=checkbox]").length'),0);
    const script='Xin chào mọi người! Hôm nay chúng ta giới thiệu Khô gà lá chanh 250 g. Thông tin sản phẩm do admin cung cấp. Hãy gửi câu hỏi để được giải đáp nhé!';
    const edit=async value=>p.evaluate(`{const e=document.querySelector('[data-testid=manual-script]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`);
    const saved=async expected=>p.evaluate(`fetch('/api/admin/auth/me').then(r=>r.json()).then(a=>fetch('/api/admin/live/${session.liveId}/content',{headers:{'X-CSRF-Token':a.csrf}})).then(r=>r.json()).then(c=>c.script===${JSON.stringify(expected)})`);
    await edit(script);
    await until(()=>saved(script),'manual script saved');
    assert.equal(await p.evaluate('document.querySelector("[data-testid=generate-audio]").disabled'),true);
    await p.evaluate(`document.querySelector('[data-testid=review-script]').click()`,true);
    await until(()=>p.evaluate('!document.querySelector("[data-testid=generate-audio]").disabled'),'manual script review');
    await p.evaluate(`document.querySelector('[data-testid=generate-audio]').click();document.querySelector('[data-testid=generate-audio]').click();`,true);
    await until(()=>p.evaluate('document.querySelector("[data-testid=simli-producer]")?.dataset.audioReady==="true"'),'first audio ready');
    await until(()=>p.evaluate('!document.querySelector("[data-testid=host-start]").disabled'),'start enabled after audio');
    const edited=script+' Kịch bản đã được chỉnh sửa.';
    await edit(edited);
    assert.equal(await p.evaluate('document.querySelector("[data-testid=host-start]").disabled'),true,'dirty draft immediately blocks host');
    assert.equal(await p.evaluate('document.querySelector("[data-testid=review-script]").getAttribute("aria-pressed")==="true"'),false);
    await until(async()=>await saved(edited)&&!(await getSession(p)).hostAudioReady,'edit invalidates old audio');
    assert.equal((await getSession(p)).hostAudioDurationSeconds,null);
    assert.equal(await p.evaluate('document.querySelector("[data-testid=generate-audio]").disabled'),true);
    await p.command('Page.navigate',{url:base+'/admin/live'});
    await until(()=>p.evaluate(`document.querySelector('[data-testid=manual-script]')?.value===${JSON.stringify(edited)}`),'F5 retains manual script');
    assert.equal(await p.evaluate('document.querySelector("[data-testid=host-start]").disabled'),true);
    assert.equal(await p.evaluate('!!document.querySelector("[data-testid=generate-script]")'),false);
    await p.evaluate(`document.querySelector('[data-testid=review-script]').click()`,true);
    await until(()=>p.evaluate('!document.querySelector("[data-testid=generate-audio]").disabled'),'review edited script');
    await p.evaluate(`document.querySelector('[data-testid=generate-audio]').click()`,true);
    await until(()=>p.evaluate('document.querySelector("[data-testid=simli-producer]")?.dataset.audioReady==="true"'),'regenerated audio');
    const prepared=await getSession(p);assert.equal(prepared.hostAudioReady,true);assert.ok(prepared.hostAudioDurationSeconds>1);
    assert.equal(p.requests.filter(x=>x.endsWith('/content/audio')).length,2);
    assert.equal(p.writes.filter(x=>x.method==='POST'&&x.path.endsWith('/content/script')).length,0,'manual flow must never call script provider');
    assert.equal(await p.evaluate('window.hostEvents.filter(e=>e.event==="transport_created").length'),0,'content preparation must not open host');
    if(scenario==='manual-content'){
        await until(()=>p.evaluate('!document.querySelector("[data-testid=host-start]").disabled'),'mock start ready');
      await p.evaluate(`document.querySelector('[data-testid=host-start]').click()`,true);
      await until(()=>p.evaluate('document.querySelector("[data-testid=manual-script]").disabled'),'script locked during mock start');
      await until(async()=>(await getSession(p)).status==='playing','mock host starts');
      await p.evaluate(`document.querySelector('[data-testid=host-stop]').click()`,true);
      await until(async()=>(await getSession(p)).status==='ended','mock host ends');
      await p.command('Page.navigate',{url:base+'/admin/live'});
      await until(()=>p.evaluate('!document.querySelector("[data-testid=manual-script]")&&!document.querySelector("[data-testid=simli-producer]")'),'F5 after end hides prior preparation');

      // A later session must use its own product and blank narration, never
      // silently inherit the preceding product/script/configured audio SKU.
      await until(()=>p.evaluate('!!document.querySelector("form select option[value=simli]")'),'new form ready');
      await p.evaluate(`{const select=document.querySelector('form select');select.value='simli';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
      await until(()=>p.evaluate('!!document.querySelector("textarea[name=productFacts]")'),'fresh product inputs');
      assert.equal(await p.evaluate('document.querySelector("input[name=skus]").value'),'');
      assert.equal(await p.evaluate('document.querySelector("input[name=productName]").value'),'');
      assert.equal(await p.evaluate('document.querySelector("textarea[name=productFacts]").value'),'');
      await p.evaluate(`{for(const [name,value] of Object.entries({title:'New product session',skus:'SNACK-NEW-01',productName:'New snack',productFacts:'A sealed snack package.'})){const input=document.querySelector('[name='+name+']');Object.getOwnPropertyDescriptor(name==='productFacts'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}}`,true);
      await p.evaluate('document.querySelector("form button[type=submit]").click()',true);
      const next=await until(async()=>{const s=await getSession(p);return s?.liveId!==session.liveId&&s?.pinnedSku==='SNACK-NEW-01'?s:null;},'new SKU session');
      await until(()=>p.evaluate('document.querySelector("[data-testid=manual-script]")?.disabled===false'),'fresh script editor');
      assert.equal(await p.evaluate('document.querySelector("[data-testid=manual-script]").value'),'');
      assert.equal(next.hostAudioReady,false);assert.equal(next.status,'not_started');
      assert.equal(await p.evaluate('document.querySelectorAll("input[type=checkbox]").length'),0);
      assert.equal(await p.evaluate('document.querySelector("[data-testid=host-start]").disabled'),true);
      if(output){const image=await p.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(output.replace(/[^/\\]+$/,''),'admin-fresh-product.png'),Buffer.from(image.data,'base64'));}
      results.push({case:'ended-preparation-hidden-new-product-and-script-empty-no-auto-host',passed:true});
    }
    results.push({case:'manual-script-review-edit-invalidate-tts-f5',passed:true,product:session.products[0],durationSeconds:prepared.hostAudioDurationSeconds,source:'manual script and fake TTS; real local audio fixture; no script provider'});
    return session.liveId;
  }
  if(['sku-form','acceptance'].includes(scenario)){
    const previousLiveId=(await getSession(p))?.liveId;
    await p.command('Page.navigate',{url:base+'/admin/live'});
    await until(()=>p.evaluate('!!document.querySelector("form select option[value=simli]")'),'host capabilities');
    await p.evaluate(`{const select=document.querySelector('form select');select.value='simli';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await until(()=>p.evaluate('!!document.querySelector("form option[value=configured]")'),'source selector');
    await p.evaluate(`{const select=document.querySelector('form option[value=configured]').closest('select');select.value='configured';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await until(()=>p.evaluate('document.querySelector("input[name=skus]").value==="KG-LC-250"&&document.querySelector("input[name=skus]").readOnly'),'configured single SKU');
    await p.evaluate(`{const select=document.querySelector('form select');select.value='video';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await until(()=>p.evaluate('!document.querySelector("input[name=skus]").readOnly&&document.querySelector("input[name=skus]").value.includes("BT-XIKE-01")'),'legacy multi SKU preserved');
    await p.evaluate(`[...document.querySelectorAll('form button')].find(b=>b.textContent.includes('Thêm đoạn video')).click()`,true);
    await until(()=>p.evaluate('!!document.querySelector("form input[type=url]")&&!!document.querySelector("form input[type=number]")'),'Video playlist fields preserved');
    await p.evaluate(`[...document.querySelectorAll('form button')].find(b=>b.textContent.includes('Xóa đoạn')).click()`,true);
    await p.evaluate(`{const select=document.querySelector('form select');select.value='simli';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await until(()=>p.evaluate('document.querySelector("input[name=skus]").readOnly'),'Simli mapping restored');
    await p.evaluate(`{const input=document.querySelector('input[name=title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Giới thiệu khô gà lá chanh');input.dispatchEvent(new Event('input',{bubbles:true}));const sku=document.querySelector('input[name=skus]');sku.value='BT-XIKE-01';document.querySelector('form button[type=submit]').click();}`,true);
    await until(()=>p.evaluate('!!document.querySelector("form [role=alert]")'),'UI rejects tampered mismatched SKU');
    assert.equal(p.sessionBodies.length,0);
    await p.evaluate(`{document.querySelector('input[name=skus]').value='KG-LC-250';document.querySelector('form button[type=submit]').click();}`,true);
    const session=await until(async()=>{const s=await getSession(p);return s?.hostMode==='simli'&&s.liveId!==previousLiveId&&s.status==='not_started'?s:null;},'form creates matched session');
    assert.equal(p.sessionBodies.length,1);assert.deepEqual(p.sessionBodies[0].scheduledSkus,['KG-LC-250']);
    assert.equal(session.pinnedSku,'KG-LC-250');assert.equal(session.status,'not_started');
    assert.equal(await p.evaluate('window.hostEvents.filter(e=>e.event==="transport_created").length'),0);
    results.push({case:'configured-audio-sku-form-and-api-payload',passed:true,payload:p.sessionBodies[0],initialStatus:session.status});
    if(scenario==='sku-form'){
    const ended=await p.evaluate(`fetch('/api/admin/auth/me').then(r=>r.json()).then(x=>fetch('/api/admin/live/${session.liveId}/end',{method:'POST',headers:{'X-CSRF-Token':x.csrf}})).then(r=>r.status)`);
    assert.equal(ended,200);
    }
    await until(()=>p.evaluate(`!!document.querySelector('[data-testid=simli-producer][data-phase=idle]')&&document.body.innerText.includes(${JSON.stringify(session.liveId)})`),'controls belong to newly created session, not previous ended RSC');
    return session.liveId;
  }
  const created=await p.evaluate(`fetch('/api/admin/live',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':window.testCsrf},body:JSON.stringify({title:'Simli integration '+${JSON.stringify(scenario)},scheduledSkus:['KG-LC-250'],hostMode:'simli'})}).then(async r=>({status:r.status,data:await r.json()}))`);
  assert.equal(created.status,201,JSON.stringify(created.data));
  await p.command('Page.navigate',{url:base+'/admin/live'});
  await until(()=>p.evaluate('!!document.querySelector("[data-testid=simli-producer]")'),'existing admin producer UI',60000);
  return created.data.liveId;
}
async function start(p){
  await p.command('Page.bringToFront');
  await p.evaluate(`const root=document.querySelector('[data-testid=simli-producer]');[...root.querySelectorAll('button')].find(x=>x.dataset.testid==='host-start').click();[...root.querySelectorAll('button')].find(x=>x.dataset.testid==='host-start').click();`,true);
  await until(()=>p.evaluate('window.hostEvents.some(e=>e.event==="host_ready")'),'mock host ready',30000);
}
async function viewReady(p){
  await until(()=>p.evaluate('!!document.querySelector("[data-testid=simli-receiver]")'),'viewer integration',60000);
  const phase=await until(()=>p.evaluate(`['blocked','playing'].includes(document.querySelector('[data-testid=simli-receiver]')?.dataset.phase)&&document.querySelector('[data-testid=simli-receiver]').dataset.phase`),'WebRTC viewer track',20000);
  if(phase==='blocked')await p.evaluate(`document.querySelector('[data-testid=simli-receiver] button').click()`,true);
  if(!['background','slow-media','admin-end','matrix','cadence','acceptance','content'].includes(scenario))await until(()=>p.evaluate('window.hostFrames.length>3'),'decoder frames',12000);return phase==='blocked';
}
async function question(p,text){
  await p.evaluate(`{const area=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,${JSON.stringify(text)});area.dispatchEvent(new Event('input',{bubbles:true}));}`,true);
  // Question form is uncontrolled in the existing component.
  await p.evaluate(`document.querySelector('textarea').closest('form').requestSubmit()`,true);
  return until(async()=>{const s=await getSession(p);return s.questions.find(q=>q.text===text)?.questionId;},'question accepted');
}
async function metrics(a,b){
  const pairs=[];
  for(let i=0;i<12;i++){
    const values=await Promise.all([a.evaluate('window.hostFrames.at(-1)'),b.evaluate('window.hostFrames.at(-1)')]);
    if(values.every(Boolean))pairs.push({producerStampGapMs:Math.abs(values[0].producerTimeLow-values[1].producerTimeLow),frameGap:Math.abs(values[0].frame-values[1].frame)});await delay(100);
  }
  return {samples:pairs,maxStampGapMs:Math.max(...pairs.map(x=>x.producerStampGapMs)),maxFrameGap:Math.max(...pairs.map(x=>x.frameGap))};
}
try{
  const active=await until(async()=>{try{return await readFile(join(profile,'DevToolsActivePort'),'utf8');}catch{return null;}},'Chrome launch');
  const port=Number(active.split('\n')[0]);browser=await link(`ws://127.0.0.1:${port}${active.split('\n')[1].trim()}`);
  const producer=await page(port,'/live',{producer:true});const sid=await adminSetup(producer);
  if(!['sku-form','manual-content'].includes(scenario)){
  const v1=await page(port,'/live'),v2=await page(port,'/live');
  await until(()=>v1.evaluate('document.readyState==="complete"'),'first viewer page',60000);
  assert.equal((await getSession(v1)).status,'not_started');
  assert.equal(await producer.evaluate('document.querySelectorAll("input[type=checkbox]").length'),0);
  producer.acceptStart(false);
  await producer.evaluate(`document.querySelector('[data-testid=host-start]').click()`,true);
  assert.equal(producer.confirmations(),1);
  assert.equal(producer.requests.filter(u=>/\/host\/(acquire|token)$/.test(new URL(u).pathname)).length,0);
  assert.equal((await getSession(v1)).status,'not_started');
  producer.acceptStart(true);
  const denied=await v1.evaluate(`Promise.all(['acquire','action','token','audio','offer','reply-audio/forged-question'].map(p=>fetch('/api/admin/live/${sid}/host/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:'forged-viewer-001'})}).then(r=>r.status)))`);
  assert.ok(denied.every(s=>s===401),JSON.stringify(denied));
  await start(producer);
  const blocked=await Promise.all([viewReady(v1),viewReady(v2)]);
  const sync=['background','slow-media','admin-end','matrix','cadence','acceptance','content'].includes(scenario)?null:await metrics(v1,v2);if(sync)assert.ok(sync.maxStampGapMs<1000,'two decoder clocks diverged >=1 second');
  assert.equal(await producer.evaluate('window.hostEvents.filter(e=>e.event==="transport_created").length'),1);
if(['acceptance','content'].includes(scenario)){
    assert.ok(process.env.LIVE_SIMLI_EVIDENCE,'Acceptance evidence path required');
    const evidenceDir=output.replace(/[/\\][^/\\]+$/,'');
    const screenshot=async(p,name)=>{const result=await p.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(evidenceDir,name+'.png'),Buffer.from(result.data,'base64'));};
    const cssAudit=async(p)=>{
      const info=await p.evaluate(`Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map(async x=>{const r=await fetch(x.href),text=await r.text();return {path:new URL(x.href).pathname,status:r.status,contentType:r.headers.get('content-type'),unprocessed:/@theme|@tailwind/.test(text)}})).then(css=>({css,background:getComputedStyle(document.body).backgroundColor,mainDisplay:getComputedStyle(document.querySelector('main')).display,h1Size:getComputedStyle(document.querySelector('h1')).fontSize,errors:window.pageErrors}))`);
      assert.ok(info.css.length&&info.css.every(x=>x.status===200&&x.contentType.includes('text/css')&&!x.unprocessed),JSON.stringify(info));
      assert.equal(info.background,'rgb(250, 250, 249)');assert.equal(info.mainDisplay,p===producer?'block':'grid');assert.equal(info.h1Size,p===producer?'24px':'30px');assert.deepEqual(info.errors,[]);return info;
    };
    for(const p of [producer,v1,v2]){
      const body=await p.evaluate('document.body.innerText');
      assert.doesNotMatch(body,/producer|transport|SDK|codec|collector|lease|nghiệm thu|cleanup/i,'Ordinary UI must not expose technical instructions');
      assert.equal(await p.evaluate('!!document.querySelector("[data-testid=live-diagnostics]")'),false,'Diagnostics hidden by default, collection remains active');
    }
    assert.match(await producer.evaluate('document.body.innerText'),/90 giây.*2 người xem/);
    assert.match(await producer.evaluate('document.body.innerText'),/Người dẫn mô phỏng/);
    assert.doesNotMatch(await producer.evaluate('document.body.innerText'),/Chưa bắt đầu/,'Admin must show current host status');
    for(const p of [v1,v2])assert.match(await p.evaluate('document.body.innerText'),/Người dẫn mô phỏng/);
    const initialCss=[];for(const [i,p] of [producer,v1,v2].entries()){initialCss.push(await cssAudit(p));await screenshot(p,'active-'+['admin','viewer-1','viewer-2'][i]);}
    // MediaRecorder taps the received stream; it does not play a second source.
    // Keep both monitor elements muted during autonomous testing. Each saved
    // file still contains the single remote audio track with the common video.
    for(const p of [v1,v2])await p.evaluate(`(()=>{
      const video=document.querySelector('[data-testid=simli-receiver] video');video.muted=true;video.volume=0;
      if(video.srcObject.getAudioTracks().length!==1||video.srcObject.getVideoTracks().length!==1)throw Error('Expected one mixed audio and one shared video track');
      const types=['video/webm;codecs=vp8,opus','video/webm'];const mimeType=types.find(x=>MediaRecorder.isTypeSupported(x));if(!mimeType)throw Error('MediaRecorder webm unsupported');
      window.recordChunks=[];window.recordErrors=[];window.recordStartedAtUtc=new Date().toISOString();window.recording=new MediaRecorder(video.srcObject,{mimeType,videoBitsPerSecond:1400000,audioBitsPerSecond:96000});
      window.recordDone=new Promise(resolve=>{window.recording.onstop=()=>resolve();});window.recording.ondataavailable=e=>{if(e.data.size)window.recordChunks.push(e.data);};window.recording.onerror=e=>window.recordErrors.push(e.error?.name??'record_error');window.recording.start(500);
    })()`);
    const recordStart=Date.now();
    // Restore and foreground the real producer window, without focus emulation
    // or flags disabling browser throttling. Record the observed visibility.
    const {windowId}=await browser.command('Browser.getWindowForTarget',{targetId:producer.targetId});
    await browser.command('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});await producer.command('Page.bringToFront');
    const visibleState=await producer.evaluate('document.visibilityState');assert.equal(visibleState,'visible','producer must start visible before native minimize');
    await delay(5000);
    await browser.command('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});await v1.command('Page.bringToFront');
    await until(()=>producer.evaluate('document.visibilityState==="hidden"'),'minimized producer hidden');
    const hiddenAtUtc=new Date().toISOString();await delay(5000);
    const qid=await question(v1,'Khô gà lá chanh bảo quản thế nào?');
    await until(()=>producer.evaluate('window.hostEvents.some(e=>e.event==="reply_playing")'),'mock reply begins',12000);
    for(const [i,p] of [producer,v1,v2].entries())await screenshot(p,'reply-'+['admin','viewer-1','viewer-2'][i]);
    await until(()=>producer.evaluate('window.hostEvents.some(e=>e.event==="host_resumed")'),'native reply end and host restore',20000);
    const outcome=await producer.evaluate('window.hostEvents.find(e=>e.event==="host_resumed")');
    for(const p of [producer,v1,v2])assert.match(await p.evaluate('document.body.innerText'),/Trả lời mô phỏng bằng video có sẵn, chưa phải đáp án AI/);
    assert.ok(await v1.evaluate('window.receiverEvents.length>0'),'Diagnostics still collected without visible panel');
    await delay(5000);
    const session=await getSession(v1);assert.equal(session.questions.find(q=>q.questionId===qid).status,'answered');assert.equal(session.questions.find(q=>q.questionId===qid).sku,'KG-LC-250');
    const recorded=[];
    for(const [i,p] of [v1,v2].entries()){
      const record=await p.evaluate(`(async()=>{if(window.recording.state!=='inactive')window.recording.stop();await window.recordDone;const blob=new Blob(window.recordChunks,{type:window.recording.mimeType});if(blob.size>40000000)throw Error('Recording too large');const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.slice(r.result.indexOf(';base64,')+8));r.onerror=reject;r.readAsDataURL(blob);});return {base64,bytes:blob.size,mimeType:blob.type,errors:window.recordErrors,startedAtUtc:window.recordStartedAtUtc,endedAtUtc:new Date().toISOString()};})()`);
      assert.deepEqual(record.errors,[]);assert.ok(record.bytes>10000);const bytes=Buffer.from(record.base64,'base64');assert.equal(bytes.length,record.bytes);assert.equal(bytes.subarray(0,4).toString('hex'),'1a45dfa3');await writeFile(join(evidenceDir,`viewer-${i+1}.webm`),bytes);delete record.base64;recorded.push(record);
    }
    await browser.command('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});await producer.command('Page.bringToFront');
    await producer.evaluate(`[...document.querySelectorAll('[data-testid=simli-producer] button')].find(b=>b.dataset.testid==='host-stop').click()`,true);
    await until(async()=>(await getSession(v1)).status==='ended','backend ended after stop');
    for(const p of [v1,v2])await until(()=>p.evaluate(`document.querySelector('[data-testid=simli-receiver]').dataset.phase==='ended'&&document.querySelector('[data-testid=simli-receiver] video').srcObject===null&&!document.body.innerText.includes('Đang xử lý các câu hỏi')&&!document.body.innerText.includes('Chưa bắt đầu')`),'ended receiver has no waiting/drain');
    await until(()=>producer.evaluate('window.hostEvents.some(e=>e.event==="admin_end_confirmed")'),'admin confirms backend end');
    const events=await producer.evaluate('window.hostEvents'),receivers=[await v1.evaluate('window.receiverEvents'),await v2.evaluate('window.receiverEvents')];
    assert.equal(events.filter(e=>e.event==='transport_created').length,1);assert.equal(events.filter(e=>e.event==='host_cleanup').length,1);assert.equal(events.find(e=>e.event==='host_cleanup').backendAcknowledged,true);
    const endedCss=[];
    for(const [i,p] of [producer,v1,v2].entries()){
      endedCss.push(await cssAudit(p));await screenshot(p,'ended-'+['admin','viewer-1','viewer-2'][i]);
      const before=p.requests.filter(u=>/\/host\/(acquire|token)$/.test(new URL(u).pathname)).length;
      await p.command('Page.reload',{ignoreCache:false});
      await until(()=>p.evaluate(`document.readyState==='complete'&&!!document.querySelector('${i===0?'form':'[data-testid=simli-receiver][data-phase=ended]'}')`),'F5 after end');
      await cssAudit(p);await screenshot(p,'reloaded-'+['admin','viewer-1','viewer-2'][i]);
      if(i>0)assert.equal(await p.evaluate(`document.body.innerText.includes('Đang xử lý các câu hỏi')||document.body.innerText.includes('Chưa bắt đầu')`),false);
      assert.equal(p.requests.filter(u=>/\/host\/(acquire|token)$/.test(new URL(u).pathname)).length,before,'refresh must not acquire/token');
      assert.equal(await p.evaluate('window.hostEvents.filter(e=>e.event==="transport_created").length'),0);
    }
    const beforeDebug=v2.requests.filter(u=>/\/host\/(acquire|token)$/.test(new URL(u).pathname)).length;
    await v2.command('Page.navigate',{url:base+'/live?debug=1'});
    await until(()=>v2.evaluate('!!document.querySelector("[data-testid=live-diagnostics]")'),'Opt-in diagnostics still available');
    assert.match(await v2.evaluate('document.body.innerText'),/Tải log JSON/);
    assert.equal(v2.requests.filter(u=>/\/host\/(acquire|token)$/.test(new URL(u).pathname)).length,beforeDebug);
    await screenshot(v2,'debug-viewer');
    results.push({case:'autonomous-css-ended-recording',passed:true,browserMode:process.env.LIVE_SIMLI_HEADFUL==='true'?'headful':'headless-new',throttlingOverrides:false,visibleState,hiddenAtUtc,recordedSeconds:(Date.now()-recordStart)/1000,outcome,initialCss,endedCss,recorded,events,receivers,providerRequests:pages.reduce((n,p)=>n+p.external(),0),recordingIsDecoderEvidenceNotHumanListening:true});
  }else if(scenario==='cadence'){
    const reply=process.env.LIVE_SIMLI_CADENCE_REPLY==='true';
    const screen=await producer.evaluate('({width:window.screen.availWidth,height:window.screen.availHeight})');
    for(const [index,p] of [producer,v1,v2].entries()){
      const {windowId}=await browser.command('Browser.getWindowForTarget',{targetId:p.targetId});
      await browser.command('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
      await browser.command('Browser.setWindowBounds',{windowId,bounds:{left:index*Math.floor(screen.width/3),top:0,width:Math.floor(screen.width/3),height:Math.min(screen.height,820)}});
    }
    await producer.command('Page.bringToFront');
    await delay(4000); // Stable visible baseline, no intentional CPU stall.
    if(reply){await question(v1,'Local MP4 with silent hidden producer');await until(()=>producer.evaluate('window.hostEvents.some(e=>e.event==="reply_playing")'),'reply started before minimize',12000);}
    const hiddenAt=Date.now();
    const {windowId}=await browser.command('Browser.getWindowForTarget',{targetId:producer.targetId});
    await browser.command('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});
    await v1.command('Page.bringToFront');
    assert.equal(await producer.evaluate('document.visibilityState'),'hidden');
    // Do not poll Runtime.evaluate on the producer while testing native timer
    // throttling. Collect its independent worklet/RTC samples after the wait.
    await delay(reply?4800:16000);
    const hidden=await producer.evaluate('({visibility:document.visibilityState,events:window.hostEvents})');
    if(reply)await delay(12000);
    const outcome=await producer.evaluate('window.hostEvents.find(e=>e.event==="host_resumed")??window.hostEvents.find(e=>e.event==="host_cleanup")??null');
    await producer.evaluate(`(()=>{const el=document.querySelector('[data-testid=simli-producer]');let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];for(let f=0;fiber&&f<30;fiber=fiber.return,f++)for(let hook=fiber.memoizedState,n=0;hook&&n<50;hook=hook.next,n++){const engine=hook.memoizedState?.current;if(engine?.liveId===${JSON.stringify(sid)}&&engine.stop)return engine.stop('cadence_complete');}})()`);
    const events=await producer.evaluate('window.hostEvents');
    const stable=events.filter(e=>e.event==='host_pipeline_sample'&&Date.parse(e.atUtc)>=hiddenAt+1000&&e.visibility==='hidden');
    const outgoing=rows=>rows?.find(r=>r.type==='outbound-rtp'&&r.kind==='video');
    const interval=items=>{const valid=items.filter(e=>e.sender?.length===2&&e.sender.every(rows=>Number.isFinite(outgoing(rows)?.framesEncoded)));
      assert.ok(valid.length>=2,'need two independent hidden samples with available sender counters');const a=valid[0],b=valid.at(-1),seconds=(Date.parse(b.atUtc)-Date.parse(a.atUtc))/1000;
      const fps=(b.canvas.calls-a.canvas.calls)/seconds,feedRate=(b.feed.bytes-a.feed.bytes)/32000/seconds;
      const senders=b.sender.map((rows,i)=>(outgoing(rows).framesEncoded-outgoing(a.sender[i]).framesEncoded)/seconds);
      return {from:a.atUtc,to:b.atUtc,seconds,canvasFps:fps,feedAudioSecondsPerSecond:feedRate,senderFps:senders,unavailableSamples:items.length-valid.length};};
    const measured=interval(stable.filter(e=>e.owner===(reply?'reply':'host')));
    assert.ok(measured.canvasFps>=20,JSON.stringify(measured));assert.ok(measured.senderFps.length===2&&measured.senderFps.every(x=>x>=20),JSON.stringify(measured));
    if(!reply)assert.ok(measured.feedAudioSecondsPerSecond>=.9&&measured.feedAudioSecondsPerSecond<=1.1,JSON.stringify(measured));
    if(reply){assert.equal(outcome?.event,'host_resumed');const resumed=interval(stable.filter(e=>e.owner==='host'&&Date.parse(e.atUtc)>Date.parse(outcome.atUtc)+1000));assert.ok(resumed.canvasFps>=20&&resumed.feedAudioSecondsPerSecond>=.9&&resumed.feedAudioSecondsPerSecond<=1.1,JSON.stringify(resumed));measured.resumed=resumed;}
    const receiverMeasurements=[];
    for(const p of [v1,v2]){
      const allSamples=(await p.evaluate('window.receiverEvents')).filter(e=>e.event==='live_simli_receiver_sample');
      const get=e=>e.rtc?.find(r=>r.kind==='video'&&r.type==='inbound-rtp'),samples=allSamples.filter(e=>Number.isFinite(get(e)?.framesDecoded));
      assert.ok(samples.length>=2,'receiver video counters unavailable; cannot infer FPS');
      const nearest=time=>samples.reduce((a,b)=>Math.abs(Date.parse(a.atUtc)-Date.parse(time))<=Math.abs(Date.parse(b.atUtc)-Date.parse(time))?a:b);
      const a=nearest(measured.from),b=nearest(measured.to),seconds=(Date.parse(b.atUtc)-Date.parse(a.atUtc))/1000;assert.ok(seconds>0,'need distinct receiver samples');
      const fps=(get(b).framesDecoded-get(a).framesDecoded)/seconds;
      receiverMeasurements.push({from:a.atUtc,to:b.atUtc,visibility:b.visibility,decodeFps:fps,unavailableSamples:allSamples.length-samples.length,endpointSkewMs:[Date.parse(a.atUtc)-Date.parse(measured.from),Date.parse(b.atUtc)-Date.parse(measured.to)]});assert.ok(fps>=20,JSON.stringify(receiverMeasurements));
    }
    measured.receivers=receiverMeasurements;
    assert.equal(events.filter(e=>e.event==='host_cleanup').length,1);assert.equal(events.find(e=>e.event==='host_cleanup').backendAcknowledged,true);
    assert.equal((await getSession(producer)).status,'ended');
    results.push({case:reply?'hidden-local-reply-cadence':'hidden-continuous-cadence',passed:true,measured,pixelReadbackEnabled:false,headful:process.env.LIVE_SIMLI_HEADFUL==='true',browserTimerOverrides:process.env.LIVE_SIMLI_TIMER_REPLAY==='true',
      hiddenAtUtc:new Date(hiddenAt).toISOString(),hidden,outcome,events,viewer1:await v1.evaluate('window.receiverEvents'),viewer2:await v2.evaluate('window.receiverEvents'),
      viewerFrames1:await v1.evaluate('window.hostFrames'),viewerFrames2:await v2.evaluate('window.hostFrames')});
  }else if(scenario==='matrix'){
    await producer.evaluate(`(()=>{
      const el=document.querySelector('[data-testid=simli-producer]');let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))],p;
      for(let f=0;fiber&&f<30;fiber=fiber.return,f++)for(let hook=fiber.memoizedState,n=0;hook&&n<50;hook=hook.next,n++)if(hook.memoizedState?.current?.coordinator)p=hook.memoizedState.current;
      if(!p||p.latest?.host?.transport!=='mock'||!p.client.context||!Array.isArray(p.client.nodes))throw Error('Matrix requires fake transport');
      window.matrixEngine=p;window.matrixTrace=[];
      const trace=(kind,data)=>{if(window.matrixTrace.length<6000)window.matrixTrace.push({kind,at:performance.now(),mixerTime:p.mixer.context.currentTime,inputTime:p.client.context.currentTime,...data});};
      window.matrixReference={bins:p.coordinator.tracker.reference.slice(),start:p.coordinator.tracker.start,window:p.coordinator.tracker.window.slice(),last:p.coordinator.tracker.last};
      let sourceByte=Math.round(p.sent*32000),epoch=0;
      const feed=p.feed.bind(p);p.feed=position=>{sourceByte=Math.floor(position*16000)*2;epoch++;trace('feed_start',{position,sourceByte,epoch});return feed(position);};
      const send=p.client.sendAudioData.bind(p.client);p.client.sendAudioData=bytes=>{
        const inputNow=p.client.context.currentTime,before=p.client.nextAt;let equal=true;for(let i=0;i<bytes.length;i++)if(bytes[i]!==p.pcm[sourceByte+i]){equal=false;break;}
        send(bytes);trace('send',{epoch,sourceByte,bytes:bytes.length,equal,inputBefore:inputNow,scheduledStart:p.client.nextAt-bytes.length/32000,previousScheduledEnd:before});sourceByte+=bytes.length;
      };
      const clear=p.client.ClearBuffer.bind(p.client);p.client.ClearBuffer=()=>{trace('clear',{epoch,scheduledEnd:p.client.nextAt});return clear();};
      const tracker=p.coordinator.tracker,reset=tracker.reset.bind(tracker),observe=tracker.observe.bind(tracker);
      tracker.reset=start=>{trace('matcher_reset',{start});return reset(start);};
      tracker.observe=(bins,time,bound)=>{const previous=tracker.last?{...tracker.last}:null,result=observe(bins,time,bound);trace('probe',{bins:bins.slice(),time,bound,phase:p.coordinator.phase,owner:p.mixer.owner,previous,match:result?{...result}:null});return result;};
      const select=p.mixer.select.bind(p.mixer);p.mixer.select=owner=>{trace('mixer_request',{owner});const pending=select(owner);pending.then(ack=>trace('mixer_ack',{owner,time:ack.time}),()=>{});return pending;};
      const draw=p.broadcast.draw.bind(p.broadcast);p.broadcast.draw=()=>{const before=performance.now();draw();trace('canvas',{cost:performance.now()-before,currentTime:p.hostVideo.currentTime,owner:p.mixer.owner});};
      trace('instrumented',{sentBound:p.sent});
    })()`);
    const readyAt=await producer.evaluate('window.hostEvents.find(e=>e.event==="host_ready").atUtc');
    const readyMs=Date.parse(readyAt);
    if(matrixHidden){
      const {windowId}=await browser.command('Browser.getWindowForTarget',{targetId:producer.targetId});
      await browser.command('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});
      await until(()=>producer.evaluate('document.visibilityState==="hidden"'),'matrix actual hidden');
    }else await producer.command('Page.bringToFront');
    const visibility=await producer.evaluate('({visibility:document.visibilityState,focused:document.hasFocus()})');
    assert.equal(visibility.visibility,matrixHidden?'hidden':'visible');
    await delay(Math.max(0,readyMs+3000-Date.now()));
    if(matrixStall)await producer.evaluate('(()=>{window.matrixTrace.push({kind:"stall_start",at:performance.now(),mixerTime:window.matrixEngine.mixer.context.currentTime});const end=performance.now()+750;while(performance.now()<end){}window.matrixTrace.push({kind:"stall_end",at:performance.now(),mixerTime:window.matrixEngine.mixer.context.currentTime});})()');
    await delay(Math.max(0,readyMs+5500-Date.now()));
    const sentAt=Date.now();
    const accepted=await v1.evaluate(`fetch('/api/live/${sid}/questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questionId:'matrix-question-0001',sessionId:'matrix-viewer-0001',text:'Same question for the four producer timing cases'})}).then(async r=>({status:r.status,body:await r.json()}))`);
    assert.equal(accepted.status,200);assert.equal(accepted.body.sku,'KG-LC-250');
    let outcome;
    await until(async()=>{outcome=await producer.evaluate('window.hostEvents.find(e=>e.event==="host_resumed")??window.hostEvents.find(e=>e.event==="host_cleanup")');return outcome;},'matrix restore or terminal outcome',25000);
    if(outcome.event==='host_resumed')await delay(4000);
    const continuousPosition=await producer.evaluate('window.matrixEngine.coordinator.tracker.last');
    const events=await producer.evaluate('window.hostEvents');
    const trace=await producer.evaluate('window.matrixTrace');
    const reference=await producer.evaluate('window.matrixReference');
    assert.ok(trace.filter(x=>x.kind==='send').every(x=>x.equal));
    if(outcome.event==='host_resumed'){
      await producer.evaluate('window.matrixEngine.stop("matrix_complete")');
      await until(async()=>(await getSession(v1)).status==='ended','matrix clean end');
    }
    results.push({case:'matrix',passed:outcome.event==='host_resumed',hidden:matrixHidden,stallMs:matrixStall?750:0,visibility,
      questionTargetSeconds:5.5,questionSubmitSeconds:(sentAt-readyMs)/1000,questionAcceptedSeconds:(Date.parse(accepted.body.receivedAt)-readyMs)/1000,
      outcome,continuousPosition,events,trace,reference,viewer1:await v1.evaluate('window.receiverEvents'),viewer2:await v2.evaluate('window.receiverEvents')});
    if(outcome.event!=='host_resumed')process.exitCode=1;

  }else if(['background','slow-media','admin-end'].includes(scenario)){
    const loadInstance=await producer.evaluate('window.loadInstance');
    await producer.command('Performance.enable');const before=await producer.command('Performance.getMetrics');
    if(scenario==='background'){
      const {windowId}=await browser.command('Browser.getWindowForTarget',{targetId:producer.targetId});
      await browser.command('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});
      await v1.command('Page.bringToFront');
      await until(()=>producer.evaluate('document.visibilityState==="hidden"'),'producer really background');
      await producer.evaluate('(()=>{const end=performance.now()+750;while(performance.now()<end){}return document.visibilityState;})()');
      await delay(2500);
    }
    const visibility=await producer.evaluate('({visibility:document.visibilityState,focused:document.hasFocus()})');
    if(scenario!=='admin-end'){
    const q=await question(v1,'Measured mock reply with '+scenario);
    await until(()=>producer.evaluate('window.hostEvents.some(e=>e.event==="host_resumed")'),'reply finishes and host restores',25000);
    const events=await producer.evaluate('window.hostEvents');
    const reply=events.find(e=>e.event==='reply_ended');assert.ok(Math.abs(reply.replyEnd-5.108005)<.001);
    assert.equal((await getSession(v1)).questions.find(x=>x.questionId===q).sku,'KG-LC-250');
    }
    const during=await producer.evaluate('({status:[...document.querySelectorAll("dt")].find(x=>x.textContent==="Trạng thái")?.nextElementSibling?.textContent,locked:document.querySelector("form fieldset").disabled,loadInstance:window.loadInstance})');
    assert.equal(during.loadInstance,loadInstance);assert.equal(during.locked,true);
    const after=await producer.command('Performance.getMetrics');
    await producer.evaluate(`[...document.querySelectorAll('[data-testid=simli-producer] button')].find(b=>b.dataset.testid==='host-stop').click()`,true);
    if(scenario==='admin-end'){await delay(200);assert.equal((await getSession(v1)).status,'playing');assert.equal(await producer.evaluate('document.querySelector("form fieldset").disabled'),true);}
    await until(()=>producer.evaluate('document.querySelector("form fieldset").disabled===false&&!document.querySelector("[data-testid=simli-producer]")&&document.body.innerText.includes("\u0110\u00e3 k\u1ebft th\u00fac")'),'admin refresh after backend-confirmed end',12000);
    assert.equal(await producer.evaluate('window.loadInstance'),loadInstance,'no full reload while host active or after cleanup');
    const final=await producer.evaluate('window.hostEvents');
    assert.equal(final.filter(e=>e.event==='transport_created').length,1);
    assert.equal(final.filter(e=>e.event==='admin_end_confirmed').length,1);
    const cpu=name=>{const a=before.metrics.find(x=>x.name===name)?.value,b=after.metrics.find(x=>x.name===name)?.value;return Number.isFinite(a)&&Number.isFinite(b)?b-a:null;};
    results.push({case:scenario,passed:true,browserTimerOverrides:false,producerVisibility:visibility,
      mainThreadTaskSeconds:cpu('TaskDuration'),mainThreadScriptSeconds:cpu('ScriptDuration'),
      events:final,viewer1:await v1.evaluate('window.receiverEvents'),viewer2:await v2.evaluate('window.receiverEvents')});
  }else if(['happy','audio-reply','content-audio-reply'].includes(scenario)){
    const capture=scenario==='audio-reply'&&process.env.LIVE_SIMLI_CAPTURE==='true';
    if(capture)for(const p of [v1,v2])await p.evaluate(`(()=>{const video=document.querySelector('[data-testid=simli-receiver] video');if(video.srcObject.getAudioTracks().length!==1)throw Error('Expected one mixed audio track');window.captureChunks=[];window.captureRecorder=new MediaRecorder(video.srcObject,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1000000});window.captureRecorder.ondataavailable=e=>{if(e.data.size)window.captureChunks.push(e.data)};window.captureDone=new Promise(r=>window.captureRecorder.onstop=r);window.captureRecorder.start(500);})()`);
    const q1=await question(v1,'Câu hỏi KG-LC-250 từ viewer thứ nhất');
    await until(()=>producer.evaluate('window.hostEvents.some(e=>e.event==="reply_playing")'),'reply playback',15000);
    if(capture)for(const [name,p] of [['admin',producer],['viewer',v1]]){const image=await p.command('Page.captureScreenshot',{format:'png'});await writeFile(output.replace(/[/\\][^/\\]+$/,'')+'/'+name+'-audio-reply.png',Buffer.from(image.data,'base64'));}
    const q2=await question(v2,'Câu hỏi từ viewer thứ hai trong queue');
    await until(()=>producer.evaluate('window.hostEvents.filter(e=>e.event==="host_resumed").length>=2'),'two replies restore host',35000);
    await until(async()=>(await getSession(v1)).questions.filter(q=>q.status==='answered').length===2,'queue answered');
    const session=await getSession(v1);assert.equal(session.questions.find(q=>q.questionId===q1).sku,'KG-LC-250');
    if(['audio-reply','content-audio-reply'].includes(scenario)){assert.equal(session.replyFormat,'simli_audio');assert.equal(session.questions.find(q=>q.questionId===q1).replyKind,'simli_audio');assert.equal(producer.requests.filter(u=>u.endsWith('/host/mock-video')).length,0);assert.equal(await producer.evaluate('window.hostEvents.filter(e=>e.event==="reply_audio_decoded_end").length'),2);assert.equal(await producer.evaluate('window.hostEvents.filter(e=>e.event==="reply_audio_gate_open").length'),2);}
    if(scenario==='content-audio-reply')assert.deepEqual(session.questions.find(q=>q.questionId===q1).product,session.products[0]);
    const original=v1.questionBodies.find(q=>q.questionId===q1);assert.ok(original);
    const duplicate=await v1.evaluate(`fetch('/api/live/${sid}/questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(original)})}).then(async r=>({status:r.status,data:await r.json()}))`);
    assert.equal(duplicate.status,200);assert.equal(duplicate.data.questionId,q1);
    const before=await v2.evaluate('window.hostFrames.at(-1).frame');await browser.command('Target.closeTarget',{targetId:v2.targetId});
    const late=await page(port,'/live',{context:v2.context});await viewReady(late);
    assert.ok(await late.evaluate(`window.hostFrames.at(-1).frame>${before}`));
    assert.equal(await producer.evaluate('window.hostEvents.filter(e=>e.event==="transport_created").length'),1);
    const q3=await question(v1,'Bỏ qua reply đang phát');
    await until(()=>producer.evaluate('window.hostEvents.filter(e=>e.event==="reply_playing").length===3'),'third reply');
    await producer.evaluate(`fetch('/api/admin/auth/me').then(r=>r.json()).then(x=>fetch('/api/admin/live/${sid}/questions/${q3}/skip',{method:'POST',headers:{'X-CSRF-Token':x.csrf}}))`);
    await until(()=>producer.evaluate('window.hostEvents.filter(e=>e.event==="host_resumed").length===3'),'skip restore');
    for(const viewer of [v1,late]){
      assert.equal(await viewer.evaluate('window.hostFrames.some(x=>x.phase===2)'),true);
      assert.equal(viewer.responses.some(r=>r.status>=200&&r.status<300&&/\/host\/(token|audio|mock-video|reply-audio)|\/live-demo\//.test(r.url)),false);
      assert.equal(await viewer.evaluate('document.querySelectorAll("audio,iframe").length'),0);
    }
    if(capture)for(const [index,p] of [v1,late].entries())if(await p.evaluate('!!window.captureRecorder')){const bytes=await p.evaluate(`(async()=>{window.captureRecorder.stop();await window.captureDone;const b=new Blob(window.captureChunks,{type:window.captureRecorder.mimeType}),a=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s);})()`);await writeFile(output.replace(/[/\\][^/\\]+$/,'')+'/viewer-'+index+'-audio-reply.webm',Buffer.from(bytes,'base64'));}
    await producer.evaluate(`[...document.querySelectorAll('[data-testid=simli-producer] button')].find(b=>b.dataset.testid==='host-stop').click()`,true);
    await until(()=>v1.evaluate('document.querySelector("[data-testid=simli-receiver] video").srcObject===null'),'viewer cleanup after end');
    const events=await producer.evaluate('window.hostEvents');
    results.push({case:'one-producer-two-viewers-question-queue-restore-skip-end-late-join',passed:true,sync,autoplayBlocked:blocked,
      transportCount:events.filter(e=>e.event==='transport_created').length,events,viewerFrames:await v1.evaluate('window.hostFrames'),lateViewerFrames:await late.evaluate('window.hostFrames')});
  }else if(scenario==='early-skip'){
    const q=await question(v1,'Skip while handoff is waiting');
    await until(()=>producer.evaluate('window.hostEvents.some(e=>e.event==="host_yield")'),'pending handoff');
    await producer.evaluate(`fetch('/api/admin/auth/me').then(r=>r.json()).then(x=>fetch('/api/admin/live/${sid}/questions/${q}/skip',{method:'POST',headers:{'X-CSRF-Token':x.csrf}}))`);
    await until(()=>producer.evaluate('window.hostEvents.some(e=>e.event==="host_resumed")'),'cancel pending handoff and restore',18000);
    assert.equal(await producer.evaluate('window.hostEvents.filter(e=>e.event==="reply_playing").length'),0);
    assert.equal((await getSession(v1)).status,'playing');
    assert.equal((await getSession(v1)).questions.find(x=>x.questionId===q).status,'skipped');
    await producer.evaluate(`[...document.querySelectorAll('[data-testid=simli-producer] button')].find(b=>b.dataset.testid==='host-stop').click()`,true);
    results.push({case:'skip-before-handoff-acceptance-never-plays-reply',passed:true,events:await producer.evaluate('window.hostEvents')});
  }else if(scenario==='audio-disconnect'){
    await question(v1,'Transport stop during same-session answer');
    await until(()=>producer.evaluate('window.hostEvents.some(e=>e.event==="reply_playing")'),'audio reply before transport loss');
    await producer.evaluate(`(()=>{const el=document.querySelector('[data-testid=simli-producer]');let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];for(let i=0;fiber&&i<40;fiber=fiber.return,i++)for(let h=fiber.memoizedState,n=0;h&&n<60;h=h.next,n++){const p=h.memoizedState?.current;if(p?.latest?.host?.transport==='mock'&&p.client?.events?.stop){p.client.events.stop();return;}}throw Error('Expected owned mock SDK transport');})()`);
    await until(async()=>(await getSession(v1)).status==='ended','transport loss ends backend');
    await until(()=>v1.evaluate('document.querySelector("[data-testid=simli-receiver] video").srcObject===null'),'viewer cleanup after transport loss');
    await delay(7000);
    const events=await producer.evaluate('window.hostEvents');
    assert.equal(events.filter(e=>e.event==='transport_created').length,1);
    assert.equal(events.filter(e=>e.event==='host_resumed').length,0,'late audio events must not restore a stopped host');
    assert.equal(events.find(e=>e.event==='host_cleanup')?.reason,'transport_stopped');
    results.push({case:'mock-sdk-transport-loss-during-answer-no-late-resume',passed:true,events});
  }else if(scenario==='disconnect'){
    await producer.command('Network.enable');await producer.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await until(async()=>(await getSession(v1)).status==='ended','backend lease expires after producer loss',12000);
    await until(()=>v1.evaluate('document.querySelector("[data-testid=simli-receiver] video").srcObject===null'),'receiver releases after producer loss');
    await producer.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await delay(1000);
    assert.equal(await producer.evaluate('window.hostEvents.filter(e=>e.event==="transport_created").length'),1);
    results.push({case:'producer-disconnect-lease-late-network-no-restart',passed:true,sync,autoplayBlocked:blocked,events:await producer.evaluate('window.hostEvents')});
  }else{
    await question(v1,'Reply media failure');
    await until(async()=>(await getSession(v1)).status==='ended','media failure ends host',15000);
    await until(()=>v2.evaluate('document.querySelector("[data-testid=simli-receiver] video").srcObject===null'),'all receivers cleanup after media failure');
    results.push({case:'reply-media-failure-stops-both-viewers',passed:true,events:await producer.evaluate('window.hostEvents')});
  }
  }
  assert.ok(pages.every(p=>p.external()===0));
}catch(error){
  results.push({case:scenario,passed:false,error:error.message});process.exitCode=1;
  for(const p of pages)try{results.push({http:p.responses.filter(r=>/\/host\//.test(r.url)).map(r=>({path:new URL(r.url).pathname,status:r.status})),debug:await p.evaluate('({body:document.body.innerText,errors:window.pageErrors,receiverEvents:window.receiverEvents,events:window.hostEvents,frames:window.hostFrames.slice(-8)})')});}catch{}
}finally{
  for(const p of pages)try{await p.command('Page.close');}catch{}
  for(const ws of sockets)ws.close();chrome.kill();
  const report={scenario,browserTimerOverrides:process.env.LIVE_SIMLI_TIMER_REPLAY==='true',replayedTimerFloorMs:process.env.LIVE_SIMLI_TIMER_REPLAY==='true'?1000:null,throttlingDisabled:false,source:'real repository Next/API/SSE/MP4/WebRTC; mock Simli only',externalRequests:pages.reduce((n,p)=>n+p.external(),0),results};
  if(output)await writeFile(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({scenario,results:results.map(({events,viewerFrames,lateViewerFrames,debug,...v})=>({...v,debugSummary:debug?.body?.slice(-600)}))},null,2));
}
