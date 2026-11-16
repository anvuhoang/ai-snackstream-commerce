"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {useAdmin} from "@/components/admin/admin-shell";
import {Button} from "@/components/ui/button";
import {SimliProducer} from "@/lib/live/simli/producer.mjs";
import type {components} from "@/lib/api/schema";

type Session=components["schemas"]["LiveSessionOut"];
export function SimliHostProducer({live,onStarting}:{live:Session;onStarting?:(started:boolean)=>void}){
  const {user,csrf}=useAdmin();
  const router=useRouter();
  const cleanupDone=useRef(false),endRefreshed=useRef(false),checkingEnd=useRef(false);
  const canvas=useRef<HTMLCanvasElement>(null),hostVideo=useRef<HTMLVideoElement>(null),hostAudio=useRef<HTMLAudioElement>(null),replyVideo=useRef<HTMLVideoElement>(null);
  const engine=useRef<SimliProducer|null>(null),starting=useRef(false);
  const [transport,setTransport]=useState<string|null>(live.host?.transport??null);
  const [phase,setPhase]=useState("idle"),[message,setMessage]=useState("");
  const confirmEnded=useCallback(async()=>{
    if(!cleanupDone.current||endRefreshed.current||checkingEnd.current)return;
    checkingEnd.current=true;
    try{
      const response=await fetch('/api/live/current',{cache:'no-store',signal:AbortSignal.timeout(3000)});
      if(!response.ok)return;
      const {session}=await response.json();
      if(session?.liveId===live.liveId&&session.status==='ended'){
        endRefreshed.current=true;
        document.dispatchEvent(new CustomEvent('live-simli-producer',{detail:{event:'admin_end_confirmed',liveId:live.liveId}}));
        router.refresh(); // RSC update only after backend end and local cleanup.
      }
    }catch{}finally{checkingEnd.current=false;}
  },[live.liveId,router]);
  useEffect(()=>{
    void fetch('/api/admin/live/host-capabilities',{headers:{'X-CSRF-Token':csrf}}).then(r=>r.ok?r.json():null).then(data=>setTransport(data?.transport??null)).catch(()=>{});
  },[csrf]);
  useEffect(()=>{
    const events=new EventSource('/api/live/events');
    events.addEventListener('state',event=>{try{const session=JSON.parse(event.data).session;engine.current?.snapshot(session);if(session?.liveId===live.liveId&&session.status==='ended'){if(!engine.current)cleanupDone.current=true;void confirmEnded();}}catch{void engine.current?.stop('invalid_state');}});
    events.onerror=()=>{void engine.current?.stop('sse_disconnected');};
    const pageLeft=()=>{void engine.current?.stop('page_left');};window.addEventListener('pagehide',pageLeft);
    return()=>{events.close();window.removeEventListener('pagehide',pageLeft);void engine.current?.stop('unmounted');};
  },[live.liveId,confirmEnded]);
  async function start(){
    if((Boolean(live.products?.length)&&!live.hostAudioReady)||starting.current||engine.current||user.role!=='admin'||!canvas.current||!hostVideo.current||!hostAudio.current||!replyVideo.current)return;
    if(!window.confirm(transport === "mock" ? "Bắt đầu phiên live mô phỏng?" : "Bắt đầu live sẽ sử dụng hạn mức dịch vụ. Bạn muốn tiếp tục?"))return;
    onStarting?.(true);
    starting.current=true;setMessage('');
    const instance=new SimliProducer({liveId:live.liveId,csrf,canvas:canvas.current,hostVideo:hostVideo.current,hostAudio:hostAudio.current,replyVideo:replyVideo.current,
      onState:(value:string)=>setPhase(value),onSession:()=>{},onDiagnostic:(data:Record<string,unknown>)=>{
        document.dispatchEvent(new CustomEvent('live-simli-producer',{detail:data}));
        if(data.event==='host_cleanup'){cleanupDone.current=true;void confirmEnded();setMessage(['manual','session_ended','session_limit','unmounted','page_left'].includes(String(data.reason))?'':'Phiên đã dừng. Kiểm tra kết nối trước khi tạo phiên mới.');
      }}});
    engine.current=instance;await instance.start();starting.current=false;
  }
  const labels:Record<string,string>={idle:'Chưa bắt đầu',preparing:'Đang kết nối…',script:'Đang live',host:'Đang live',handoff:'Đang chuẩn bị trả lời…',loading_reply:'Đang tải câu trả lời…',reply:'Đang trả lời',resuming:'Đang tiếp tục kịch bản…',closing:'Đang kết thúc…',ended:'Đã kết thúc'};
  if(user.role!=='admin')return <p>Chỉ quản trị viên mới có thể điều khiển phiên.</p>;
  return <section className="grid gap-3" data-testid="simli-producer" data-phase={phase} data-audio-ready={live.hostAudioReady || !live.products?.length}>
    <p className="text-sm text-muted">Tối đa 90 giây · 2 người xem. Chưa hỗ trợ tạm dừng.</p>
    <p className="text-sm text-muted">Chờ đủ 120 giây từ lần bắt đầu trước để mở lượt mới.</p>
    {(transport === "mock" || live.host?.transport === "mock") && <p className="text-sm text-muted">Người dẫn mô phỏng, dùng audio có sẵn.</p>}
    {transport !== "mock" && <p className="text-sm text-muted">Bắt đầu live có sử dụng hạn mức dịch vụ.</p>}
    <div className="flex gap-3"><Button data-testid="host-start" disabled={(Boolean(live.products?.length)&&!live.hostAudioReady)||phase!=="idle"||live.status!=="not_started"} onClick={()=>void start()}>Bắt đầu live</Button>
      <Button data-testid="host-stop" variant="outline" disabled={phase==="ended"||live.status==="ended"} onClick={()=>{
        if(engine.current)void engine.current.stop();
        else void fetch(`/api/admin/live/${live.liveId}/end`,{method:'POST',headers:{'X-CSRF-Token':csrf}}).then(r=>{if(r.ok){cleanupDone.current=true;setPhase('ended');void confirmEnded();}});
      }}>Kết thúc live</Button></div>
    {Boolean(live.products?.length)&&!live.hostAudioReady&&<p role="status" className="text-sm text-muted">Hãy tạo audio cho sản phẩm trước khi bắt đầu.</p>}
    <p className="text-sm text-muted">SKU đang giới thiệu: <strong>{live.pinnedSku}</strong></p>
    <p role="status">{live.status === "ended" ? labels.ended : labels[phase]??"Có lỗi kết nối"}</p>
    <canvas ref={canvas} className="aspect-square w-full rounded-lg bg-black" aria-label="Hình ảnh phiên live"/>
    <div hidden><video ref={hostVideo} muted playsInline/><audio ref={hostAudio} muted/><video ref={replyVideo} playsInline/></div>
    {message&&<p role="alert" className="text-sm text-danger">{message}</p>}
  </section>;
}
