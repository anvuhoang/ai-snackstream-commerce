// One output render quantum selects exactly one source. It never sums sources.
class ExclusiveOutput extends AudioWorkletProcessor {
  constructor() {
    super(); this.owner="none";this.sum=0;this.count=0;this.bins=[];this.clockSamples=0;
    this.port.onmessage=({data})=>{
      if(data.kind==="select" && ["none","host","reply"].includes(data.owner)) {
        this.owner=data.owner;
        this.port.postMessage({kind:"selected",id:data.id,owner:this.owner,time:currentTime});
      }
    };
  }
  process(inputs,outputs) {
    const host=inputs[0]??[],reply=inputs[1]??[],out=outputs[0];
    const selected=this.owner==="host"?host:this.owner==="reply"?reply:[];
    for(let channel=0;channel<out.length;channel++) {
      const source=selected[channel]??selected[0];
      if(source)out[channel].set(source);else out[channel].fill(0);
    }
    const length=out[0].length,binSize=Math.round(sampleRate*0.02);
    for(let i=0;i<length;i++) {
      const value=host[0]?.[i]??0;
      this.sum+=value*value;this.count++;
      if(this.count===binSize) {
        this.bins.push(Math.sqrt(this.sum/this.count));this.count=0;this.sum=0;
        if(this.bins.length===5) {
          this.port.postMessage({kind:"probe",bins:this.bins,time:currentTime+(i+1)/sampleRate,owner:this.owner});
          this.bins=[];
        }
      }
    }
    // A render-thread message is independent of chained window timers. The
    // graph already produces the real broadcast audio; no dummy audible sink.
    this.clockSamples+=length;
    if(this.clockSamples>=sampleRate/30){
      this.clockSamples%=sampleRate/30;
      this.port.postMessage({kind:"clock",time:currentTime+length/sampleRate});
    }
    return true;
  }
}
registerProcessor("exclusive-output",ExclusiveOutput);
