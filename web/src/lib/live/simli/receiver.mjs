import {gathered,readStamp} from './broadcast.mjs';
import {boundedStats,rtcCounters,mediaCounters} from './stream-diagnostics.mjs';

export class SimliReceiver {
  constructor({liveId,video,onState,onDiagnostic,measureFrames=false}){
    Object.assign(this,{liveId,video,onState,onDiagnostic,measureFrames});this.viewerId=crypto.randomUUID();this.closed=false;this.offerId=null;
    this.onState('connecting');
  }
  async api(path,body){
    const response=await fetch(`/api/live/${this.liveId}/host/${path}`,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(5000),
      keepalive:path.endsWith('/leave'),headers:{...(body?{'Content-Type':'application/json'}:{}),...(this.key?{'X-Live-Viewer-Key':this.key}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){let code='viewer_request_failed';try{code=(await response.json()).error?.code??code;}catch{}this.onDiagnostic({event:'live_simli_viewer_http_error',status:response.status,code});throw Error(code);}return response.status===204?null:response.json();
  }
  async start(){
    try{
      let result;
      for(let attempt=0;attempt<8&&!this.closed;attempt++){
        try{result=await this.api('viewers',{clientId:this.viewerId});break;}
        catch(error){if(error.message!=='host_viewer_limit'||attempt===7)throw error;await new Promise(r=>setTimeout(r,900));}
      }
      if(!result)return;this.key=result.viewerKey;this.epoch=result.epoch;
      if(this.closed){await this.api(`viewers/${this.viewerId}/leave`,{}).catch(()=>{});return;}
      this.timer=setInterval(()=>void this.poll(),500);this.statsTimer=setInterval(()=>void this.stats(),2000);this.statsSamples=0;void this.poll();
    }catch{this.stop('unavailable');}
  }
  async enable(){try{await this.video.play();if(!this.closed)this.onState('playing');}catch{if(!this.closed)this.onState('blocked');}}
  async poll(){
    if(this.closed||this.polling)return;this.polling=true;
    try{
      const data=await this.api(`viewers/${this.viewerId}`);
      if(this.closed)return;
      if(data.epoch!==this.epoch||data.phase==='ended'){this.stop('ended');return;}
      if(!data.offer||this.offerId===data.offerId)return;
      if(this.offerId){this.stop('stale_offer');return;}
      this.offerId=data.offerId;
      const pc=this.pc=new RTCPeerConnection({iceServers:[],bundlePolicy:'max-bundle'});
      pc.ontrack=event=>{
        if(this.closed)return;
        if(this.video.srcObject!==event.streams[0])this.video.srcObject=event.streams[0];
        this.video.onplaying=()=>{if(!this.closed){this.onState('playing');this.onDiagnostic({event:'live_simli_viewer_playing'});this.frames();}};
        void this.enable();
      };
      pc.onconnectionstatechange=()=>{this.onDiagnostic({event:'live_simli_viewer_rtc',state:pc.connectionState});if(['failed','disconnected','closed'].includes(pc.connectionState)&&!this.closed)this.stop('disconnected');};
      await pc.setRemoteDescription({type:'offer',sdp:data.offer});await pc.setLocalDescription(await pc.createAnswer());await gathered(pc);
      if(this.closed)return;
      await this.api(`viewers/${this.viewerId}/answer`,{offerId:this.offerId,sdp:pc.localDescription.sdp});
    }catch(error){this.onDiagnostic({event:'live_simli_viewer_error',name:error.name,code:/^(host|viewer)_/.test(error.message)?error.message:'rtc_failed'});this.stop('disconnected');}finally{this.polling=false;}
  }
  async stats(){
    if(this.closed||this.sampling||this.statsSamples>=46||!this.pc)return;this.sampling=true;
    try{const counters=await boundedStats(async()=>rtcCounters(await this.pc.getStats()));if(!this.closed){this.statsSamples++;
      this.onDiagnostic({event:'live_simli_receiver_sample',atUtc:new Date().toISOString(),rtc:counters,video:mediaCounters(this.video),visibility:document.visibilityState,
        observation:'receiver_counters_not_human_hearing'});
    }}finally{this.sampling=false;}
  }
  frames(){
    if(this.frameCallback||this.closed||!this.measureFrames)return;
    const observe=(_time,metadata)=>{
      this.frameCallback=null;if(this.closed)return;
      const stamp=readStamp(this.video);
      if(stamp){
        const detail={...stamp,decodedAt:Date.now(),mediaTime:metadata.mediaTime};
        this.video.dataset.frame=String(stamp.frame);this.video.dataset.sourceMs=String(stamp.sourceMs);this.video.dataset.phase=String(stamp.phase);
        document.dispatchEvent(new CustomEvent('live-simli-frame',{detail}));
        if(stamp.phase!==this.lastPhase){this.lastPhase=stamp.phase;this.onDiagnostic({event:'live_simli_frame_phase',...detail});}
      }
      this.frameCallback=this.video.requestVideoFrameCallback(observe);
    };
    this.frameCallback=this.video.requestVideoFrameCallback(observe);
  }
  stop(reason='ended'){
    if(this.closed)return;this.closed=true;clearInterval(this.timer);clearInterval(this.statsTimer);
    if(this.frameCallback)this.video.cancelVideoFrameCallback(this.frameCallback);this.frameCallback=null;
    this.pc?.close();this.video.pause();this.video.srcObject?.getTracks().forEach(t=>t.stop());this.video.srcObject=null;this.video.removeAttribute('src');this.video.load();
    if(this.key)void this.api(`viewers/${this.viewerId}/leave`,{}).catch(()=>{});
    this.onState(reason);this.onDiagnostic({event:'live_simli_viewer_cleanup',reason});
  }
}
