import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PcmReplyPlayer} from '../src/lib/live/simli/pcm-reply-player.mjs';
import {pcmEnvelope,pcmEnvelopePhases} from '../src/lib/live/simli/playout-position.mjs';
import {ReplyCoordinator} from '../src/lib/live/simli/reply-coordinator.mjs';

function pcm(seconds,seed=17){
  const b=new ArrayBuffer(32000*seconds),v=new DataView(b);let amplitude=0;
  for(let i=0;i<b.byteLength/2;i++){
    if(i%320===0){seed=(seed*1664525+1013904223)>>>0;amplitude=.01+.4*seed/2**32;}
    v.setInt16(i*2,Math.round(amplitude*Math.sin(2*Math.PI*i/16)*32767),true);
  }return b;
}
function fixture(load=async()=>pcm(3,91)){
  const context={currentTime:0},events=[];let fed=null,paused=0,ended=0;
  const p=new PcmReplyPlayer({pcm:pcm(10),mixer:{context},load,quiet:()=>true,
    feed:{start:buffer=>{fed=buffer;},pause:()=>paused++,sentBound:()=>fed.byteLength/32000},diagnostic:(event,data)=>events.push({event,...data})});
  p.onEnded(()=>ended++);
  return {p,context,events,get ended(){return ended;},get paused(){return paused;}};
}
const descriptor={questionId:'audio-question-test',replyKind:'simli_audio',audioDurationSeconds:3};
const flush=()=>new Promise(r=>setImmediate(r));

test('answer uses observed prefix, keeps all reply samples, and ends from decoded output',async()=>{
  const f=fixture(),{p,context}=f;let opened=false;
  const started=p.playFromStart(descriptor,{resumeOffset:6.7}).then(()=>opened=true);await flush();
  try{
    assert.equal(p.prefixSeconds,1.5);assert.equal(p.buffer.byteLength,32000*4.5);
    assert.deepEqual(new Uint8Array(p.buffer,48000),new Uint8Array(pcm(3,91)));
    assert.equal(opened,false,'sending/buffering alone cannot open the output');
    const bins=pcmEnvelope(p.buffer);
    for(let i=0;i<60;i+=5){context.currentTime=(i+5)*.02;p.probe({bins:bins.slice(i,i+5),time:context.currentTime});}
    await started;assert.equal(opened,true);p.selected({time:context.currentTime});
    assert.equal(f.events.at(-1).event,'reply_audio_gate_open');assert.equal(p.position(),0);
    for(let i=60;i<bins.length;i+=5){context.currentTime=(i+5)*.02;p.probe({bins:bins.slice(i,i+5),time:context.currentTime});}
    assert.equal(f.ended,0,'last queued sample is not evidence of a completed playout');
    for(let i=0;i<8;i++){context.currentTime+=.1;p.probe({bins:Array(5).fill(0),time:context.currentTime});}
    assert.equal(f.ended,1);assert.equal(f.events.at(-1).event,'reply_audio_decoded_end');
    context.currentTime+=1;p.probe({bins:Array(5).fill(0),time:context.currentTime});assert.equal(f.ended,1);
  }finally{p.pause();}
});

test('late audio fetch after stop cannot feed or play',async()=>{
  let deliver;const f=fixture(()=>new Promise(r=>deliver=r));
  const started=f.p.playFromStart(descriptor,{resumeOffset:6.7});f.p.pause();deliver(pcm(3,91));
  await assert.rejects(started,/canceled/);assert.equal(f.p.active,false);assert.equal(f.p.buffer,undefined);
});

test('wrong duration or malformed bytes fail closed before feeding',async()=>{
  for(const audio of [new ArrayBuffer(3),pcm(2)]){
    const f=fixture(async()=>audio);await assert.rejects(f.p.playFromStart(descriptor,{resumeOffset:6.7}),/duration/);assert.equal(f.p.active,false);
  }
});

test('stalled probe cannot open answer after its first samples were missed',async()=>{
  const {p,context}=fixture();const started=p.playFromStart(descriptor,{resumeOffset:6.7});await flush();
  try{
    const bins=pcmEnvelope(p.buffer);
    for(let i=0;i<55;i+=5){context.currentTime=(i+5)*.02;p.probe({bins:bins.slice(i,i+5),time:context.currentTime});}
    context.currentTime=1.95;p.probe({bins:bins.slice(55,60),time:1.2});
    await assert.rejects(started,/alignment_unsafe/);
  }finally{p.pause();}
});

test('cancel and end revoke pending answer gates and cannot emit late ended',async()=>{
  const f=fixture();const started=f.p.playFromStart(descriptor,{resumeOffset:6.7});await flush();f.p.pause();
  await assert.rejects(started,/canceled/);f.p.probe({bins:Array(5).fill(.1),time:10});assert.equal(f.ended,0);assert.equal(f.p.active,false);
});

test('coordinator uses host output for Simli answer and restores through existing path',async()=>{
  const selected=[],events=[];let played=0,cleared=0,restored=0;
  const mixer={owner:'host',context:{currentTime:0},latency:()=>0,select:async owner=>{selected.push(owner);mixer.owner=owner;return {time:0};},silenceNow(){}};
  const audio={onEnded(cb){this.ended=cb;},onError(){},visible(){},pause(){},position:()=>0,playFromStart:async()=>played++,selected(){}};
  const video={onEnded(){},onError(){},pause(){},playFromStart:()=>assert.fail('MP4 must not play'),visible(){}};
  const c=new ReplyCoordinator({pcm:pcm(10),mixer,hostVideo:{},media:{},player:video,audioPlayer:audio,
    feed:{pause(){},sentBound:()=>10},clearBuffer:()=>cleared++,emit:e=>events.push(e),fail:()=>assert.fail('must not fail')});
  c.ready=()=>true;c.tracker.snapshot=()=>({observedOffset:6.926,resumeOffset:6.726,confidence:1});
  c.resume=async()=>restored++;
  assert.equal(await c.request(descriptor),true);assert.equal(played,1);assert.deepEqual(selected,['none','host']);assert.equal(cleared,1);
  audio.ended();assert.equal(restored,1);c.stop();audio.ended();assert.equal(restored,1);
});


test('a completed narration can supply a muted prefix without changing its saved EOF offset',async()=>{
  const host=pcm(10),view=new Uint8Array(host);view.fill(0,8*32000);
  const {p}=fixture();p.pcm=host;const saved={resumeOffset:10,observedOffset:10};
  const started=p.playFromStart(descriptor,saved);await flush();
  assert.equal(p.active,true);assert.deepEqual(saved,{resumeOffset:10,observedOffset:10});
  assert.deepEqual(new Uint8Array(p.buffer,48000),new Uint8Array(pcm(3,91)));
  p.pause();await assert.rejects(started,/canceled/);
});


function repeatedShortAnswer(){
  const raw=new Uint8Array(pcm(2.0898125,91)),cycle=raw.slice(0,.16*32000);
  for(let i=cycle.length;i<raw.length;i++)raw[i]=cycle[i%cycle.length];
  return raw.buffer;
}
function decodedBins(buffer,phase=0){
  const padded=new Uint8Array(buffer.byteLength+64000);padded.set(new Uint8Array(buffer));
  return pcmEnvelopePhases(padded.buffer)[Math.round(phase/.001)].bins;
}
async function deliver(p,context,bins,phase=0){
  for(let i=0;i<bins.length;i+=5){
    context.currentTime=(i+5)*.02+phase;
    p.probe({bins:bins.slice(i,i+5),time:context.currentTime});
    await flush();
  }
}

test('short repeated answer crosses observed EOF at unchanged confidence and restores once, including off-grid decoder phases',async()=>{
  for(const phase of [0,.009,.019]){
    const raw=repeatedShortAnswer(),f=fixture(async()=>raw),{p,context}=f;
    const started=p.playFromStart({...descriptor,audioDurationSeconds:raw.byteLength/32000},{resumeOffset:6.7});await flush();
    try{
      assert.equal(f.ended,0,'all bytes being sent never completes an answer');
      assert.deepEqual(new Uint8Array(p.buffer,48000),new Uint8Array(raw),'not a single answer sample is removed or padding transmitted');
      await deliver(p,context,decodedBins(p.buffer,phase),phase);await started;
      assert.equal(f.ended,1);assert.equal(p.position(),raw.byteLength/32000);
      const end=f.events.find(e=>e.event==='reply_audio_decoded_end');
      assert.ok(end.matchedOffset>=end.contentEnd);
      assert.ok(end.confidence>=.94);
      assert.equal(p.tracker.margin,.025);assert.equal(p.tracker.windowBins,50);
    }finally{p.pause();}
  }
});

test('quiet after a truncated answer cannot substitute for observing its final speech window',async()=>{
  const raw=pcm(3,91),f=fixture(async()=>raw),{p,context}=f;
  const started=p.playFromStart(descriptor,{resumeOffset:6.7});await flush();
  try{
    const output=new Uint8Array(p.buffer.byteLength+64000);output.set(new Uint8Array(p.buffer));
    output.fill(0,Math.floor(2.3*32000));
    await deliver(p,context,pcmEnvelope(output.buffer));await started;
    assert.equal(f.ended,0);assert.equal(p.active,true);
    assert.ok(p.tracker.last.offset<p.contentEnd);
  }finally{p.pause();}
});

test('missing decoded probes still time out, report the last observation and never complete from sent bytes',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(async()=>repeatedShortAnswer()),{p}=f;let errors=0;p.onError(()=>errors++);
  const started=p.playFromStart({...descriptor,audioDurationSeconds:2.0898125},{resumeOffset:6.7});await flush();
  const canceled=assert.rejects(started,/canceled/);
  t.mock.timers.tick(15000);await canceled;
  assert.equal(errors,1);assert.equal(f.ended,0);
  assert.equal(f.events.at(-1).event,'reply_audio_end_timeout');assert.equal(f.events.at(-1).matchedOffset,null);
  p.probe({bins:Array(5).fill(0),time:20});assert.equal(f.ended,0);p.pause();t.mock.timers.reset();
});

test('real PCM reply player completes then runs the existing coordinator preroll and restores saved host position',async()=>{
  const host=pcm(10),answer=repeatedShortAnswer(),events=[],context={currentTime:0};
  let buffer,selected='host',observedStart=0;
  const mixer={context,owner:'host',latency:()=>0,
    select:async owner=>{selected=owner;mixer.owner=owner;return {time:context.currentTime};},silenceNow(){selected='none';}};
  const feed={pause(){},start(value){if(typeof value==='number'){observedStart=value;buffer=host.slice(Math.floor(value*16000)*2);}else buffer=value;},sentBound:()=>typeof buffer==='object'?buffer.byteLength/32000+observedStart:10};
  const player=new PcmReplyPlayer({pcm:host,mixer,feed,load:async()=>answer,quiet:()=>true,diagnostic:(event,data)=>events.push({event,...data})});
  const coordinator=new ReplyCoordinator({pcm:host,mixer,hostVideo:{},media:{},
    player:{onEnded(){},onError(){},visible(){},pause(){}},audioPlayer:player,feed,clearBuffer(){},
    emit:event=>events.push(event),fail:code=>assert.fail(code)});
  const originalSnapshot=coordinator.tracker.snapshot.bind(coordinator.tracker);
  coordinator.tracker.snapshot=()=>({observedOffset:6.926,resumeOffset:6.726,confidence:1});
  const originalReady=coordinator.ready.bind(coordinator);coordinator.ready=()=>true;
  const request=coordinator.request({...descriptor,audioDurationSeconds:answer.byteLength/32000});
  await flush();
  const output=decodedBins(buffer);
  for(let i=0;i<output.length;i+=5){
    context.currentTime=(i+5)*.02;coordinator.probe({bins:output.slice(i,i+5),time:context.currentTime});await flush();
    if(coordinator.phase==='resuming')break;
  }
  assert.equal(await request,true);
  coordinator.tracker.snapshot=originalSnapshot;coordinator.ready=originalReady;
  await flush();
  assert.equal(coordinator.phase,'resuming');assert.equal(selected,'none');
  assert.ok(events.some(e=>e.event==='resume_preroll_started'));
  const resumedBins=decodedBins(buffer),originTime=context.currentTime;
  for(let i=0;i<resumedBins.length&&coordinator.phase==='resuming';i+=5){
    context.currentTime=originTime+(i+5)*.02;
    coordinator.probe({bins:resumedBins.slice(i,i+5),time:context.currentTime});await flush();
  }
  assert.equal(coordinator.phase,'host');assert.equal(selected,'host');
  const restored=events.find(e=>e.event==='host_resumed');
  assert.ok(Math.abs(restored.observedResumeOffset-6.726)<=.15);
  assert.equal(events.filter(e=>e.event==='reply_ended').length,1);
  coordinator.stop();
});
