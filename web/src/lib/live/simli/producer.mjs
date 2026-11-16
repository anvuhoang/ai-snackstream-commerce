import {OutputMixer} from './output-mixer.mjs';
import {PcmReplyPlayer} from './pcm-reply-player.mjs';
import {ReplyCoordinator} from './reply-coordinator.mjs';
import {HostBroadcast} from './broadcast.mjs';
import {HostTransport} from './transport-lifecycle.mjs';
import {ClockedPcmFeed} from './clocked-pcm.mjs';
import {StreamDiagnostics,mediaCounters,hostInputStats,boundedStats,rtcCounters} from './stream-diagnostics.mjs';

export class SimliProducer {
  constructor({liveId,csrf,canvas,hostVideo,hostAudio,replyVideo,onState,onSession,onDiagnostic}){
    Object.assign(this,{liveId,csrf,canvas,hostVideo,hostAudio,replyVideo,onState,onSession,onDiagnostic});
    this.transport=new HostTransport({onDecodedReady:()=>this.diagnostic('host_start_decoded_frame',{observation:'decoded_track_frame_not_human_hearing'})});
    this.clientId=crypto.randomUUID();this.closed=false;this.stopping=null;this.feedEpoch=0;this.sent=0;this.latest=null;this.current=null;this.seen=new Set();this.controls=Promise.resolve();this.epoch=0;
  }
  diagnostic(event,data={}){this.onDiagnostic({event,atUtc:new Date().toISOString(),...data});}
  async api(suffix,body,raw=false){
    const response=await fetch(`/api/admin/live/${this.liveId}/host/${suffix}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'Content-Type':'application/json','X-CSRF-Token':this.csrf,...(this.lease?{'X-Live-Host-Lease':this.lease}:{})},body:JSON.stringify({clientId:this.clientId,...body})});
    if(!response.ok){let code='host_request_failed';try{code=(await response.json()).error?.code??code;}catch{}throw Error(code);}
    return raw?response.arrayBuffer():response.status===204?null:response.json();
  }
  async action(action,questionId=null,offsetSeconds=null){
    const result=await this.api('action',{requestId:crypto.randomUUID(),action,questionId,offsetSeconds});
    if(!this.closed){this.latest=result.session;this.onSession(result.session);}
    return result;
  }
  control(action,questionId=null,offsetSeconds=null){
    const task=this.controls.then(()=>{if(!this.closed)return this.action(action,questionId,offsetSeconds);});
    this.controls=task.catch(()=>{if(!this.closed)void this.stop('host_control_failed');});return task;
  }
  async pipelineSample(){
    const sender=[];
    for(const peer of this.broadcast?.peers.values()??[])sender.push(await boundedStats(async()=>rtcCounters(await peer.pc.getStats())));
    return {phase:this.coordinator?.phase??'preparing',owner:this.mixer?.owner??'none',hostInputRtc:await hostInputStats(this.client),
      sender,hostVideo:mediaCounters(this.hostVideo),replyVideo:mediaCounters(this.replyVideo),
      canvas:this.broadcast?{...this.broadcast.drawMetrics}:null,clock:this.clockMetrics?{...this.clockMetrics}:null,audioContextState:this.mixer?.context?.state??null,
      probe:this.mixer?.probeMetrics??null,websocketBufferedBytes:this.client?.connection?.signalingConnection?.wsConnection?.bufferedAmount??null};
  }
  async start(){
    if(this.closed||this.epoch)return;
    const generation=++this.epoch;const active=()=>!this.closed&&this.epoch===generation;this.onState('preparing');
    this.metrics=new StreamDiagnostics({emit:(event,data)=>this.diagnostic(event,data),sample:()=>this.pipelineSample()});this.metrics.start();
    this.metrics.watchMedia('host_video',this.hostVideo);this.metrics.watchMedia('host_audio',this.hostAudio);this.metrics.watchMedia('reply',this.replyVideo);
    this.cap=setTimeout(()=>void this.stop('session_limit'),90000);this.startup=setTimeout(()=>void this.stop('startup_timeout'),20000);
    try{
      const acquired=await this.api('acquire',{});this.lease=acquired.leaseId;
      if(this.closed){await this.api('action',{requestId:crypto.randomUUID(),action:'stop'}).catch(()=>{});return;}
      this.latest=acquired.session;this.onSession(this.latest);
      this.heartbeat=setInterval(()=>void this.tick(),750);
      const [token,pcm]=await Promise.all([this.api('token',{}),this.api('audio',{},true)]);
      if(this.closed||this.epoch!==generation)return;
      this.pcm=new Uint8Array(pcm);
      this.mixer=new OutputMixer(this.hostAudio,this.replyVideo,data=>{
        const before=performance.now();this.coordinator?.probe(data);this.metrics?.matched(performance.now()-before);if(this.submitted&&!this.complete&&this.coordinator?.outputFinished())void this.audioEnded();
      },data=>this.diagnostic('output_owner',{owner:data.owner,contextTime:data.time}));
      this.mixer.onClock=time=>this.clock(time);
      const player={onEnded:cb=>this.replyVideo.addEventListener('ended',cb),onError:cb=>this.replyVideo.addEventListener('error',cb),
        position:()=>this.replyVideo.currentTime,visible:value=>{this.replyVideo.hidden=!value;},pause:()=>this.replyVideo.pause(),
        playFromStart:async q=>{
          if(!q||!Number.isFinite(q.videoDurationSeconds)||!['prerecorded','make'].includes(q.mediaSource))throw Error('reply_metadata_invalid');
          const url=new URL(q.videoUrl,location.origin);if(q.mediaSource==='make'&&(url.protocol!=='https:'||url.username||url.password))throw Error('reply_url_invalid');
          if(q.mediaSource==='prerecorded'&&q.videoUrl===`/api/admin/live/${this.liveId}/host/mock-video`){
            const bytes=await this.api('mock-video',{},true);if(this.closed)throw Error('canceled');
            if(this.replyObjectURL)URL.revokeObjectURL(this.replyObjectURL);
            this.replyObjectURL=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));this.replyVideo.src=this.replyObjectURL;
          }else{this.replyVideo.crossOrigin='anonymous';this.replyVideo.src=q.videoUrl;}
          if(this.closed||this.current?.questionId!==q.questionId||this.coordinator.phase!=='loading_reply')throw Error('canceled');
          this.replyVideo.currentTime=0;await this.replyVideo.play();
          if(!Number.isFinite(this.replyVideo.duration)||Math.abs(this.replyVideo.duration-q.videoDurationSeconds)>.05)throw Error('reply_duration_mismatch');
        }};
      const audioPlayer=new PcmReplyPlayer({pcm,mixer:this.mixer,
        feed:{start:buffer=>this.feed(0,new Uint8Array(buffer)),pause:()=>this.pauseFeed(),sentBound:()=>this.sent},
        load:q=>this.api(`reply-audio/${q.questionId}`,{},true),
        quiet:()=>this.coordinator?.quietSince!==null&&this.mixer.context.currentTime-this.coordinator.quietSince>=.3,
        diagnostic:(event,data)=>this.diagnostic(event,data)});
      this.coordinator=new ReplyCoordinator({pcm,mixer:this.mixer,media:this.replyVideo,player,audioPlayer,hostVideo:this.hostVideo,
        feed:{start:p=>this.feed(p),pause:()=>this.pauseFeed(),sentBound:()=>this.sent},clearBuffer:()=>this.client.ClearBuffer(),
        beforeReply:async(q,saved)=>{
          try{await this.action('handoff',q.questionId,saved.observedOffset);if(this.current?.canceled)throw Error('reply_canceled');}
          catch(error){if(error.message==='host_reply_not_ready'){this.localRestore=true;throw Error('reply_canceled');}throw error;}
        },
        emit:data=>this.coordination(data),fail:code=>void this.stop(code)});
      await this.mixer.start();if(!active())return;
      this.client=await this.transport.create(token,this.hostVideo,this.hostAudio,active);
      if(!active()||!this.client)return;
      this.diagnostic('transport_created',{transport:token.transport});
      this.client.on('error',()=>{if(!this.closed)void this.stop('transport_error');});
      this.client.on('stop',()=>{if(!this.closed)void this.stop('transport_stopped');});
      await this.client.start();if(!active())return;await this.hostAudio.play();if(!active())return;
      await this.action('ready');if(!active())return;
      this.broadcast=new HostBroadcast({canvas:this.canvas,hostVideo:this.hostVideo,replyVideo:this.replyVideo,mixer:this.mixer,coordinator:this.coordinator,
        markFrames:token.transport==='mock',externallyClocked:true,offer:body=>this.api('offer',body),diagnostic:(event,data)=>this.diagnostic(event,data)});
      clearTimeout(this.startup);this.onState('script');this.feed(0);this.diagnostic('host_ready');
    }catch(error){await this.stop(error?.message==='host_key_missing'?'host_key_missing':'host_start_failed');}
  }
  clock(time){
    if(this.closed||!this.mixer?.context)return;
    const now=this.mixer.context.currentTime;
    this.clockMetrics??={source:'audio-worklet',pulses:0,coalesced:0,maxGapMs:0};
    if(!Number.isFinite(time)||now-time>.1||time<=(this.lastClockTime??-Infinity)||now-(this.lastClockNow??-Infinity)<1/60){this.clockMetrics.coalesced++;return;}
    this.lastClockTime=time;this.lastClockNow=now;
    const wall=performance.now();this.clockMetrics.pulses++;this.clockMetrics.maxGapMs=Math.max(this.clockMetrics.maxGapMs,this.lastClockWall===undefined?0:wall-this.lastClockWall);this.lastClockWall=wall;
    try{
      this.clockFeed?.tick(now);
      if(this.drainAt!==null&&this.drainAt!==undefined&&now>=this.drainAt&&!this.complete&&this.coordinator?.phase==='host'){void this.stop('host_drain_timeout');return;}
      this.broadcast?.draw();
    }catch{void this.stop('host_clock_failed');}
  }
  pauseFeed(){this.feedEpoch++;this.clockFeed?.stop();this.drainAt=null;clearTimeout(this.feedTimer);clearTimeout(this.drainTimer);this.submitted=false;}
  feed(position=0,source=this.pcm){
    this.pauseFeed();this.metrics?.beginFeed();const epoch=this.feedEpoch;
    if(this.mixer?.context){
      const started=this.mixer.context.currentTime,wall=performance.now();
      this.clockFeed=new ClockedPcmFeed({pcm:source,send:bytes=>this.client.sendAudioData(bytes),
        sent:(offset,bytes,due)=>{this.sent=offset/32000;this.metrics?.sent(bytes,wall+(due-started)*1000);},
        complete:time=>{this.submitted=true;this.drainAt=time+8;}});
      this.clockFeed.start(position,started);return;
    }
    // Compatibility for a sink without an AudioContext; the browser producer
    // always uses the render-thread clock above.
    let offset=Math.min(source.length,Math.floor(position*16000)*2);const origin=offset,started=performance.now();
    const send=()=>{if(this.closed||epoch!==this.feedEpoch)return;
      const chunk=source.subarray(offset,Math.min(offset+6000,source.length));if(chunk.length){this.client.sendAudioData(chunk);this.metrics?.sent(chunk.length,started+(offset-origin)/32);}
      offset+=chunk.length;this.sent=offset/32000;
      if(offset<source.length)this.feedTimer=setTimeout(send,Math.max(0,started+(offset-origin)/32-performance.now()));
      else this.feedTimer=setTimeout(()=>{if(this.closed||epoch!==this.feedEpoch)return;this.submitted=true;
        this.drainTimer=setTimeout(()=>{if(!this.closed&&!this.complete&&this.coordinator.phase==='host')void this.stop('host_drain_timeout');},8000);
      },Math.max(0,started+(source.length-origin)/32-performance.now()));
    };send();
  }
  async audioEnded(){
    if(this.complete||this.closed)return;this.complete=true;clearTimeout(this.drainTimer);
    this.coordinator.scriptComplete=true;this.coordinator.completeOffset=this.pcm.length/32000;
    try{await this.control('audio_ended');this.pump();}catch{void this.stop('host_end_failed');}
  }
  coordination(data){
    if(this.closed)return;
    if(data.event)this.diagnostic(data.event,data);
    if(data.phase==='host'&&Number.isFinite(data.observedOffset))this.offset=data.observedOffset;
    const qid=this.current?.questionId;
    if(data.event==='reply_playing')void this.control('reply_playing',qid);
    if(data.event==='reply_ended'&&!this.localRestore)void this.control('reply_ended',qid);
    if(data.event==='host_resumed'){
      const finish=()=>{if(!this.closed&&this.current?.questionId===qid){this.current=null;this.localRestore=false;this.pump();}};
      if(this.localRestore)finish();else void this.control('restored',qid,data.observedResumeOffset).then(finish);
    }
    if(data.event==='reply_request_rejected'&&data.phase==='host'&&qid){this.seen.delete(qid);this.current=null;}
    this.onState(data.phase);this.pump();
  }
  snapshot(session){
    if(this.closed)return;
    if(!session||session.liveId!==this.liveId||session.status==='ended'){void this.stop('session_ended');return;}
    if(this.latest?.host?.epoch&&session.host?.epoch!==this.latest.host.epoch)return;
    if(this.latest?.host&&session.host&&session.host.revision<this.latest.host.revision)return;
    this.latest=session;
    const q=this.current&&session.questions.find(q=>q.questionId===this.current.questionId);
    if(this.current&&(!q||['skipped','failed'].includes(q.status))&&!this.current.canceled){this.current.canceled=true;if(this.coordinator?.phase!=='handoff')void this.coordinator?.cancelCurrentReply();}
    this.pump();
  }
  pump(){
    if(this.closed||this.current||!this.coordinator?.ready()||!['script','complete'].includes(this.latest?.host?.phase))return;
    const q=this.latest.questions.find(q=>q.status==='ready'&&!this.seen.has(q.questionId));if(!q)return;
    this.current={...q};this.seen.add(q.questionId);
    void this.coordinator.request(q).then(ok=>{if(!ok&&!this.closed&&this.current?.questionId===q.questionId){this.seen.delete(q.questionId);this.current=null;}});
  }
  async tick(){
    if(this.closed||this.ticking)return;this.ticking=true;
    try{const data=await this.action('heartbeat',null,this.offset??null);this.snapshot(data.session);
      if(!this.closed)await this.broadcast?.update(data.peers);
    }catch{if(!this.closed)void this.stop('host_lease_lost');}finally{this.ticking=false;}
  }
  stop(reason='manual'){
    if(this.stopping)return this.stopping;
    this.closed=true;this.epoch++;const disconnect=this.transport.stop();clearInterval(this.heartbeat);clearTimeout(this.cap);clearTimeout(this.startup);this.pauseFeed();
    this.coordinator?.stop();this.broadcast?.close();this.mixer?.silenceNow();
    this.metrics?.close();this.onState('closing');
    this.stopping=(async()=>{
      let sdk='not_created';let timer;try{if(this.transport.client){sdk=await Promise.race([disconnect.then(()=> 'resolved'),new Promise(r=>{timer=setTimeout(()=>r('timeout'),3000);})]);}else await disconnect;}catch{sdk='rejected';}finally{clearTimeout(timer);}
      this.mixer?.close();
      if(this.replyObjectURL)URL.revokeObjectURL(this.replyObjectURL);
      for(const media of [this.hostVideo,this.hostAudio,this.replyVideo]){media.pause();media.srcObject?.getTracks().forEach(t=>t.stop());media.srcObject=null;media.removeAttribute('src');media.load();}
      let acknowledged=false;
      if(this.lease)try{await this.api('action',{requestId:crypto.randomUUID(),action:'stop'});acknowledged=true;}catch{}
      this.onState('ended');this.diagnostic('host_cleanup',{reason,sdkDisconnect:sdk,localCleanup:true,backendAcknowledged:acknowledged});
    })();return this.stopping;
  }
}
