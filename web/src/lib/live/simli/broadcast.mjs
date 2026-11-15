import {VideoFrameSource} from './video-frame-source.mjs';
// Stable composite/output tracks; only the producer owns source media.
export async function gathered(pc){
  if(pc.iceGatheringState==='complete')return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',check);reject(Error('ice_timeout'));},3000);
    const check=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();}};
    pc.addEventListener('icegatheringstatechange',check);check();
  });
}

// Burn-in metadata is decoded from received frames in automated tests. It does
// not control playback or claim acoustic synchronization at listeners' ears.
export function drawStamp(ctx,canvas,{frame,phase,offset,reply}){
  const fields=[[0xA5,8],[frame,20],[Date.now()>>>0,32],[phase,2],[Math.min(65535,Math.round(offset*1000)),16],[Math.min(8191,Math.round(reply*1000)),13]];
  let bit=0;for(const [value,width] of fields)for(let i=width-1;i>=0;i--){ctx.fillStyle=(Math.floor(value/2**i)%2)?'#fff':'#000';ctx.fillRect(16+(bit++)*8,canvas.height-24,8,16);}
}
const decoderCanvases=new WeakMap();
export function readStamp(video){
  if(!video.videoWidth)return null;
  let c=decoderCanvases.get(video);if(!c){c=document.createElement('canvas');c.width=c.height=768;decoderCanvases.set(video,c);}
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,0,0,768,768);const bits=[],pixels=ctx.getImageData(0,752,768,1).data;
  for(let bit=0;bit<91;bit++){const i=(20+bit*8)*4;bits.push((pixels[i]+pixels[i+1]+pixels[i+2])/3>128?1:0);}
  let index=0;const number=width=>{let value=0;for(let i=0;i<width;i++)value=value*2+bits[index++];return value;};
  if(number(8)!==0xA5)return null;
  const stamp={frame:number(20),producerTimeLow:number(32),phase:number(2),sourceMs:number(16),replyMs:number(13)};
  if(stamp.phase>2||((Date.now()>>>0)-stamp.producerTimeLow>>>0)>5000)return null;
  return stamp;
}

// Prefer the measured lower-cost outgoing encoder when both browsers support
// it. Preserve all remaining codecs/FEC/RTX so negotiation can still fall back.
export function preferBroadcastVideoCodec(pc,Receiver=globalThis.RTCRtpReceiver){
  try{
    const codecs=Receiver?.getCapabilities?.('video')?.codecs;
    if(!Array.isArray(codecs))return false;
    const preferred=codecs.filter(c=>c.mimeType?.toLowerCase()==='video/h264');
    const video=pc.getTransceivers().filter(t=>t.sender.track?.kind==='video');
    if(!preferred.length||!video.length||video.some(t=>typeof t.setCodecPreferences!=='function'))return false;
    const ordered=[...preferred,...codecs.filter(c=>c.mimeType?.toLowerCase()!=='video/h264')];
    for(const transceiver of video)transceiver.setCodecPreferences(ordered);
    return true;
  }catch{return false;}
}

export class HostBroadcast {
  constructor({canvas,hostVideo,replyVideo,mixer,coordinator,offer,diagnostic,markFrames=false,externallyClocked=false}){
    Object.assign(this,{canvas,hostVideo,replyVideo,mixer,coordinator,offer,diagnostic,markFrames});this.peers=new Map();this.closed=false;this.frame=0;
    canvas.width=canvas.height=768;this.videoStream=canvas.captureStream(0);
    this.captureTrack=this.videoStream.getVideoTracks()[0];
    if(typeof this.captureTrack?.requestFrame!=='function'){
      this.videoStream.getTracks().forEach(track=>track.stop());this.videoStream=canvas.captureStream(30);this.captureTrack=null;
    }
    this.stream=new MediaStream([...this.videoStream.getVideoTracks(),...mixer.exportStream.getAudioTracks()]);
    this.sources={host:new VideoFrameSource(hostVideo,()=>this.draw()),reply:new VideoFrameSource(replyVideo,()=>this.draw())};
    this.drawMetrics={calls:0,maxGapMs:0,maxDrawMs:0};if(!externallyClocked)this.timer=setInterval(()=>this.draw(),33);this.draw();
  }
  draw(){
    if(this.closed)return;
    const source=this.sources[this.mixer.owner==='reply'?'reply':'host'];source.connect();
    const signature=[this.mixer.owner,this.coordinator.phase,source.version].join(':');
    this.drawMetrics.frameClock=source.active?'decoded':'worklet-fallback';this.drawMetrics.captureMode=this.captureTrack?'per-paint':'periodic-fallback';this.drawMetrics.sourceTimestampUs=source.frame?.timestamp??null;
    if(source.active&&this.lastPaint===signature){this.drawMetrics.skippedUnchanged=(this.drawMetrics.skippedUnchanged??0)+1;return;}
    this.lastPaint=signature;
    const started=performance.now();this.drawMetrics.calls++;this.drawMetrics.maxGapMs=Math.max(this.drawMetrics.maxGapMs,this.lastDraw===undefined?0:started-this.lastDraw);this.lastDraw=started;
    const {canvas,coordinator,mixer}=this,ctx=canvas.getContext('2d');
    ctx.fillStyle='#12281f';ctx.fillRect(0,0,768,768);
    const media=mixer.owner==='reply'?this.replyVideo:this.hostVideo;
    const frame=source.active?source.frame:null,width=frame?.displayWidth??media.videoWidth,height=frame?.displayHeight??media.videoHeight;
    if((frame||media.readyState>=2)&&width){const ratio=Math.min(768/width,768/height),w=width*ratio,h=height*ratio;ctx.drawImage(frame??media,(768-w)/2,(768-h)/2,w,h);}
    if(this.markFrames)drawStamp(ctx,canvas,{frame:++this.frame,phase:coordinator.phase==='reply'?2:mixer.owner==='host'?1:mixer.owner==='reply'?2:0,offset:coordinator.tracker.last?.offset??0,reply:coordinator.audioReply?coordinator.player.position():this.replyVideo.currentTime});
    this.captureTrack?.requestFrame();
    this.drawMetrics.maxDrawMs=Math.max(this.drawMetrics.maxDrawMs,performance.now()-started);
  }
  async update(peers){
    if(this.closed)return;
    const ids=new Set(peers.map(p=>p.viewerId));
    for(const [id,p] of this.peers)if(!ids.has(id)){p.pc.close();this.peers.delete(id);}
    for(const peer of peers){
      let entry=this.peers.get(peer.viewerId);
      if(!entry){
        const pc=new RTCPeerConnection({iceServers:[],bundlePolicy:'max-bundle'}),offerId=crypto.randomUUID();
        entry={pc,offerId,pending:true};this.peers.set(peer.viewerId,entry);
        for(const track of this.stream.getTracks())pc.addTrack(track,this.stream);
        entry.videoCodecPreference=preferBroadcastVideoCodec(pc)?'H264':'browser-default';
        this.diagnostic('broadcast_codec_preference',{preferred:entry.videoCodecPreference,negotiated:false});
        void (async()=>{
          try{await pc.setLocalDescription(await pc.createOffer());await gathered(pc);if(this.closed||this.peers.get(peer.viewerId)!==entry)return;
            await this.offer({viewerId:peer.viewerId,offerId,sdp:pc.localDescription.sdp});entry.pending=false;
          }catch{pc.close();this.diagnostic('peer_failed',{viewerId:peer.viewerId});}
        })();
      }
      if(peer.answer&&!entry.pc.remoteDescription&&!entry.answering){
        entry.answering=true;try{await entry.pc.setRemoteDescription({type:'answer',sdp:peer.answer});}catch{entry.pc.close();}
      }
    }
  }
  close(){if(this.closed)return;this.closed=true;clearInterval(this.timer);for(const source of Object.values(this.sources))source.close();for(const p of this.peers.values())p.pc.close();this.peers.clear();this.stream.getTracks().forEach(t=>t.stop());}
}
