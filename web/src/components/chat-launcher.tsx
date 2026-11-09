"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, X } from "lucide-react";
import styles from "./chat-launcher.module.css";

/** Only presentation lives in the main web. AI, FAQ, auth and logs stay in the chat project. */
export function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const base = (process.env.NEXT_PUBLIC_CHAT_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
  useEffect(() => { if (open) close.current?.focus(); }, [open]);
  function dismiss() { setOpen(false); button.current?.focus(); }
  return <aside className={styles.host} aria-label="Hỗ trợ khách hàng">
    <section id="snackstream-chat-panel" className={styles.panel} hidden={!open} aria-label="Chat tư vấn" onKeyDown={(event) => { if (event.key === "Escape") dismiss(); }}>
      <header className={styles.header}><span><Headphones size={16} />Tư vấn trực tuyến</span><button ref={close} onClick={dismiss} aria-label="Đóng khung chat"><X size={18} /></button></header>
      {open && !loaded && <p className={styles.loading} role="status">Đang mở trợ lý…</p>}
      {(open || loaded) && <iframe title="Trợ lý tư vấn SnackStream" src={`${base}/embed`} onLoad={() => setLoaded(true)} className={styles.frame} referrerPolicy="strict-origin-when-cross-origin" />}
    </section>
    <button ref={button} className={styles.launcher} aria-expanded={open} aria-controls="snackstream-chat-panel" onClick={() => open ? dismiss() : setOpen(true)}><Headphones size={20} /><span>Chat tư vấn</span></button>
  </aside>;
}
