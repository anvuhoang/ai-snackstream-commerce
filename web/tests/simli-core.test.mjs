import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pcmEnvelope,PlayoutPosition} from '../src/lib/live/simli/playout-position.mjs';
import {SimliProducer} from '../src/lib/live/simli/producer.mjs';
import {ReplyCoordinator} from '../src/lib/live/simli/reply-coordinator.mjs';
test('position requires decoded output, not sent PCM',()=>{
  let seed=123456;
  const values=Array.from({length:200},()=>{seed=(seed*1664525+1013904223)>>>0;return .01+seed/2**32*.03;});
  const matcher=new PlayoutPosition(values);
  assert.equal(matcher.snapshot(100),null);
  for(let i=0;i<10;i++)matcher.observe(values.slice(i*5,i*5+5),i*.1+.1,4);
  assert.ok(matcher.last);assert.ok(matcher.snapshot(1,.1));
  assert.equal(matcher.snapshot(3),null);
  assert.equal(pcmEnvelope(new ArrayBuffer(640)).length,1);
});

test('producer ignores repeated/stale ready snapshots and late snapshots after end',async()=>{
  let played=0,stopped=0;
  const e=new SimliProducer({liveId:'session-test',csrf:'synthetic',canvas:null,hostVideo:null,hostAudio:null,replyVideo:null,onState:()=>{},onSession:()=>{},onDiagnostic:()=>{}});
  e.coordinator={ready:()=>true,request:async()=>{played++;return true;}};
  e.stop=()=>{stopped++;e.closed=true;};
  const snapshot={liveId:'session-test',status:'playing',host:{epoch:'epoch-test',revision:3,phase:'script'},questions:[{questionId:'question-test',status:'ready'}]};
  e.snapshot(snapshot);e.snapshot(snapshot);assert.equal(played,1);
  e.current=null;e.snapshot({...snapshot,host:{...snapshot.host,revision:2}});assert.equal(played,1);
  e.snapshot({...snapshot,status:'ended'});e.snapshot(snapshot);assert.equal(stopped,1);assert.equal(played,1);
});

test('unsafe restoration retries only once at a larger rewind, then fails closed',async()=>{
  const selected=[],events=[],failures=[];
  const mixer={owner:'none',context:{currentTime:0},latency:()=>0,select:async owner=>{selected.push(owner);return {time:0};},silenceNow:()=>{}};
  const media={currentTime:5,addEventListener:()=>{},pause:()=>{}};
  const c=new ReplyCoordinator({pcm:new ArrayBuffer(32000*4),mixer,media,hostVideo:{},feed:{pause:()=>{},sentBound:()=>0},clearBuffer:()=>{},emit:x=>events.push(x),fail:x=>failures.push(x)});
  c.phase='reply';c.saved={observedOffset:3,resumeOffset:2.8};c.waitFor=async()=>{throw Error('unsafe_alignment');};
  await c.resume();await new Promise(r=>setTimeout(r,0));
  assert.equal(events.filter(x=>x.event==='resume_retry_rewind').length,1);
  assert.equal(events.find(x=>x.event==='resume_retry_rewind').resumeTarget,2.5);
  assert.deepEqual(failures,['host_resume_timeout']);assert.equal(selected.includes('host'),false);
});

test('a rejected handoff restores host without ever playing stale reply media',async()=>{
  let played=0,resumed=0;
  const mixer={owner:'host',context:{currentTime:0},latency:()=>0,select:async()=>({time:0}),silenceNow:()=>{}};
  const media={currentTime:0,addEventListener:()=>{},pause:()=>{},play:()=>{played++;}};
  const c=new ReplyCoordinator({pcm:new ArrayBuffer(32000*4),mixer,media,hostVideo:{},feed:{pause:()=>{},sentBound:()=>4},clearBuffer:()=>{},emit:()=>{},fail:()=>assert.fail('must restore'),beforeReply:async()=>{throw Error('reply_canceled');}});
  c.ready=()=>true;c.tracker.snapshot=()=>({observedOffset:3,resumeOffset:2.8,confidence:1});c.resume=async()=>{resumed++;};
  assert.equal(await c.request({questionId:'skipped-question'}),true);assert.equal(played,0);assert.equal(resumed,1);
});
