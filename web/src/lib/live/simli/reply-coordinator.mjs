import {pcmEnvelope,PlayoutPosition,BIN_SECONDS} from "./playout-position.mjs";
export class ReplyCoordinator {
  constructor({pcm,mixer,media,player,audioPlayer,hostVideo,feed,clearBuffer,emit,fail,beforeReply=async()=>{},now=performance.now.bind(performance)}) {
    Object.assign(this,{mixer,media,hostVideo,feed,clearBuffer,emit,fail,now});
    // Legacy media shim keeps the existing POC unit fixtures compatible. The
    // live demo injects Mp4ReplyPlayer; coordination depends on this interface.
    this.player=player??{
      onEnded:callback=>media.addEventListener("ended",callback),
      onError:callback=>media.addEventListener("error",callback),
      position:()=>media.currentTime,visible:value=>{media.hidden=!value;},pause:()=>media.pause(),
      playFromStart:()=>{media.currentTime=0;return media.play();},
    };
    this.videoPlayer=this.player;this.audioPlayer=audioPlayer;
    if(audioPlayer){audioPlayer.onEnded(()=>{if(this.phase==="reply")void this.resume();});audioPlayer.onError(()=>{if(!this.closed)this.abort("reply_audio_error");});}
    this.beforeReply=beforeReply;
    this.tracker=new PlayoutPosition(pcmEnvelope(pcm),{pcm});
    const lastVoice=this.tracker.reference.findLastIndex(x=>x>=0.0005);
    this.lastVoiceOffset=(lastVoice+1)*0.02;
    this.phase="host";this.epoch=0;this.quietSince=null;this.closed=false;
    this.trace=[];this.saved=null;this.pendingResume=null;this.lastMatchOwner=null;
    this.resumeTiming=null;this.videoFrameRequest=null;
    this.player.onEnded(()=>{if(this.phase==="reply")void this.resume();});
    this.player.onError(()=>{if(!this.closed&&this.phase!=="host")this.abort("reply_media_error");});
  }
  record(event,data={}) {
    const stamp={atMs:Math.round(this.now()),atUtc:new Date().toISOString(),questionId:this.descriptor?.questionId??null};
    this.trace.push({event,...stamp,...data});this.trace=this.trace.slice(-80);
    this.emit({kind:"coordination",phase:this.phase,ready:this.ready(),event,...stamp,...data});
  }
  timingSummary() {
    const t=this.resumeTiming;if(!t)return null;
    const span=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,Math.round(b-a)):null;
    return {
      replyEndToPrerollMs:span(t.replyEnded,t.prerollStarted),
      prerollToFirstDecodedAudioMs:span(t.prerollStarted,t.firstDecodedAudio),
      firstDecodedAudioToAlignmentMs:span(t.firstDecodedAudio,t.firstAlignment),
      firstAlignmentToTargetMs:span(t.firstAlignment,t.targetAlignment),
      targetToHostOutputSelectedMs:span(t.targetAlignment,t.hostSelected),
      replyEndToHostOutputSelectedMs:span(t.replyEnded,t.hostSelected),
      replyEndToVideoCallbackMs:span(t.replyEnded,t.videoFrame),
      requestedPrerollSeconds:t.prerollSeconds??null,
      outputLatencyEstimateSeconds:this.mixer.latency(),
    };
  }
  ready() {
    if(this.scriptComplete)return !this.closed&&this.phase==="host";
    const point=this.tracker.snapshot(this.mixer.context?.currentTime??0,this.mixer.latency());
    return !this.closed&&this.phase==="host"&&this.mixer.owner==="host"&&this.lastMatchOwner==="host"&&Boolean(point&&point.resumeOffset>=1.2);
  }
  outputFinished() {
    return this.phase==="host"&&this.tracker.last?.offset>=this.lastVoiceOffset-0.12&&
      this.quietSince!==null&&this.mixer.context.currentTime-this.quietSince>=0.3;
  }
  probe(data) {
    if(this.closed)return;
    if(data.bins.every(x=>x<0.001))this.quietSince??=data.time;
    else this.quietSince=null;
    if(this.phase==="resuming"&&Number.isFinite(this.resumeTiming?.prerollStarted)&&this.resumeTiming.firstDecodedAudio===null&&data.bins.some(x=>x>=0.001)) {
      this.resumeTiming.firstDecodedAudio=this.now();
      this.record("resume_first_decoded_audio_observed",{contextTime:data.time,
        observation:"non_silent_decoded_stream_not_proven_generation_or_human_hearing"});
    }
    if(this.audioReply&&["loading_reply","reply"].includes(this.phase)){this.audioPlayer.probe(data);return;}
    const match=this.matchDecodedProbe(data);
    if(this.phase==="resuming"&&Number.isFinite(this.resumeTiming?.prerollStarted)&&match&&this.resumeTiming.firstAlignment===null) {
      this.resumeTiming.firstAlignment=this.now();
      this.record("resume_first_alignment",{contextTime:data.time,sourceOffset:match.offset,confidence:match.confidence});
    }
    if(match)this.lastMatchOwner=data.owner;
    if(this.phase==="resuming" && match && match.offset>=this.saved.resumeOffset && this.pendingResume) {
      if(this.resumeTiming)this.resumeTiming.targetAlignment=this.now();
      this.record("resume_target_alignment",{contextTime:match.contextTime,probeEndContextTime:data.time,sourceOffset:match.offset,confidence:match.confidence,observation:"accepted_decoded_window"});
      if(match.offset>this.saved.resumeOffset+0.15)this.pendingResume.reject(Error("unsafe_alignment"));
      else this.pendingResume.resolve(match);
      this.pendingResume=null;
    }
    if(this.phase==="host")this.emit({kind:"coordination",phase:this.phase,ready:this.ready(),
      observedOffset:this.tracker.snapshot(this.mixer.context.currentTime,this.mixer.latency())?.observedOffset??null,
      confidence:match?.confidence??null});
  }
  matchDecodedProbe(data) {
    const last=this.tracker.last,target=this.saved?.resumeOffset;
    const near=this.phase==="resuming"&&this.pendingResume&&last&&target>last.offset&&target-last.offset<=0.1&&
      data.time>=last.contextTime&&data.time-last.contextTime<=0.2;
    if(!near)return this.tracker.observe(data.bins,data.time,this.feed.sentBound());
    // Same 1s window/confidence/margin, at the existing 20ms bin resolution.
    // Only refine the one/two probes immediately around the restore target.
    let accepted=null;
    for(let i=0;i<data.bins.length;i++){
      const match=this.tracker.observe([data.bins[i]],data.time-(data.bins.length-i-1)*BIN_SECONDS,this.feed.sentBound());
      if(match)accepted=match;
      if(match&&match.offset>=target){
        // Keep every remaining RMS bin for the next probe, without replacing
        // this accepted observation with a low-confidence later window.
        this.tracker.window.push(...data.bins.slice(i+1));this.tracker.window=this.tracker.window.slice(-this.tracker.windowBins);
        return match;
      }
    }
    return accepted;
  }
  async waitFor(check,ms,epoch) {
    const end=this.now()+ms;
    while(!this.closed&&this.epoch===epoch&&this.now()<end) {
      if(check())return;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw Error(this.closed?"canceled":"reply_transition_timeout");
  }
  async request(descriptor) {
    if(!this.ready())return false;
    const saved=this.scriptComplete?{observedOffset:this.completeOffset,resumeOffset:this.completeOffset,confidence:1}:this.tracker.snapshot(this.mixer.context.currentTime,this.mixer.latency());
    if(!saved)return false;
    const epoch=++this.epoch;
    if(this.videoFrameRequest!==null)this.hostVideo.cancelVideoFrameCallback?.(this.videoFrameRequest);
    this.videoFrameRequest=null;this.resumeTiming=null;
    this.phase="handoff";this.saved=saved;this.feed.pause();
    this.restoreRetries=0;this.originalReplyEndedAt=null;
    this.descriptor=descriptor;this.audioReply=descriptor.replyKind==="simli_audio";
    this.player=this.audioReply?this.audioPlayer:this.videoPlayer;
    if(!this.player){this.abort("reply_player_missing");return false;}
    this.record("host_yield",{observedOffset:saved.observedOffset,resumeOffset:saved.resumeOffset,
      confidence:saved.confidence,latencySeconds:this.mixer.latency(),replayGuardSeconds:0.2});
    try {
      await this.mixer.select("none");
      if(this.closed||this.epoch!==epoch)return false;
      await this.beforeReply(descriptor,saved);
      if(this.closed||this.epoch!==epoch)return false;
      this.clearBuffer(); // SKIP is requested, never described as an acknowledgement.
      this.record("host_buffer_clear_requested");
      this.hostVideo.hidden=!this.audioReply;this.player.visible(true);
      this.phase="loading_reply";this.record("reply_loading");
      const playing=this.player.playFromStart(descriptor,saved);
      await Promise.race([playing,this.waitFor(()=>false,5000,epoch)]);
      if(this.closed||this.epoch!==epoch)return false;
      const selected=await this.mixer.select(this.audioReply?"host":"reply");
      if(this.audioReply)this.player.selected(selected);
      if(this.closed||this.epoch!==epoch)return false;
      this.phase="reply";this.record("reply_playing",{replyStart:this.player.position()});
      return true;
    } catch(error){if(!this.closed&&this.epoch===epoch&&error.message==="reply_canceled"){this.phase="reply";this.record("reply_canceled_before_play");await this.resume();return true;}if(!this.closed&&this.epoch===epoch)this.abort(error.message==="reply_transition_timeout"?"reply_load_timeout":"reply_media_error");return false;}
  }
  async cancelCurrentReply() {
    if(this.closed||this.phase==="host"||this.phase==="resuming")return;
    this.epoch++;this.player.pause();this.phase="reply";
    this.record("reply_skipped");await this.resume();
  }
  async resume() {
    const epoch=this.epoch;
    if(this.closed||this.phase!=="reply")return;
    this.originalReplyEndedAt??=this.now();
    this.resumeTiming={replyEnded:this.originalReplyEndedAt,firstDecodedAudio:null,firstAlignment:null,targetAlignment:null,videoFrame:null};
    this.phase="resuming";this.player.pause();this.record(this.restoreRetries?"resume_retry_started":"reply_ended",{replyEnd:this.player.position()});
    try {
      await this.mixer.select("none");
      this.record("resume_output_silenced");
      if(this.scriptComplete){
        this.player.visible(false);this.hostVideo.hidden=false;this.phase="host";
        this.record("host_resumed",{resumeTarget:this.completeOffset,observedResumeOffset:this.completeOffset,scriptCompleted:true});
        return;
      }
      this.record("resume_quiet_wait_started",{quietAlreadySeconds:this.quietSince===null?null:Math.max(0,this.mixer.context.currentTime-this.quietSince),requiredQuietSeconds:0.3});
      await this.waitFor(()=>this.quietSince!==null&&this.mixer.context.currentTime-this.quietSince>=0.3,2000,epoch);
      if(this.closed||this.epoch!==epoch)return;
      this.record("resume_quiet_confirmed");
      this.clearBuffer();
      this.record("resume_skip_requested",{acknowledged:false});
      const start=Math.max(0,this.saved.resumeOffset-1.2);
      this.tracker.reset(start);this.lastMatchOwner=null;this.pendingResume=Promise.withResolvers();
      const observed=this.pendingResume.promise;
      this.resumeTiming.prerollStarted=this.now();this.resumeTiming.prerollSeconds=this.saved.resumeOffset-start;
      this.record("resume_preroll_started",{sourceStart:start,sourceTarget:this.saved.resumeOffset,
        requestedPrerollSeconds:this.resumeTiming.prerollSeconds,outputMuted:this.mixer.owner==="none"});
      this.videoFrameRequest=this.hostVideo.requestVideoFrameCallback?.((_now,metadata)=>{
        if(this.closed||this.epoch!==epoch||!this.resumeTiming)return;
        this.videoFrameRequest=null;
        this.resumeTiming.videoFrame=this.now();
        this.record("resume_video_frame_observed",{videoMediaTime:metadata.mediaTime,
          observation:"video_callback_only_not_proven_fresh_speech_frame",timing:this.timingSummary()});
      })??null;
      this.feed.start(start);
      await Promise.race([observed,this.waitFor(()=>false,6000,epoch)]);
      if(this.closed||this.epoch!==epoch)return;
      const last=this.tracker.last;
      if(last.offset+Math.max(0,this.mixer.context.currentTime-last.contextTime)>this.saved.resumeOffset+0.15)throw Error("unsafe_alignment");
      const ack=await this.mixer.select("host");
      if(this.closed||this.epoch!==epoch)return;
      if(last.offset+Math.max(0,ack.time-last.contextTime)>this.saved.resumeOffset+0.15)throw Error("unsafe_alignment");
      this.resumeTiming.hostSelected=this.now();
      this.player.visible(false);this.hostVideo.hidden=false;this.phase="host";
      this.record("host_resumed",{resumeTarget:this.saved.resumeOffset,
        observedResumeOffset:last.offset+Math.max(0,ack.time-last.contextTime),
        observedStopOffset:this.saved.observedOffset,prerollStart:start,
        alignmentConfidence:last.confidence,positionIsEstimate:true,timing:this.timingSummary()});
    }catch{
      if(!this.closed&&this.epoch===epoch){
        if(!this.restoreRetries&&this.saved.observedOffset>=1.7){
          this.restoreRetries=1;this.feed.pause();this.pendingResume?.resolve(null);this.pendingResume=null;
          this.saved={...this.saved,resumeOffset:this.saved.observedOffset-.5};
          this.record("resume_retry_rewind",{resumeTarget:this.saved.resumeOffset,replayGuardSeconds:.5,maxRetries:1});
          this.phase="reply";void this.resume();
        }else this.abort("host_resume_timeout");
      }
    }
  }
  abort(code){if(this.closed)return;this.stop();this.fail(code);}
  stop() {
    if(this.closed)return;
    this.closed=true;this.epoch++;this.feed.pause();this.phase="stopped";
    if(this.videoFrameRequest!==null)this.hostVideo.cancelVideoFrameCallback?.(this.videoFrameRequest);
    this.videoFrameRequest=null;
    this.player.pause();this.mixer.silenceNow();
    this.pendingResume?.resolve(null);this.pendingResume=null;
  }
}
