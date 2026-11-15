import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StreamDiagnostics,rtcCounters,boundedStats,hostInputStats} from '../src/lib/live/simli/stream-diagnostics.mjs';
import {SimliProducer} from '../src/lib/live/simli/producer.mjs';

test('RTC diagnostics whitelist counters and do not expose SDP, addresses or credentials',()=>{
 const report=new Map([['x',{type:'inbound-rtp',kind:'audio',packetsLost:3,concealedSamples:120,token:'sensitive',address:'private',jitter:Infinity}],
 ['c',{type:'local-candidate',address:'private',password:'secret'}]]);
 const rows=rtcCounters(report);assert.equal(rows.length,1);assert.equal(rows[0].concealedSamples,120);assert.equal(rows[0].jitter,null);
 assert.equal(rows[0].framesDecoded,null);assert.equal(JSON.stringify(rows).includes('sensitive'),false);assert.equal(JSON.stringify(rows).includes('private'),false);
 assert.equal(rtcCounters(null),null);
});
test('diagnostics budget and cleanup bound output even if sampling fails',async()=>{
 let clock=0,fail=false;const events=[];
 const d=new StreamDiagnostics({now:()=>clock,emit:(event,data)=>events.push({event,...data}),sample:async()=>{if(fail)throw Error('test');return {hostInputRtc:null};}});
 d.sent(6000,0);clock=1000;d.sent(6000,187.5);clock=1001;d.sent(6000,375);d.matched(2);
 assert.equal(d.feed.maxGapMs,1000);assert.equal(d.feed.catchupIntervals,1);
 clock=10000;d.beginFeed();d.sent(6000,10000);assert.equal(d.feed.maxGapMs,1000,'intentional reply pause is not a feeder gap');
 fail=true;await d.tick();assert.equal(events.length,0);fail=false;
 for(let i=0;i<100;i++){clock+=2000;await d.tick();}
 assert.equal(events.length,46);d.close();await d.tick();assert.equal(events.length,47);
 assert.equal(events.at(-1).event,'host_pipeline_summary');assert.equal(events.at(-1).work.maxMatcherMs,2);
});
test('upstream missing stats stay null and a hanging reader has a finite timeout',async()=>{
 assert.equal(await hostInputStats({}),null);
 assert.equal(await boundedStats(()=>{throw Error('unavailable');}),null);
 assert.equal(await boundedStats(()=>new Promise(()=>{})),null);
});
test('baseline PCM timer catches up in bursts after main thread delay without dropping bytes',()=>{
 const originalPerformance=globalThis.performance,originalSetTimeout=globalThis.setTimeout,originalClearTimeout=globalThis.clearTimeout;
 let clock=0,id=0;const tasks=new Map(),sends=[];
 globalThis.performance={now:()=>clock};globalThis.setTimeout=(fn,ms)=>{const n=++id;tasks.set(n,{fn,at:clock+ms});return n;};globalThis.clearTimeout=n=>tasks.delete(n);
 try{
  const p=new SimliProducer({onDiagnostic(){}});p.pcm=new Uint8Array(32000);p.client={sendAudioData:bytes=>sends.push({bytes:bytes.length,at:clock})};
  p.metrics=new StreamDiagnostics({now:()=>clock,emit(){},sample:async()=>({})});p.coordinator={phase:'host'};p.feed(0);
  clock=1000;
  for(let i=0;i<20;i++){const next=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>clock)break;tasks.delete(next[0]);next[1].fn();}
  assert.equal(sends.reduce((sum,x)=>sum+x.bytes,0),32000);
  assert.ok(p.metrics.feed.catchupIntervals>=3);assert.ok(p.metrics.feed.maxLateMs>=800);
  assert.equal(sends.filter(x=>x.at===1000).length,5);
  p.pauseFeed();p.metrics.close();
 }finally{globalThis.performance=originalPerformance;globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;}
});

test('codec diagnostics report only negotiated MIME and preserve unavailable values as null',()=>{
 const rows=rtcCounters(new Map([['codec',{type:'codec',mimeType:'video/H264',sdpFmtpLine:'private'}],['rtp',{type:'outbound-rtp',kind:'video',codecId:'codec'}],['missing',{type:'inbound-rtp',kind:'audio'}]]));
 assert.equal(rows[0].codecMimeType,'video/H264');assert.equal(rows[1].codecMimeType,null);assert.equal(JSON.stringify(rows).includes('private'),false);
 assert.equal(rtcCounters(new Map([['bad',{type:'codec',mimeType:'private value'}],['rtp',{type:'outbound-rtp',kind:'video',codecId:'bad'}]]))[0].codecMimeType,null);
});

test('receive path follows selected pair and excludes credentials and addresses',()=>{
 const report=new Map([
  ['rtp',{type:'inbound-rtp',kind:'video',transportId:'t',nackCount:7,pliCount:2,jitterBufferTargetDelay:0,packetsDiscarded:3}],
  ['t',{type:'transport',selectedCandidatePairId:'selected',iceLocalUsernameFragment:'private-ice'}],
  ['not-selected',{type:'candidate-pair',currentRoundTripTime:99}],
  ['selected',{type:'candidate-pair',localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:.2,availableOutgoingBitrate:0,bytesReceived:123,bytesSent:456,responsesReceived:10,password:'private-token'}],
  ['local',{type:'local-candidate',protocol:'udp',candidateType:'relay',address:'private-address',url:'private-turn',port:999}],
  ['remote',{type:'remote-candidate',protocol:'udp',candidateType:'host',address:'private-remote'}]
 ]);
 const row=rtcCounters(report)[0];assert.equal(row.nackCount,7);assert.equal(row.pliCount,2);assert.equal(row.packetsDiscarded,3);assert.equal(row.jitterBufferTargetDelay,0);
 assert.deepEqual(row.receivePath,{protocol:'udp',localCandidateType:'relay',remoteCandidateType:'host',currentRoundTripTime:.2,availableOutgoingBitrate:0,bytesReceived:123,bytesSent:456,responsesReceived:10});
 assert.equal(JSON.stringify(row).includes('private'),false);assert.equal(row.retransmittedPacketsReceived,null);
});

test('missing path and nonfinite recovery counters stay unavailable, not zero',()=>{
 const report=new Map([['rtp',{type:'inbound-rtp',kind:'audio',transportId:'missing',nackCount:Infinity}],['p',{type:'candidate-pair',currentRoundTripTime:0}]]);
 const row=rtcCounters(report)[0];assert.equal(row.receivePath,null);assert.equal(row.nackCount,null);assert.equal(row.packetsDiscarded,null);
});
