// Local PCM echo transport; no provider SDK, token endpoint, microphone or TTS.
export class MockTransport {
  constructor(video,audio){this.video=video;this.audio=audio;this.events={};this.nodes=[];this.nextAt=0;this.epoch=0;}
  on(event,callback){this.events[event]=callback;}
  async start(){
    this.context=new AudioContext({sampleRate:48000});this.destination=this.context.createMediaStreamDestination();
    this.audio.srcObject=this.destination.stream;this.audio.muted=false;
    this.canvas=document.createElement('canvas');this.canvas.width=this.canvas.height=768;
    const paint=()=>{const c=this.canvas.getContext('2d');c.fillStyle='#18372c';c.fillRect(0,0,768,768);c.fillStyle='#8ee5b4';c.beginPath();c.ellipse(384,280,140,170,0,0,Math.PI*2);c.fill();c.fillStyle='white';c.font='28px sans-serif';c.fillText('HOST MÔ PHỎNG · KHÔNG GỌI SIMLI',90,590);c.fillText((this.context.currentTime).toFixed(1)+' s',320,650);};
    paint();this.draw=setInterval(paint,40);this.video.srcObject=this.canvas.captureStream(25);this.video.muted=true;
    await this.context.resume();await this.video.play();
  }
  sendAudioData(bytes){
    if(this.closed)return;
    const n=bytes.byteLength/2,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const buffer=this.context.createBuffer(1,n,16000),values=buffer.getChannelData(0);
    for(let i=0;i<n;i++)values[i]=view.getInt16(i*2,true)/32768;
    const node=this.context.createBufferSource();node.buffer=buffer;node.connect(this.destination);
    const at=this.nextAt?Math.max(this.nextAt,this.context.currentTime+.01):this.context.currentTime+.35;
    this.nextAt=at+n/16000;this.nodes.push(node);node.start(at);
  }
  ClearBuffer(){this.epoch++;for(const n of this.nodes){try{n.stop();}catch{}}this.nodes=[];this.nextAt=0;}
  async stop(){if(this.closed)return;this.closed=true;this.ClearBuffer();clearInterval(this.draw);this.video.srcObject?.getTracks().forEach(t=>t.stop());this.destination?.stream.getTracks().forEach(t=>t.stop());await this.context?.close();}
}
