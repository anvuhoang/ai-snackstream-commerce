export class OutputMixer {
  constructor(audio,reply,onProbe,onOwner) {
    this.audio=audio;this.reply=reply;this.onProbe=onProbe;this.onOwner=onOwner;
    this.owner="none";this.closed=false;this.pending=new Map();this.id=0;
  }
  async start() {
    this.context=new AudioContext();
    this.firstClock=new Promise(resolve=>{this.clockResolve=resolve;});
    await this.context.audioWorklet.addModule("/live/simli-output-worklet.js");
    if(this.closed)throw Error("mixer_closed");
    this.node=new AudioWorkletNode(this.context,"exclusive-output",{
      numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2]});
    this.node.port.onmessage=({data})=>{
      if(this.closed)return;
      if(data.kind==="clock"){
        this.clockSeen=true;this.clockResolve?.(true);this.clockResolve=null;this.onClock?.(data.time);
      }
      else if(data.kind==="probe"){
        const received=performance.now(),gap=this.lastProbeReceived===undefined?null:received-this.lastProbeReceived;
        this.lastProbeReceived=received;
        this.probeMetrics={contextTime:data.time,deliveryAgeSeconds:Math.max(0,this.context.currentTime-data.time),
          maxDeliveryGapMs:Math.max(this.probeMetrics?.maxDeliveryGapMs??0,gap??0),
          rmsMax:Math.max(...data.bins),owner:data.owner};
        this.onProbe(data);
      }
      else if(data.kind==="selected") {
        this.owner=data.owner;this.onOwner(data);
        const pending=this.pending.get(data.id);
        if(pending){clearTimeout(pending.timer);this.pending.delete(data.id);pending.resolve(data);}
      }
    };
    this.exportDestination=this.context.createMediaStreamDestination();
    this.exportStream=this.exportDestination.stream;
    this.node.connect(this.exportDestination);
    // Producer has no audible monitoring path. Viewers receive only this mix.
    // LiveKit attachToElement explicitly sets audio.muted=false. Reroute that
    // native element into a permanently-zero sink BEFORE SDK attach, so even
    // an SDK unmute cannot create a second audible path.
    this.hostNativeSink=this.context.createMediaElementSource(this.audio);
    this.hostNativeGate=this.context.createGain();this.hostNativeGate.gain.value=0;
    this.hostNativeSink.connect(this.hostNativeGate);this.hostNativeGate.connect(this.context.destination);
    this.replySource=this.context.createMediaElementSource(this.reply);
    this.replySource.connect(this.node,0,1);
    this.silenceElement=()=>{if(!this.audio.muted)this.audio.muted=true;if(this.audio.volume!==0)this.audio.volume=0;};
    this.audio.addEventListener("volumechange",this.silenceElement);this.silenceElement();
    this.attach=()=>{
      this.silenceElement();
      const stream=this.audio.srcObject;
      if(this.closed||!stream?.getAudioTracks?.().length||stream===this.stream)return;
      this.hostSource?.disconnect();this.stream=stream;
      this.hostSource=this.context.createMediaStreamSource(stream);this.hostSource.connect(this.node,0,0);
    };
    this.audio.addEventListener("loadedmetadata",this.attach);this.audio.addEventListener("playing",this.attach);
    this.attach();
    await this.context.resume();
    if(this.closed)throw Error("mixer_closed");
    await this.select("host");
    const available=await Promise.race([this.firstClock,new Promise(resolve=>{this.clockTimer=setTimeout(()=>resolve(false),1000);})]);
    clearTimeout(this.clockTimer);
    if(this.closed||!available)throw Error("mixer_clock_unavailable");
  }
  select(owner) {
    if(this.closed||!this.node)return Promise.reject(Error("mixer_closed"));
    return new Promise((resolve,reject)=>{
      const id=++this.id;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error("output_switch_timeout"));},1000);
      this.pending.set(id,{resolve,reject,timer});this.node.port.postMessage({kind:"select",owner,id});
    });
  }
  latency() {
    const values=[this.context?.baseLatency,this.context?.outputLatency].filter(Number.isFinite);
    return Math.min(0.5,values.length?values.reduce((a,b)=>a+b,0):0.1);
  }
  silenceNow() {
    // Disconnect the only audible destination synchronously on stop/errors.
    try{this.node?.disconnect();}catch{}
    this.owner="none";
  }
  close() {
    if(this.closed)return;
    this.closed=true;this.clockResolve?.(false);this.clockResolve=null;clearTimeout(this.clockTimer);this.onClock=null;this.silenceNow();
    this.exportStream?.getTracks().forEach(track=>track.stop());
    this.audio.removeEventListener("loadedmetadata",this.attach);this.audio.removeEventListener("playing",this.attach);
    this.audio.removeEventListener("volumechange",this.silenceElement);
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error("mixer_closed"));}
    this.pending.clear();
    try{this.hostSource?.disconnect();this.replySource?.disconnect();this.hostNativeSink?.disconnect();this.hostNativeGate?.disconnect();}catch{}
    if(this.context)void this.context.close().catch(()=>{});
  }
}
