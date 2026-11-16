import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pcmEnvelope,pcmEnvelopePhases,PlayoutPosition} from '../src/lib/live/simli/playout-position.mjs';
import {SimliProducer} from '../src/lib/live/simli/producer.mjs';

const fixture=process.env.LIVE_SIMLI_TEST_PCM;
async function input(){const bytes=await readFile(fixture);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}


test('phase-grid regression needs no external media: exact decoded samples stay matchable',()=>{
 const pcm=new ArrayBuffer(32000*6),view=new DataView(pcm);let seed=17,amplitude=.2;
 for(let i=0;i<pcm.byteLength/2;i++){
  if(i%320===0){seed=(1664525*seed+1013904223)>>>0;amplitude=.01+.4*seed/2**32;}
  view.setInt16(i*2,Math.round(amplitude*Math.sin(2*Math.PI*i/16)*32767),true);
 }
 const start=1.51,signal=pcmEnvelope(pcm.slice(Math.round(start*16000)*2)),reference=pcmEnvelope(pcm);
 const legacy=new PlayoutPosition(reference),fixed=new PlayoutPosition(reference,{pcm});legacy.reset(start);fixed.reset(start);
 let oldFirst=null,newFirst=null;
 for(let i=0;i<65;i+=5){
  const time=(i+5)*.02,bins=signal.slice(i,i+5);
  oldFirst??=legacy.observe(bins,time,start+time+.1875);
  newFirst??=fixed.observe(bins,time,start+time+.1875);
 }
 assert.ok(!oldFirst||oldFirst.offset>start+1.35);
 assert.ok(newFirst&&Math.abs(newFirst.offset-(start+1))<.002);
 assert.ok(newFirst.confidence>=.94);assert.equal(fixed.margin,.025);
 assert.equal(new PlayoutPosition(reference,{pcm}).observe(Array(50).fill(0),1,6),null);
 assert.equal(new PlayoutPosition(reference,{pcm}).observe(Array.from({length:50},(_,i)=>.13+.07*Math.sin(i*2.51)),1,6),null);
});

test('unaligned real PCM restores before the existing safety limit without relaxing thresholds',{skip:!fixture},async()=>{
 const pcm=await input(),reference=pcmEnvelope(pcm);let legacyFailures=0;
 for(const start of [3.51,3.21,3.41,3.11])for(let step=0;step<20;step++){
  const phase=step*.001,signal=pcmEnvelope(pcm.slice(Math.floor((start+phase)*16000)*2));
  for(const phased of [false,true]){
   const tracker=new PlayoutPosition(reference,{pcm:phased?pcm:null});tracker.reset(start);
   assert.equal(tracker.confidence,.94);assert.equal(tracker.margin,.025);assert.equal(tracker.windowBins,50);
   let first;
   for(let i=0;i<120;i+=5){const match=tracker.observe(signal.slice(i,i+5),.35+(i+5)*.02,start+(i+5)*.02+.1875);if(match){first={...match,elapsed:(i+5)*.02};break;}}
   if(!phased){if(!first||first.offset>start+1.35)legacyFailures++;}
   else{
    assert.ok(first&&first.offset<=start+1.35,JSON.stringify({start,phase,first}));
    assert.ok(Math.abs(first.offset-(start+phase+first.elapsed))<=.021,JSON.stringify({start,phase,first}));
   }
  }
 }
 assert.ok(legacyFailures>=4,'the unchanged legacy phase grid must reproduce the original failure');
});

test('phase matching follows continuous decoded audio and rejects silence or ambiguous repeats',{skip:!fixture},async()=>{
 const pcm=await input(),tracker=new PlayoutPosition(pcmEnvelope(pcm),{pcm}),signal=pcmEnvelope(pcm.slice(160));
 tracker.reset(.005);let accepted=0,last=0;
 for(let i=0;i+5<signal.length;i+=5){const result=tracker.observe(signal.slice(i,i+5),(i+5)*.02,(i+5)*.02+.1925);
  if(result){accepted++;assert.ok(result.offset>=last-.06);assert.ok(Math.abs(result.offset-(.005+(i+5)*.02))<.04);last=result.offset;}}
 assert.ok(accepted>100);assert.ok(last>40);
 const repeated=new ArrayBuffer(32000*6),view=new DataView(repeated);
 for(let i=0;i<repeated.byteLength/2;i++)view.setInt16(i*2,Math.round((.1+.08*Math.sin(2*Math.PI*i/6400))*Math.sin(2*Math.PI*i/80)*32767),true);
 const ambiguous=new PlayoutPosition(pcmEnvelope(repeated),{pcm:repeated}),pattern=pcmEnvelope(repeated);
 assert.equal(ambiguous.observe(pattern.slice(0,50),1,6),null);
 assert.equal(new PlayoutPosition(pcmEnvelope(pcm),{pcm}).observe(Array(50).fill(0),1,10),null);
 assert.equal(pcmEnvelopePhases(pcm).length,20);
});

test('existing PCM scheduler preserves every sample and cleanup invalidates queued sends under 750ms stall',()=>{
 const saved=[globalThis.performance,globalThis.setTimeout,globalThis.clearTimeout];let clock=0,id=0;const tasks=new Map(),sent=[];
 globalThis.performance={now:()=>clock};globalThis.setTimeout=(fn,ms)=>{const n=++id;tasks.set(n,{fn,at:clock+ms});return n;};globalThis.clearTimeout=n=>tasks.delete(n);
 try{
  const p=new SimliProducer({onDiagnostic(){}});p.pcm=Uint8Array.from({length:32000*8},(_,i)=>(i*17+i%23)&255);p.coordinator={phase:'host'};p.client={sendAudioData:bytes=>sent.push(bytes.slice())};
  p.feed(0);let stalled=false;
  while(p.sent<8){const [key,task]=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];tasks.delete(key);clock=Math.max(clock,task.at);if(!stalled&&clock>=3000){clock+=750;stalled=true;}task.fn();}
  assert.deepEqual(Buffer.concat(sent.map(x=>Buffer.from(x))),Buffer.from(p.pcm));
  const queued=[...tasks.values()].map(x=>x.fn),count=sent.length;p.pauseFeed();for(const fn of queued)fn();assert.equal(sent.length,count);
 }finally{[globalThis.performance,globalThis.setTimeout,globalThis.clearTimeout]=saved;}
});
