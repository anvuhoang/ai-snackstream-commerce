import {test} from 'node:test';import assert from 'node:assert/strict';
import {VideoFrameSource} from '../src/lib/live/simli/video-frame-source.mjs';
import {HostBroadcast,preferBroadcastVideoCodec} from '../src/lib/live/simli/broadcast.mjs';
const turn=()=>new Promise(r=>setImmediate(r));
function track(){const original={stops:0,clone(){const clone={stops:0,stop(){this.stops++;}};this.lastClone=clone;return clone;},stop(){this.stops++;}};return original;}
function media(source){const handlers=new Map();return {srcObject:source?{getVideoTracks:()=>[source]}:null,src:'',readyState:2,addEventListener:(k,f)=>handlers.set(k,f),removeEventListener:k=>handlers.delete(k),fire:k=>handlers.get(k)?.()};}
function readers(){const list=[];class Processor{constructor(options){assert.ok(options.track);const r={resolve:null,read(){return new Promise(resolve=>{this.resolve=resolve;});},cancel(){this.canceled=true;return Promise.resolve();},releaseLock(){this.released=true;}};list.push(r);this.readable={getReader:()=>r};}}return {Processor,list};}
const frame=n=>({timestamp:n*40000,displayWidth:768,displayHeight:768,closes:0,close(){this.closes++;}});
test('decoded reader updates exactly once per frame and frees every retained frame on cleanup',async()=>{
 const source=track(),m=media(source),fake=readers();let paints=0;const p=new VideoFrameSource(m,()=>paints++,{Processor:fake.Processor});
 const a=frame(1),b=frame(2);fake.list[0].resolve({value:a,done:false});await turn();fake.list[0].resolve({value:b,done:false});await turn();assert.equal(paints,2);assert.equal(a.closes,1);assert.equal(b.closes,0);
 p.close();assert.equal(b.closes,1);assert.equal(source.stops,0);assert.equal(source.lastClone.stops,1);assert.equal(fake.list[0].canceled,true);
 const late=frame(3);fake.list[0].resolve({value:late,done:false});await turn();assert.equal(late.closes,1);assert.equal(paints,2);
});
test('replaced tracks invalidate a pending reader without stopping either SDK original',async()=>{
 const a=track(),b=track(),m=media(a),fake=readers();let paints=0;const p=new VideoFrameSource(m,()=>paints++,{Processor:fake.Processor});
 m.srcObject={getVideoTracks:()=>[b]};m.fire('playing');const stale=frame(1);fake.list[0].resolve({value:stale,done:false});await turn();assert.equal(stale.closes,1);assert.equal(paints,0);assert.equal(a.stops,0);
 fake.list[1].resolve({value:frame(2),done:false});await turn();assert.equal(paints,1);p.close();assert.equal(b.stops,0);
});
test('missing or rejected processor leaves the existing fallback available',()=>{
 const m=media(track());const missing=new VideoFrameSource(m,()=>{},{Processor:null});assert.equal(missing.active,false);missing.close();
 const bad=new VideoFrameSource(m,()=>{},{Processor:class{constructor(){throw Error('not supported');}}});assert.equal(bad.active,false);assert.equal(m.srcObject.getVideoTracks()[0].stops,0);bad.close();
});
test('25 decoded frames do not become 30 repeated canvas frames; owner/phase changes paint immediately',()=>{
 let requests=0;const paints=[],ctx={fillRect(){},fillText(){},drawImage(f){paints.push(f.timestamp);}},source={active:true,version:0,frame:frame(0),connect(){}},reply={active:true,version:0,frame:frame(100),connect(){}};
 const p=Object.assign(Object.create(HostBroadcast.prototype),{sources:{host:source,reply},captureTrack:{requestFrame(){requests++;}},canvas:{width:768,height:768,getContext:()=>ctx},mixer:{owner:'host'},coordinator:{phase:'host'},hostVideo:{},replyVideo:{},drawMetrics:{calls:0,maxGapMs:0,maxDrawMs:0},closed:false});
 p.draw();const schedule=[];for(let i=1;i<=30;i++)schedule.push({time:i/30,type:'clock'});for(let i=1;i<=25;i++)schedule.push({time:i/25,type:'frame',i});
 for(const e of schedule.sort((a,b)=>a.time-b.time)){if(e.type==='frame'){source.version++;source.frame=frame(e.i);}p.draw();}
 assert.equal(p.drawMetrics.calls,26);assert.equal(requests,26);assert.equal(new Set(paints).size,26);
 p.mixer.owner='reply';p.coordinator.phase='reply';p.draw();assert.equal(paints.at(-1),frame(100).timestamp);p.draw();assert.equal(p.drawMetrics.calls,27);
 p.mixer.owner='none';p.coordinator.phase='resuming';p.draw();assert.equal(p.drawMetrics.calls,28);p.closed=true;source.version++;p.draw();assert.equal(p.drawMetrics.calls,28);assert.equal(requests,28);
});

test('manual canvas capture publishes each paint; unsupported requestFrame keeps the timed fallback and releases its unused track',()=>{
 const previous=globalThis.MediaStream;globalThis.MediaStream=class{constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}};
 try{for(const manual of [true,false]){
   const rates=[],tracks=[];let requests=0;
   const canvas={getContext:()=>({fillRect(){},fillText(){}}),captureStream(rate){rates.push(rate);const t={kind:'video',stops:0,stop(){this.stops++;}};if(manual)t.requestFrame=()=>requests++;tracks.push(t);return new MediaStream([t]);}};
   const m=media(null);m.readyState=0;
   const broadcast=new HostBroadcast({canvas,hostVideo:m,replyVideo:media(null),mixer:{owner:'none',exportStream:{getAudioTracks:()=>[]}},coordinator:{phase:'host'},externallyClocked:true});
   assert.deepEqual(rates,manual?[0]:[0,30]);assert.equal(broadcast.drawMetrics.captureMode,manual?'per-paint':'periodic-fallback');
   broadcast.draw();assert.equal(requests,manual?2:0);broadcast.close();broadcast.draw();assert.equal(requests,manual?2:0);assert.ok(tracks.every(t=>t.stops===1));
 }}finally{if(previous===undefined)delete globalThis.MediaStream;else globalThis.MediaStream=previous;}
});

test('video codec preference retains fallbacks/RTX/FEC, leaves audio alone and is set before offer',()=>{
 const vp8={mimeType:'video/VP8'},h264={mimeType:'video/H264'},rtx={mimeType:'video/rtx'},red={mimeType:'video/red'},codecs=[vp8,rtx,h264,red];let ordered=null;
 const pc={getTransceivers:()=>[{sender:{track:{kind:'audio'}},setCodecPreferences(){assert.fail('audio changed');}},{sender:{track:{kind:'video'}},setCodecPreferences(value){ordered=value;}}]};
 assert.equal(preferBroadcastVideoCodec(pc,{getCapabilities:()=>({codecs})}),true);assert.deepEqual(ordered,[h264,vp8,rtx,red]);assert.deepEqual(codecs,[vp8,rtx,h264,red]);
});
test('missing H264/API or a rejected preference keeps browser negotiation available',()=>{
 const pc={getTransceivers:()=>[{sender:{track:{kind:'video'}},setCodecPreferences(){throw Error('unsupported');}}]};
 assert.equal(preferBroadcastVideoCodec(pc,null),false);assert.equal(preferBroadcastVideoCodec(pc,{getCapabilities:()=>({codecs:[{mimeType:'video/VP8'}]})}),false);
 assert.equal(preferBroadcastVideoCodec(pc,{getCapabilities:()=>({codecs:[{mimeType:'video/H264'}]})}),false);
 assert.equal(preferBroadcastVideoCodec({getTransceivers:()=>[{sender:{track:{kind:'video'}}}]},{getCapabilities:()=>({codecs:[{mimeType:'video/H264'}]})}),false);
});
