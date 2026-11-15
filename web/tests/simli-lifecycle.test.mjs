import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {HostTransport} from '../src/lib/live/simli/transport-lifecycle.mjs';
import {SimliProducer} from '../src/lib/live/simli/producer.mjs';
import {OutputMixer} from '../src/lib/live/simli/output-mixer.mjs';

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

// Run the installed, pinned SDK code unchanged. Replace only transport/network,
// AudioContext and timers; this exercises its actual retry/backoff/reset path.
function sdkFixture(){
  const metadata=JSON.parse(readFileSync(new URL('../node_modules/simli-client/package.json',import.meta.url)));
  assert.equal(metadata.version,'3.2.0');
  const counters={constructed:0,connections:0,joins:0,disconnected:0,contextsClosed:0};
  const timers=new Map();let next=0,now=0;
  class Transport {
    constructor(){
      counters.constructed++;this.events=new Map();
      this.pc={connect:async()=>{counters.joins++;}};
      this.signalingConnection={connect:async()=>{counters.connections++;}};
    }
    on(name,fn){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(fn);}
    off(){}
    emit(name,...args){for(const cb of this.events.get(name)??[])cb(...args);}
    async connect(){for(const cb of this.events.get('startup_error')??[])cb('fake socket failure');throw Error('fake socket failure');}
    async disconnect(){counters.disconnected++;}
    async join_lk_room(){await this.pc.connect();}
  }
  class Logger {debug(){}info(){}warn(){}error(){}}
  const exports={};
  const clock={setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id)};
  const context={exports,require:name=>name.includes('Logger')?{Logger,LogLevel:{CRITICAL:0}}:{LivekitTransport:Transport,P2PTransport:Transport},
    window:{AudioContext:class{async close(){counters.contextsClosed++;}}},...clock,Math:Object.assign(Object.create(Math),{random:()=>0})};
  vm.runInNewContext(readFileSync(new URL('../node_modules/simli-client/dist/client.js',import.meta.url),'utf8'),context);
  return {sdk:{SimliClient:exports.SimliClient,LogLevel:{CRITICAL:0}},counters,timers,
    advance:async(ms)=>{now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();await flush();}}};
}

for(const reason of ['manual','unmounted','startup_timeout']){
  test(`${reason} while SDK import is pending never constructs SDK or starts a connection`,async()=>{
    const imported=deferred();let constructed=0;
    const transport=new HostTransport({loadSimli:()=>imported.promise});
    const pending=transport.create({transport:'simli',sessionToken:'synthetic-test'},null,null);
    await transport.stop();
    imported.resolve({SimliClient:class{constructor(){constructed++;}},LogLevel:{CRITICAL:0}});
    assert.equal(await pending,null);assert.equal(constructed,0);
    assert.equal(await transport.create({transport:'simli'},null,null),null);
  });

  test(`${reason} during actual SDK 3.2.0 backoff blocks reset constructor and delayed join`,async()=>{
    const f=sdkFixture();const transport=new HostTransport({loadSimli:async()=>f.sdk});
    const client=await transport.create({transport:'simli',sessionToken:'synthetic-test'},null,null);
    const start=client.start().catch(error=>error);await flush();
    assert.equal(f.counters.constructed,1);
    assert.ok([...f.timers.values()].some(x=>x.at===1000),'actual SDK reached its retry backoff');
    // A callback queued before stop retains the method, so fence the Room too.
    const queuedJoin=client.connection.join_lk_room.bind(client.connection);
    await transport.stop();
    await assert.rejects(queuedJoin(),/host_transport_closed/);
    await f.advance(20000);await start;
    assert.equal(f.counters.constructed,1);assert.equal(f.counters.joins,0);
    await assert.rejects(client.start(),/host_transport_closed/);
    assert.equal(f.counters.contextsClosed,1);
  });
}

test('baseline SDK 3.2.0 really creates another transport after stop in backoff',async()=>{
  const f=sdkFixture();const client=new f.sdk.SimliClient('synthetic',null,null);
  const start=client.start().catch(error=>error);await flush();await client.stop();
  await f.advance(1000);await start;
  assert.equal(f.counters.constructed,2,'control proves the reviewed SDK race without the terminal adapter');
  await client.stop();
});

test('generation invalidated during import cannot run constructor',async()=>{
  let active=true,constructed=0;const imported=deferred();
  const transport=new HostTransport({loadSimli:()=>imported.promise});
  const pending=transport.create({transport:'simli'},null,null,()=>active);
  active=false;imported.resolve({SimliClient:class{constructor(){constructed++;}},LogLevel:{CRITICAL:0}});
  assert.equal(await pending,null);assert.equal(constructed,0);await transport.stop();
});

test('terminal guard survives a hanging SDK stop and a late retry callback',async()=>{
  let resets=0,connections=0;const hanging=deferred();
  class SDK {
    constructor(){this.connection={pc:{connect:()=>{connections++;}}};this.watchConnection();}
    watchConnection(){}
    resetConnections(){resets++;this.connection.pc.connect();}
    async start(){this.resetConnections();}
    stop(){return hanging.promise;}
  }
  const transport=new HostTransport({loadSimli:async()=>({SimliClient:SDK,LogLevel:{CRITICAL:0}})});
  const client=await transport.create({transport:'simli'},null,null);
  const stopped=transport.stop();client.resetConnections();
  await assert.rejects(client.start(),/host_transport_closed/);
  assert.equal(resets,0);assert.equal(connections,0);hanging.resolve();await stopped;
});

for(const reason of ['manual','unmounted','startup_timeout']){
  test(`producer ${reason} wires cleanup to pending SDK import, not just the 3s wait`,async()=>{
    const original=OutputMixer.prototype.start;OutputMixer.prototype.start=async function(){};
    const imported=deferred();let loading=false,constructed=0,backendStops=0;
    const media=()=>({addEventListener(){},removeEventListener(){},pause(){},load(){},removeAttribute(){},srcObject:null});
    const producer=new SimliProducer({liveId:'lifecycle-test',csrf:'synthetic',canvas:null,hostVideo:media(),hostAudio:media(),replyVideo:media(),onState(){},onSession(){},onDiagnostic(){}});
    producer.transport=new HostTransport({loadSimli:()=>{loading=true;return imported.promise;}});
    producer.api=async(suffix,body)=>{
      if(suffix==='acquire')return {leaseId:'synthetic-lease',session:{questions:[]}};
      if(suffix==='token')return {transport:'simli',sessionToken:'synthetic-token'};
      if(suffix==='audio')return new ArrayBuffer(32000);
      if(body.action==='stop')backendStops++;
      return {};
    };
    try{
      const started=producer.start();await flush();assert.ok(loading);
      await producer.stop(reason);
      imported.resolve({SimliClient:class{constructor(){constructed++;}},LogLevel:{CRITICAL:0}});
      await started;await producer.start();assert.equal(constructed,0);assert.equal(backendStops,1);
    }finally{OutputMixer.prototype.start=original;await producer.stop();}
  });
}

test('producer 3-second fallback keeps terminal guard while SDK stop is still pending',async()=>{
  const f=sdkFixture(),hanging=deferred(),events=[];
  const transport=new HostTransport({loadSimli:async()=>f.sdk});
  const client=await transport.create({transport:'simli',sessionToken:'synthetic'},null,null);
  const started=client.start().catch(error=>error);await flush();
  client.connection.disconnect=()=>hanging.promise;
  const media=()=>({pause(){},load(){},removeAttribute(){},srcObject:null});
  const producer=new SimliProducer({liveId:'late-retry-test',csrf:'synthetic',canvas:null,hostVideo:media(),hostAudio:media(),replyVideo:media(),onState(){},onSession(){},onDiagnostic:data=>events.push(data)});
  producer.transport=transport;producer.client=client;
  await producer.stop('unmounted');
  assert.equal(events.find(e=>e.event==='host_cleanup').sdkDisconnect,'timeout');
  await f.advance(20000);await started;
  assert.equal(f.counters.constructed,1,'retry waking after the UI cleanup timeout creates no transport');
  hanging.resolve();await transport.stop();
});

test('actual producer startup timer cancels a pending import',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const original=OutputMixer.prototype.start;OutputMixer.prototype.start=async function(){};
  const imported=deferred();let loading=false,constructed=0;const events=[];
  const media=()=>({addEventListener(){},removeEventListener(){},pause(){},load(){},removeAttribute(){},srcObject:null});
  const producer=new SimliProducer({liveId:'startup-timer-test',csrf:'synthetic',canvas:null,hostVideo:media(),hostAudio:media(),replyVideo:media(),onState(){},onSession(){},onDiagnostic:data=>events.push(data)});
  producer.transport=new HostTransport({loadSimli:()=>{loading=true;return imported.promise;}});
  producer.api=async suffix=>suffix==='acquire'?{leaseId:'synthetic',session:{questions:[]}}:suffix==='token'?{transport:'simli'}:suffix==='audio'?new ArrayBuffer(32000):{};
  try{
    const started=producer.start();await flush();assert.ok(loading);
    t.mock.timers.tick(20000);await flush();await producer.stop();
    imported.resolve({SimliClient:class{constructor(){constructed++;}},LogLevel:{CRITICAL:0}});
    await started;assert.equal(constructed,0);
    assert.equal(events.find(e=>e.event==='host_cleanup').reason,'startup_timeout');
  }finally{OutputMixer.prototype.start=original;await producer.stop();t.mock.timers.reset();}
});

test('actual SDK readiness waits for its first-frame event, not just a connected transport',async()=>{
 const f=sdkFixture(),client=new f.sdk.SimliClient('synthetic',null,null);
 client.connection.connect=async()=>{};let ready=false;
 const pending=client.start().then(()=>{ready=true;});
 await flush();assert.equal(ready,false);
 // A decoded track can exist while the compositor callback is suppressed.
 // The SDK's own event is what actually resolves its promise.
 for(const cb of client.connection.events.get('start')??[])cb();
 await pending;assert.equal(ready,true);await client.stop();
});


function decodedFixture(){
  const f=sdkFixture(),observers=[],notifications=[];
  const transport=new HostTransport({loadSimli:async()=>f.sdk,onDecodedReady:()=>notifications.push('decoded'),
    observeDecoded:(_media,callback)=>{
      const observer={frame:null,closed:false,close(){this.closed=true;},deliver(frame){this.frame=frame;callback();}};
      observers.push(observer);return observer;
    }});
  const media={addEventListener(){},removeEventListener(){}};
  return {...f,transport,media,observers,notifications};
}
const realFrame=()=>({displayWidth:768,displayHeight:768});

test('actual SDK starts from a decoded track without any compositor callback; empty frames cannot ready it',async()=>{
  const f=decodedFixture(),client=await f.transport.create({transport:'simli'},f.media,null);
  client.connection.connect=async()=>{};let ready=false;
  const pending=client.start().then(()=>{ready=true;});await flush();
  f.observers[0].deliver(null);f.observers[0].deliver({displayWidth:0,displayHeight:768});
  await flush();assert.equal(ready,false);assert.equal(f.notifications.length,0);
  f.observers[0].deliver(realFrame());await pending;
  assert.equal(ready,true);assert.equal(client.started,true);assert.equal(f.observers[0].closed,true);
  assert.equal(f.timers.size,0,'SDK startup timeout is cleared by its own start handler');
  f.observers[0].deliver(realFrame());client.connection.emit('start');
  assert.equal(f.notifications.length,1,'late native callback does not re-admit readiness');
  await f.transport.stop();assert.equal(f.counters.constructed,1);
});

test('native SDK first-frame readiness still works and closes decoded observer',async()=>{
  const f=decodedFixture(),client=await f.transport.create({transport:'simli'},f.media,null);
  client.connection.connect=async()=>{};const pending=client.start();await flush();
  client.connection.emit('start');await pending;
  assert.equal(f.observers[0].closed,true);assert.equal(f.notifications.length,0);
  await f.transport.stop();
});

for(const reason of ['manual','unmounted','startup_timeout']){
  test(reason+' closes startup reader and a queued decoded frame cannot restart SDK',async()=>{
    const f=decodedFixture();let current=true;
    const client=await f.transport.create({transport:'simli'},f.media,null,()=>current);
    client.connection.connect=async()=>{};
    if(reason==='unmounted')current=false;
    await f.transport.stop();f.observers[0].deliver(realFrame());
    assert.equal(f.observers[0].closed,true);assert.equal(client.started,false);
    assert.equal(f.notifications.length,0);assert.equal(f.counters.constructed,1);
    await assert.rejects(client.start(),/host_transport_closed/);
  });
}

test('decoded frames from a failed attempt or old transport never revive that attempt or its replacement',async()=>{
  const f=decodedFixture(),client=await f.transport.create({transport:'simli'},f.media,null);
  const started=client.start().catch(error=>error);await flush();
  f.observers[0].deliver(realFrame());
  assert.equal(client.started,false,'startup_error is not overridden by a late frame');
  client.resetConnections(null,null,null);
  assert.equal(f.observers[0].closed,true);assert.equal(f.observers.length,2);
  f.observers[0].deliver(realFrame());
  assert.equal(client.started,false,'prior connection cannot resolve replacement readiness');
  f.observers[1].deliver(realFrame());
  assert.equal(client.started,true);assert.equal(f.notifications.length,1);
  await f.transport.stop();await f.advance(20000);await started;
  assert.equal(f.counters.constructed,2,'cleanup blocks SDK backoff from creating another transport');
});
