"use client";
import {useEffect,useRef,useState} from "react";
import type {components} from "@/lib/api/schema";
import type {LivePlaybackLog} from "@/lib/live/playback-log";
import {SimliReceiver} from "@/lib/live/simli/receiver.mjs";
import {Button} from "@/components/ui/button";

type Session=components["schemas"]["LiveSessionOut"];
export function SimliHostReceiver({live,connected,onLog}:{live:Session;connected:boolean;onLog:LivePlaybackLog["record"]}){
  const video=useRef<HTMLVideoElement>(null),receiver=useRef<SimliReceiver|null>(null);
  const [phase,setPhase]=useState('waiting');
  const sealed=useRef(false);
  useEffect(()=>{
    if(!connected||live.status==='ended'){receiver.current?.stop(connected?'ended':'disconnected');if(receiver.current)sealed.current=true;return;}
    if(!live.host||live.host.phase==='ended'||receiver.current||sealed.current||!video.current)return;
    const instance=new SimliReceiver({liveId:live.liveId,measureFrames:live.host.transport === "mock",video:video.current,onState:(value:string)=>setPhase(value),
      onDiagnostic:(data:Record<string,unknown>)=>{
        document.dispatchEvent(new CustomEvent('live-simli-viewer',{detail:data}));
        const details:Record<string,string|number|boolean|null>={observation:'receiver_decoder_not_human_hearing'};
        for(const [key,value] of Object.entries(data))if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===null)details[key]=value;
        for(const key of ['rtc','video'])if(data[key]&&typeof data[key]==='object')details[key]=JSON.stringify(data[key]).slice(0,6000);
        onLog(String(data.event),{liveId:live.liveId},details);
      }});
    receiver.current=instance;void instance.start();
  },[live,connected,onLog]);
  useEffect(()=>{
    if(receiver.current?.closed){receiver.current=null;sealed.current=false;}
    const leave=()=>receiver.current?.stop('page_left');window.addEventListener('pagehide',leave);
    return()=>{window.removeEventListener('pagehide',leave);if(receiver.current){sealed.current=true;receiver.current.stop('unmounted');}};
  },[]);
  const labels:Record<string,string>={waiting:'Chưa bắt đầu',connecting:'Đang kết nối…',playing:live.host?.phase==='reply'?'Đang trả lời':live.host?.phase==='restoring'?'Đang tiếp tục kịch bản…':'Đang live',blocked:'Bấm bật hình và tiếng để xem phiên live.',ended:'Đã kết thúc',disconnected:'Mất kết nối phiên live.',unavailable:'Không kết nối được hoặc đã đủ 2 người xem. Hãy thử tải lại khi có chỗ.'};
  const displayPhase=live.status==='ended'||live.host?.phase==='ended'?'ended':phase;
  return <section className="grid gap-2" data-testid="simli-receiver" data-phase={displayPhase}>
    {displayPhase !== "playing" && <p role="status">{labels[displayPhase]??'Có lỗi kết nối. Hãy tải lại trang.'}</p>}
    {live.host?.transport === "mock" && <p className="text-sm text-muted">Người dẫn mô phỏng, dùng audio có sẵn.</p>}
    <video ref={video} autoPlay playsInline controls data-testid="live-media-frame" className="aspect-video w-full max-h-[min(54svh,max(180px,calc(100svh-420px)),560px)] rounded-lg bg-black object-contain lg:max-h-[min(54svh,max(180px,calc(100svh-360px)),560px)]"/>
    {displayPhase==='blocked'&&<Button onClick={()=>void receiver.current?.enable()}>Bật hình và tiếng</Button>}
  </section>;
}
