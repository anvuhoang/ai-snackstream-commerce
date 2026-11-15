import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {ClockedPcmFeed} from '../src/lib/live/simli/clocked-pcm.mjs';
import {SimliProducer} from '../src/lib/live/simli/producer.mjs';

test('audio render pulses remain 30Hz with varying render quantum; source selection is unchanged',async()=>{
 let Processor;const events=[];
 const context={AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>events.push(data)};}},currentTime:0,sampleRate:48000,registerProcessor:(_name,C)=>Processor=C};
 vm.runInNewContext(await readFile(new URL('../public/live/simli-output-worklet.js',import.meta.url),'utf8'),context);
 for(const quantum of [128,256]){
  events.length=0;const p=new Processor(),out=[new Float32Array(quantum)],input=new Float32Array(quantum).fill(.25);
  p.port.onmessage({data:{kind:'select',owner:'host',id:1}});
  for(let sample=0;sample<96000;sample+=quantum){context.currentTime=sample/48000;p.process([[input],[]],[out]);assert.ok(out[0].every(x=>x===.25));}
  assert.equal(events.filter(e=>e.kind==='clock').length,60);assert.equal(events.filter(e=>e.kind==='probe').length,20);
 }
});

test('clocked feed keeps every PCM sample in order across a 750ms gap, pause/resume and late ticks',()=>{
 const pcm=Uint8Array.from({length:32000*8},(_,i)=>(i*37+i%29)&255),sent=[],progress=[];let completed=0;
 const p=new ClockedPcmFeed({pcm,send:bytes=>sent.push(bytes.slice()),sent:(offset,n,due)=>progress.push({offset,n,due}),complete:()=>completed++});
 p.start(0,0);
 for(let t=1/30;t<8.1;t+=1/30){if(t>=3&&t<3.75)continue;p.tick(t);}
 assert.deepEqual(Buffer.concat(sent.map(x=>Buffer.from(x))),Buffer.from(pcm));assert.equal(completed,1);
 assert.ok(progress.every((x,i)=>!i||x.offset===progress[i-1].offset+x.n));
 const count=sent.length;p.stop();p.tick(1000);assert.equal(sent.length,count);
 sent.length=0;p.start(2.155,10);for(let t=10+1/30;t<16;t+=1/30)p.tick(t);
 assert.deepEqual(Buffer.concat(sent.map(x=>Buffer.from(x))),Buffer.from(pcm.subarray(Math.floor(2.155*16000)*2)));
});

test('cleanup during send invalidates the remaining batch without calling completion',()=>{
 let p,sends=0,completed=0;
 p=new ClockedPcmFeed({pcm:new Uint8Array(320000),send:()=>{sends++;p.stop();},complete:()=>completed++});
 p.start(0,0);p.tick(100);assert.equal(sends,1);assert.equal(completed,0);
});

test('browser producer feed and canvas progress from worklet clock while window timers are clamped',()=>{
 const p=new SimliProducer({onDiagnostic(){}}),pcm=Uint8Array.from({length:32000*4},(_,i)=>i&255),sent=[];
 p.pcm=pcm;p.client={sendAudioData:bytes=>sent.push(bytes.slice())};p.mixer={context:{currentTime:0}};p.coordinator={phase:'host'};
 let draws=0;p.broadcast={draw:()=>draws++};p.feed();
 for(let t=1/30;t<4.1;t+=1/30){p.mixer.context.currentTime=t;p.clock(t);}
 assert.deepEqual(Buffer.concat(sent.map(x=>Buffer.from(x))),Buffer.from(pcm));assert.ok(draws>=120);assert.equal(p.submitted,true);
 const count=sent.length;p.pauseFeed();p.closed=true;p.mixer.context.currentTime=100;p.clock(100);assert.equal(sent.length,count);
});
