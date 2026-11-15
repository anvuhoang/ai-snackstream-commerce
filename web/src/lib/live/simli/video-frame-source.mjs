// Observe decoded video frames, independently of compositor visibility. The
// clone shares the source; this class never stops the SDK's original track.
export class VideoFrameSource {
  constructor(media,onFrame,{Processor=globalThis.MediaStreamTrackProcessor}={}){
    Object.assign(this,{media,onFrame,Processor});this.closed=false;this.generation=0;this.version=0;this.active=false;
    this.attach=()=>this.connect();this.empty=()=>{this.reset();this.key=null;};
    for(const name of ['loadedmetadata','playing'])media.addEventListener(name,this.attach);
    media.addEventListener('emptied',this.empty);this.connect();
  }
  connect(){
    if(this.closed||!this.Processor)return;
    const direct=this.media.srcObject?.getVideoTracks?.()[0],key=direct??this.media.src;
    if(!key||key===this.key)return;
    if(!direct&&this.media.readyState<2)return;
    this.reset();this.key=key;
    try{
      const stream=direct?null:this.media.captureStream();
      const track=direct??stream.getVideoTracks()[0];if(!track)return;
      this.ownedStream=stream;this.clone=track.clone();
      const reader=this.reader=new this.Processor({track:this.clone}).readable.getReader();
      this.active=true;const generation=this.generation;
      this.task=(async()=>{
        try{while(!this.closed&&generation===this.generation){
          const {value,done}=await reader.read();if(done)break;
          if(this.closed||generation!==this.generation){value.close();break;}
          this.frame?.close();this.frame=value;this.version++;this.onFrame();
        }}catch{/* The existing worklet-driven path remains the fallback. */}
        finally{if(this.reader===reader)this.active=false;try{reader.releaseLock();}catch{}}
      })();
    }catch{this.reset();} // Unsupported capture/processor must not break playback.
  }
  reset(){
    this.generation++;this.active=false;const reader=this.reader;this.reader=null;
    if(reader)void reader.cancel().catch(()=>{});
    this.clone?.stop();this.clone=null;this.ownedStream?.getTracks().forEach(t=>t.stop());this.ownedStream=null;
    this.frame?.close();this.frame=null;this.version++;
  }
  close(){
    if(this.closed)return;this.closed=true;this.reset();
    for(const name of ['loadedmetadata','playing'])this.media.removeEventListener(name,this.attach);
    this.media.removeEventListener('emptied',this.empty);
  }
}
