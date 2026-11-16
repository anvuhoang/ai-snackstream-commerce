// Pace the existing PCM, in order, from the output AudioContext clock. No sample
// is skipped to catch up; a bounded batch yields to the next worklet pulse.
export class ClockedPcmFeed {
  constructor({pcm,send,sent=()=>{},complete=()=>{}}){Object.assign(this,{pcm,send,sent,complete});this.generation=0;this.running=false;}
  start(position,time){
    this.stop();this.origin=this.offset=Math.min(this.pcm.length,Math.max(0,Math.floor(position*16000)*2));
    this.startedAt=time;this.running=true;this.tick(time);
  }
  tick(time){
    if(!this.running||!Number.isFinite(time)||time<this.startedAt)return;
    const generation=this.generation;let budget=8;
    while(this.running&&generation===this.generation&&this.offset<this.pcm.length&&budget--){
      const due=this.startedAt+(this.offset-this.origin)/32000;
      if(time+1e-9<due)break;
      const chunk=this.pcm.subarray(this.offset,Math.min(this.offset+6000,this.pcm.length));
      this.send(chunk);
      if(!this.running||generation!==this.generation)return;
      this.offset+=chunk.length;this.sent(this.offset,chunk.length,due);
    }
    if(this.running&&generation===this.generation&&this.offset===this.pcm.length&&time+1e-9>=this.startedAt+(this.pcm.length-this.origin)/32000){
      this.running=false;this.complete(time);
    }
  }
  stop(){this.running=false;this.generation++;}
}
