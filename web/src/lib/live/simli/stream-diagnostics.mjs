// Local, bounded observations. Counters describe transport/decoder behavior,
// not words heard, provider health, or end-to-end acoustic synchronization.
const numericFields=['packetsReceived','packetsLost','packetsSent','bytesReceived','bytesSent','jitter',
 'concealedSamples','silentConcealedSamples','concealmentEvents','totalSamplesReceived','totalSamplesDuration',
 'jitterBufferDelay','jitterBufferEmittedCount','framesReceived','framesDecoded','framesDropped','framesSent',
 'framesEncoded','framesPerSecond','freezeCount','totalFreezesDuration','totalDecodeTime','totalEncodeTime',
 'packetsDiscarded','nackCount','pliCount','firCount','retransmittedPacketsReceived',
 'jitterBufferTargetDelay','jitterBufferMinimumDelay','totalProcessingDelay','totalAssemblyTime',
 'insertedSamplesForDeceleration','removedSamplesForAcceleration'];
// Follow the transport's selected pair, never a guessed candidate. No addresses,
// ports, ICE usernames/passwords, certificates, URLs or arbitrary stats strings.
function receivePath(report,transportId){
 const transport=report.get?.(transportId),pair=report.get?.(transport?.selectedCandidatePairId);
 if(!pair||pair.type!=='candidate-pair')return null;
 const local=report.get?.(pair.localCandidateId),remote=report.get?.(pair.remoteCandidateId);
 const candidateType=x=>['host','srflx','prflx','relay'].includes(x)?x:null;
 const path={protocol:['udp','tcp'].includes(local?.protocol)?local.protocol:null,
  localCandidateType:candidateType(local?.candidateType),remoteCandidateType:candidateType(remote?.candidateType)};
 for(const field of ['currentRoundTripTime','availableOutgoingBitrate','bytesReceived','bytesSent','responsesReceived'])path[field]=Number.isFinite(pair[field])?pair[field]:null;
 return path;
}
export function rtcCounters(report){
 if(!report)return null;
 const result=[];
 for(const row of report.values()){
  if(!['inbound-rtp','outbound-rtp','remote-inbound-rtp'].includes(row.type))continue;
  const item={type:row.type,kind:['audio','video'].includes(row.kind??row.mediaType)?row.kind??row.mediaType:null};
  for(const field of numericFields)item[field]=Number.isFinite(row[field])?row[field]:null;
  const mime=report.get?.(row.codecId)?.mimeType;item.codecMimeType=typeof mime==='string'&&/^(audio|video)\/[a-z0-9.+-]{1,32}$/i.test(mime)?mime:null;
  if(row.type==='outbound-rtp')item.qualityLimitationReason=['none','cpu','bandwidth','other'].includes(row.qualityLimitationReason)?row.qualityLimitationReason:null;
  item.receivePath=receivePath(report,row.transportId);
  result.push(item);if(result.length>=8)break;
 }
 return result;
}
export async function boundedStats(read){
 let timer;
 try{return await Promise.race([Promise.resolve().then(read),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),500);})]);}
 catch{return null;}finally{clearTimeout(timer);}
}
export async function hostInputStats(client){
 const participants=client?.connection?.pc?.remoteParticipants;
 if(!participants?.values)return null;
 const tracks=[];
 for(const participant of participants.values()){if(tracks.length>=4)break;for(const publication of participant.trackPublications?.values()??[]){
  if(typeof publication.track?.getRTCStatsReport==='function')tracks.push(publication.track);
  if(tracks.length>=4)break;
 }}
 if(!tracks.length)return null;
 return Promise.all(tracks.slice(0,4).map(track=>boundedStats(async()=>rtcCounters(await track.getRTCStatsReport()))));
}
export function mediaCounters(video){
 if(!video)return null;
 const quality=video.getVideoPlaybackQuality?.();
 return {currentTime:Number.isFinite(video.currentTime)?video.currentTime:null,readyState:video.readyState??null,
  width:video.videoWidth??null,height:video.videoHeight??null,paused:video.paused??null,
  totalVideoFrames:quality?.totalVideoFrames??null,droppedVideoFrames:quality?.droppedVideoFrames??null,
  elementHidden:Boolean(video.hidden||video.closest?.('[hidden]'))};
}
export class StreamDiagnostics {
 constructor({emit,sample,now=()=>performance.now()}){
  Object.assign(this,{emit,sample,now});this.closed=false;this.samples=0;this.transitions=0;this.feed={chunks:0,bytes:0,maxGapMs:0,maxLateMs:0,catchupIntervals:0};
  this.work={longTasks:0,longTaskMs:0,maxLongTaskMs:0,matcherCalls:0,matcherMs:0,maxMatcherMs:0};this.lastTick=now();this.mediaListeners=[];this.mediaEvents=0;
 }
 start(){
  this.visibility=()=>{if(!this.closed&&this.transitions++<20)this.emit('host_page_state',{visibility:globalThis.document?.visibilityState??'unavailable',focused:globalThis.document?.hasFocus?.()??null});};
  globalThis.document?.addEventListener('visibilitychange',this.visibility);globalThis.window?.addEventListener('focus',this.visibility);globalThis.window?.addEventListener('blur',this.visibility);this.visibility();
  try{if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')){
   this.observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){
    this.work.longTasks++;this.work.longTaskMs+=entry.duration;this.work.maxLongTaskMs=Math.max(this.work.maxLongTaskMs,entry.duration);
   }});this.observer.observe({type:'longtask'});
  }}catch{}
  this.timer=setInterval(()=>void this.tick(),2000);
 }
 watchMedia(label,media){
  for(const name of ['playing','waiting','stalled','pause','error']){
   const listener=()=>{if(!this.closed&&this.mediaEvents++<24)this.emit('host_media_event',{source:label,name,currentTime:media.currentTime??null,readyState:media.readyState??null,errorCode:media.error?.code??null});};
   media?.addEventListener?.(name,listener);this.mediaListeners.push([media,name,listener]);
  }
 }
 beginFeed(){delete this.lastSend;this.feed.epochs=(this.feed.epochs??0)+1;}
 sent(bytes,expectedAt){
  const time=this.now(),gap=this.lastSend===undefined?null:time-this.lastSend;
  if(gap!==null){this.feed.maxGapMs=Math.max(this.feed.maxGapMs,gap);if(gap<5)this.feed.catchupIntervals++;}
  this.feed.chunks++;this.feed.bytes+=bytes;this.feed.maxLateMs=Math.max(this.feed.maxLateMs,time-expectedAt);this.lastSend=time;
 }
 matched(duration){this.work.matcherCalls++;this.work.matcherMs+=duration;this.work.maxMatcherMs=Math.max(this.work.maxMatcherMs,duration);}
 async tick(){
  if(this.closed||this.busy||this.samples>=46)return;this.busy=true;
  const time=this.now(),gap=time-this.lastTick;this.lastTick=time;
  try{const data=await this.sample();if(!this.closed&&this.samples++<46)this.emit('host_pipeline_sample',{
   ...data,visibility:globalThis.document?.visibilityState??'unavailable',focused:globalThis.document?.hasFocus?.()??null,
   sampleGapMs:gap,feed:{...this.feed},work:{...this.work},observation:'local_counters_not_human_hearing'});
  }catch{}finally{this.busy=false;}
 }
 close(){
  if(this.closed)return;this.closed=true;clearInterval(this.timer);this.observer?.disconnect();
  globalThis.document?.removeEventListener('visibilitychange',this.visibility);globalThis.window?.removeEventListener('focus',this.visibility);globalThis.window?.removeEventListener('blur',this.visibility);
  for(const [media,name,listener] of this.mediaListeners)media?.removeEventListener?.(name,listener);this.mediaListeners=[];
  this.emit('host_pipeline_summary',{feed:{...this.feed},work:{...this.work},samples:this.samples});
 }
}
