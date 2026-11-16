import {pcmEnvelope,PlayoutPosition} from './playout-position.mjs';

// One SDK stream for narration and answer. The existing exclusive mixer remains
// the only audio path to viewers. Observations, not sent bytes, admit playback.
export class PcmReplyPlayer {
  constructor({pcm,mixer,feed,load,quiet,diagnostic,now=performance.now.bind(performance)}){
    Object.assign(this,{pcm,mixer,feed,load,quiet,diagnostic,now});this.epoch=0;this.active=false;this.ended=()=>{};this.error=()=>{};
  }
  onEnded(cb){this.ended=cb;}
  onError(cb){this.error=cb;}
  visible(){}
  position(){if(this.finished)return this.duration;return Math.max(0,Math.min(this.duration??0,(this.tracker?.last?.offset??0)-(this.prefixSeconds??0)));}
  pause(){
    this.epoch++;this.active=false;this.feed.pause();clearTimeout(this.watchdog);
    this.pending?.reject(Error('canceled'));this.pending=null;
  }
  async playFromStart(q,saved){
    this.pause();const epoch=this.epoch;
    if(q.replyKind!=='simli_audio'||!Number.isFinite(q.audioDurationSeconds)||q.audioDurationSeconds<1||q.audioDurationSeconds>90)throw Error('reply_metadata_invalid');
    const raw=await this.load(q);if(epoch!==this.epoch)throw Error('canceled');
    if(raw.byteLength%2||Math.abs(raw.byteLength/32000-q.audioDurationSeconds)>.001)throw Error('reply_duration_mismatch');
    const host=new Uint8Array(this.pcm),start=Math.max(0,Math.floor((saved.resumeOffset-1.2)*16000)*2);
    const reference=pcmEnvelope(this.pcm);
    const suitable=byte=>{const bins=reference.slice(Math.floor(byte/640)+10,Math.floor(byte/640)+60);if(bins.length!==50)return false;const mean=bins.reduce((a,b)=>a+b,0)/50;return mean>=.0005&&bins.reduce((s,v)=>s+(v-mean)**2,0)>=.000001;};
    let prefixStart=start;
    // At script EOF the last 1.2s may be silence. Use a matchable muted prefix
    // elsewhere in the same narration; this never changes the saved host offset.
    if(!suitable(prefixStart)){prefixStart=-1;for(let b=0;b+38400<=host.length;b+=640)if(suitable(b)){prefixStart=b;break;}}
    const lead=host.slice(prefixStart,prefixStart+38400);if(prefixStart<0||lead.byteLength!==38400)throw Error('reply_preroll_missing');
    // Known 1.2s speech prefix for the unchanged matcher, then 0.3s silence.
    // Open the output during that silence, before the first answer sample.
    const joined=new Uint8Array(lead.length+9600+raw.byteLength);joined.set(lead);joined.set(new Uint8Array(raw),lead.length+9600);
    this.buffer=joined.buffer;this.prefixSeconds=1.5;this.duration=q.audioDurationSeconds;
    // Analysis-only tail: real decoded silence lets a complete 1s window
    // cross EOF and distinguish a short/repeated final syllable. Never send
    // this padding to Simli, shorten the answer, or relax matcher confidence.
    this.contentEnd=this.buffer.byteLength/32000;
    const referenceTail=new Uint8Array(joined.length+32000);referenceTail.set(joined);
    this.tracker=new PlayoutPosition(pcmEnvelope(referenceTail.buffer),{pcm:referenceTail.buffer});
    const end=this.now()+2000;
    while(!this.quiet()){
      if(epoch!==this.epoch)throw Error('canceled');if(this.now()>=end)throw Error('reply_quiet_timeout');
      await new Promise(r=>setTimeout(r,25));
    }
    if(epoch!==this.epoch)throw Error('canceled');
    this.active=true;this.finished=false;this.quietSince=null;this.pending=Promise.withResolvers();const started=this.pending.promise;
    this.watchdog=setTimeout(()=>{if(this.active&&epoch===this.epoch){
      this.diagnostic('reply_audio_end_timeout',{durationSeconds:this.duration,
        matchedOffset:this.tracker.last?.offset??null,contentEnd:this.contentEnd,
        quietSeconds:this.quietSince===null?null:Math.max(0,this.mixer.context.currentTime-this.quietSince)});
      this.pause();this.error();
    }},(this.duration+12)*1000);
    this.feed.start(this.buffer);await started;
    if(epoch!==this.epoch)throw Error('canceled');
  }
  selected(ack){
    const last=this.tracker?.last;
    if(!last||last.offset+Math.max(0,ack.time-last.contextTime)>1.35)throw Error('reply_start_alignment_unsafe');
    this.diagnostic('reply_audio_gate_open',{matchedOffset:last.offset,answerStartsAt:1.5,outputContextTime:ack.time});
  }
  probe(data){
    if(!this.active)return;
    if(data.bins.every(x=>x<.001))this.quietSince??=data.time;else this.quietSince=null;
    const sent=this.feed.sentBound();
    // Bytes only bound the search. The analysis tail becomes searchable once
    // all real samples were sent AND quiet is actually decoded. Its offset is
    // still accepted only from the unchanged full-window correlation below;
    // elapsed time or a completed send alone cannot finish playback.
    const bound=sent>=this.contentEnd&&this.quietSince!==null?this.contentEnd+1:sent;
    const match=this.tracker.observe(data.bins,data.time,bound);
    if(this.pending&&match&&match.offset>=1.2){
      const pending=this.pending;this.pending=null;
      if(match.offset+Math.max(0,this.mixer.context.currentTime-match.contextTime)>1.35)pending.reject(Error('reply_start_alignment_unsafe'));
      else pending.resolve(match);
    }
    const last=this.tracker.last;
    if(!this.pending&&last&&last.offset>=this.contentEnd&&this.quietSince!==null&&data.time-this.quietSince>=.3&&data.time-last.contextTime>=this.prefixSeconds+this.duration-last.offset){
      this.finished=true;this.active=false;clearTimeout(this.watchdog);
      this.diagnostic('reply_audio_decoded_end',{durationSeconds:this.duration,matchedOffset:last.offset,contentEnd:this.contentEnd,confidence:last.confidence,contextTime:data.time,observation:'decoded_output_estimate_not_human_confirmation'});
      this.ended();
    }
  }
}
