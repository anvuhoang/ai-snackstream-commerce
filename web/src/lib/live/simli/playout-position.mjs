// Match the envelope of decoded output to the original PCM. Sent bytes only
// bound the search; they are never accepted as evidence of heard position.
export const BIN_SECONDS = 0.02;
export function pcmEnvelope(buffer) {
  const view = new DataView(buffer), frames = Math.ceil(view.byteLength / 640), bins = [];
  for (let bin = 0; bin < frames; bin++) {
    let sum = 0, count = 0;
    for (let p = bin * 640; p < Math.min(view.byteLength, (bin + 1) * 640); p += 2) {
      const value = view.getInt16(p, true) / 32768; sum += value * value; count++;
    }
    bins.push(Math.sqrt(sum / Math.max(1, count)));
  }
  return bins;
}
// Probe windows follow the output AudioContext clock, not file sample zero.
// Compare the same 20ms RMS window at 1ms source phases rather than relaxing
// confidence when a pause/resume puts the two grids out of phase.
export function pcmEnvelopePhases(buffer) {
  const view=new DataView(buffer),samples=view.byteLength/2,prefix=new Float64Array(samples+1);
  for(let i=0;i<samples;i++){const value=view.getInt16(i*2,true)/32768;prefix[i+1]=prefix[i]+value*value;}
  const phases=[];
  for(let phase=0;phase<320;phase+=16){
    const bins=[];
    for(let start=phase;start<samples;start+=320){const end=Math.min(samples,start+320);bins.push(Math.sqrt(Math.max(0,prefix[end]-prefix[start])/(end-start)));}
    phases.push({seconds:phase/16000,bins});
  }
  return phases;
}
export class PlayoutPosition {
  constructor(reference, {windowBins = 50, confidence = 0.94, margin = 0.025, pcm = null} = {}) {
    Object.assign(this, {reference, windowBins, confidence, margin});
    this.phases=pcm?pcmEnvelopePhases(pcm):[{seconds:0,bins:reference}];
    let capacity=0;
    for(const phase of this.phases){
      phase.sums=new Float64Array(phase.bins.length+1);phase.squares=new Float64Array(phase.bins.length+1);
      for(let i=0;i<phase.bins.length;i++){const value=phase.bins[i];phase.sums[i+1]=phase.sums[i]+value;phase.squares[i+1]=phase.squares[i]+value*value;}
      capacity+=phase.bins.length;
    }
    this.scores=new Float64Array(capacity);this.offsets=new Float64Array(capacity);this.centered=new Float64Array(windowBins);this.reset(0);
  }
  reset(start) { this.start = start; this.window = []; this.last = null; }
  observe(bins, contextTime, sentBound) {
    this.window.push(...bins); this.window = this.window.slice(-this.windowBins);
    if (this.window.length < this.windowBins) return null;
    const n = this.windowBins, mean = this.window.reduce((a,b)=>a+b,0)/n;
    const variance = this.window.reduce((a,b)=>a+(b-mean)**2,0);
    if (mean < 0.0005 || variance < 0.000001) return null;
    const earliest=this.last?Math.max(this.start,this.last.offset-n*BIN_SECONDS-0.06):this.start;
    const latest=this.last?Math.min(sentBound,this.last.offset+Math.max(0,contextTime-this.last.contextTime)+0.15):sentBound;
    for(let j=0;j<n;j++)this.centered[j]=this.window[j]-mean;
    let count=0,best=null;
    for(const phase of this.phases){
      const low=Math.max(0,Math.floor((earliest-phase.seconds)/BIN_SECONDS));
      const high=Math.min(phase.bins.length-n,Math.floor((latest-phase.seconds)/BIN_SECONDS)-n);
      for (let i=low; i<=high; i++) {
        let dot=0;
        for (let j=0;j<n;j++)dot+=phase.bins[i+j]*this.centered[j];
        const sum=phase.sums[i+n]-phase.sums[i],square=phase.squares[i+n]-phase.squares[i];
        const denominator=Math.sqrt(Math.max(0,square-sum*sum/n)*variance);
        if(denominator>0){
          const score=dot/denominator,offset=(i+n)*BIN_SECONDS+phase.seconds;
          this.scores[count]=score;this.offsets[count++]=offset;
          if(!best||score>best.score)best={offset,phaseSeconds:phase.seconds,score};
        }
      }
    }
    // Scan the same candidates without sorting/allocating every probe.
    // Adjacent phases describe one position; preserve the 160ms separation.
    let second=-Infinity;
    for(let i=0;best&&i<count;i++)if(Math.abs(this.offsets[i]-best.offset)>=8*BIN_SECONDS-1e-9)second=Math.max(second,this.scores[i]);
    if (!best || best.score<this.confidence || best.score-second<this.margin) return null;
    if (this.last && best.offset<this.last.offset-0.06) return null;
    this.last={offset:Math.min(sentBound,best.offset),contextTime,confidence:best.score,phaseSeconds:best.phaseSeconds};
    return this.last;
  }
  snapshot(now, latency=0) {
    if (!this.last || now-this.last.contextTime>0.5 || now<this.last.contextTime-0.05) return null;
    return {...this.last, observedOffset:Math.max(this.start,this.last.offset-Math.max(0,latency)),
      // Deliberate 200ms replay guard; no promise about exact words or hardware.
      resumeOffset:Math.max(0,this.last.offset-Math.max(0,latency)-0.2)};
  }
}
