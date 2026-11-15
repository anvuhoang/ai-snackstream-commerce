import {VideoFrameSource} from './video-frame-source.mjs';
// Pinned SDK 3.2.0 may resume resetConnections() after a retry backoff even
// after stop(). Keep a terminal guard outside the SDK's mutable shouldStop.
// This adapter does not change node_modules or claim the SDK cancels its timers.
export class HostTransport {
  constructor({loadSimli=()=>import('simli-client'),loadMock=()=>import('./mock-transport.mjs'),observeDecoded=(media,callback)=>new VideoFrameSource(media,callback),onDecodedReady=()=>{}}={}){
    this.loadSimli=loadSimli;this.loadMock=loadMock;this.observeDecoded=observeDecoded;this.onDecodedReady=onDecodedReady;this.closed=false;this.client=null;this.stopping=null;
  }
  async create(token,video,audio,isCurrent=()=>true){
    const active=()=>!this.closed&&isCurrent();
    if(!active())return null;
    const sdk=await (token.transport==='mock'?this.loadMock():this.loadSimli());
    // Imports cannot be canceled. Never run a constructor for a stale generation.
    if(!active())return null;
    if(token.transport==='mock')this.client=new sdk.MockTransport(video,audio);
    else{
      const guard=(target,name)=>{
        if(typeof target?.[name]!=='function')return;
        const method=target[name];
        target[name]=function(...args){if(!active())return Promise.reject(Error('host_transport_closed'));return method.apply(this,args);};
      };
      const observeDecoded=this.observeDecoded,onDecodedReady=this.onDecodedReady;
      class TerminalClient extends sdk.SimliClient {
        resetConnections(...args){if(active()){this.decodedReady?.close();return super.resetConnections(...args);}}
        start(){if(!active())return Promise.reject(Error('host_transport_closed'));return super.start();}
        watchConnection(){
          // Each SDK attempt has its own transport. Fence queued signaling/join
          // callbacks as well as retries, before it can connect another Room.
          guard(this.connection,'connect');guard(this.connection,'join_lk_room');
          guard(this.connection?.pc,'connect');guard(this.connection?.signalingConnection,'connect');
          this.decodedReady?.close();
          const result=super.watchConnection();
          // SDK 3.2.0 normally emits start from the element's compositor
          // callback. Hidden tabs can decode frames without ever presenting one.
          // Broadcast consumes decoded tracks, so one real decoded frame is the
          // matching readiness proof. Do not synthesize frames or bypass errors.
          const connection=this.connection;
          if(video?.addEventListener&&typeof connection?.emit==='function'){
            let decoded;
            decoded=observeDecoded(video,()=>{
              if(!decoded||!active()||this.connection!==connection||this.started||this.failReason||this.retryReason||this.shouldStop)return;
              const frame=decoded.frame;
              if(!(frame?.displayWidth>0&&frame?.displayHeight>0))return;
              onDecodedReady();
              connection.emit('start');
              decoded.close();
            });
            this.decodedReady=decoded;
            connection.on('start',()=>decoded.close());
          }
          // connect() can reject before start() awaits connectionPromise. Keep
          // an observer so a late timeout rejection is never unhandled.
          this.connectionPromise?.catch(()=>{});
          return result;
        }
      }
      // No await between the last generation check and SDK construction; the
      // SDK constructor itself creates its first WebSocket in this version.
      this.client=new TerminalClient(token.sessionToken,video,audio,null,sdk.LogLevel.CRITICAL);
    }
    return this.client;
  }
  stop(){
    if(this.stopping)return this.stopping;
    this.closed=true; // Synchronous tombstone, including while SDK stop hangs.
    const client=this.client;
    if(!client)return this.stopping=Promise.resolve();
    client.decodedReady?.close();
    clearTimeout(client.connectionTimeout);
    this.stopping=(async()=>{
      try{await client.stop();}
      finally{await client.audioContext?.close().catch(()=>{});}
    })();
    return this.stopping;
  }
}
