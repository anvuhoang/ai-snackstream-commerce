import {test} from 'node:test';import assert from 'node:assert/strict';
import {ReplyCoordinator} from '../src/lib/live/simli/reply-coordinator.mjs';
import {PlayoutPosition} from '../src/lib/live/simli/playout-position.mjs';
function fixture(){let seed=17;const ref=Array.from({length:160},()=>{seed=(1664525*seed+1013904223)>>>0;return .02+.3*seed/2**32;});
 const tracker=new PlayoutPosition(ref);tracker.observe(ref.slice(0,50),1,3);assert.equal(tracker.last.offset,1);
 const p=Object.assign(Object.create(ReplyCoordinator.prototype),{phase:'resuming',pendingResume:{},saved:{resumeOffset:1.04},tracker,feed:{sentBound:()=>3}});
 return {p,ref};}
test('target crossing uses a genuine accepted 1s decoded window inside a rejected 100ms probe',()=>{
 const {p,ref}=fixture(),bins=[...ref.slice(50,52),.9,.8,.9],old=new PlayoutPosition(ref);old.observe(ref.slice(0,50),1,3);assert.equal(old.observe(bins,1.1,3),null,'baseline full probe must reject');
 const match=p.matchDecodedProbe({bins,time:1.1});assert.ok(match&&Math.abs(match.offset-1.04)<1e-9);assert.ok(match.confidence>=.94);assert.equal(match.contextTime,1.04);
 assert.equal(p.tracker.windowBins,50);assert.equal(p.tracker.confidence,.94);assert.equal(p.tracker.margin,.025);assert.deepEqual(p.tracker.window,[...ref.slice(5,50),...bins]);
});
test('RMS samples are neither lost nor repeated after an intermediate accepted match',()=>{
 const {p,ref}=fixture();p.matchDecodedProbe({bins:ref.slice(50,55),time:1.1});p.phase='host';p.matchDecodedProbe({bins:ref.slice(55,60),time:1.2});assert.deepEqual(p.tracker.window,ref.slice(10,60));
});
test('fine search is bounded to five bins near a fresh resume target; host/stall/far/cancelled paths keep one search',()=>{
 for(const change of [p=>{p.phase='host';},p=>{p.pendingResume=null;},p=>{p.saved.resumeOffset=1.5;},p=>{p.tracker.last.contextTime=0;}]){
  const {p,ref}=fixture();let calls=0;const observe=p.tracker.observe.bind(p.tracker);p.tracker.observe=(...a)=>{calls++;return observe(...a);};change(p);p.matchDecodedProbe({bins:ref.slice(50,55),time:1.1});assert.equal(calls,1);
 }
 const {p}=fixture();let calls=0;p.tracker.observe=()=>{calls++;return null;};assert.equal(p.matchDecodedProbe({bins:[.4,.8,.5,.7,.8],time:1.1}),null);assert.equal(calls,5);
});
test('silence/ambiguous patterns cannot become an accepted match by refining time resolution',()=>{
 const tracker=new PlayoutPosition(Array(200).fill(.2));tracker.last={offset:1,contextTime:1,confidence:.99};
 const p=Object.assign(Object.create(ReplyCoordinator.prototype),{phase:'resuming',pendingResume:{},saved:{resumeOffset:1.04},tracker,feed:{sentBound:()=>4}});
 tracker.window=Array(50).fill(0);assert.equal(p.matchDecodedProbe({bins:[0,0,0,0,0],time:1.1}),null);
 tracker.window=Array(50).fill(.2);assert.equal(p.matchDecodedProbe({bins:[.2,.2,.2,.2,.2],time:1.1}),null);
});
test('a cancelled/stopped coordinator never resolves a pending restore from a late probe',()=>{
 const {p}=fixture();p.closed=true;p.pendingResume={resolve(){assert.fail('late restore');}};p.probe({bins:[.4,.3,.2,.1,.4],time:1.1,owner:'none'});
});
