"use client";

import { useEffect, useRef, useState } from "react";
import { ProductPhoto } from "@/components/product-photo";
import { MessageCircle, Send, X, Sparkles, Headphones, Plus } from "lucide-react";
import styles from "./chat-widget.module.css";
import { browserApi } from "@/lib/api/browser";

type Product = { sku: string; name: string; price: number; currency: string; image_url?: string | null; product_url?: string | null };
type Message = { role: "user" | "assistant"; content: string; products?: Product[]; questionId?: string | null };
const ERRORS: Record<string, string> = {
  bot_disabled: "Chatbot đang tạm tắt. Xem hướng dẫn liên hệ bên dưới.",
  human_takeover: "Nhân viên đã tiếp nhận yêu cầu. AI đang tạm dừng trong hội thoại này.",
  ai_free_tier_unconfirmed: "Chưa xác nhận dự án Gemini miễn phí. Cửa hàng cần kiểm tra cấu hình trước khi bật AI.",
  ai_quota_exceeded: "Đã hết hạn mức Gemini miễn phí. Vui lòng thử lại sau; hệ thống không chuyển sang dịch vụ trả phí.",
  ai_not_configured: "Chatbot chưa được cấu hình dịch vụ AI. Vui lòng liên hệ cửa hàng.",
  odoo_not_configured: "Cửa hàng chưa cấu hình kết nối sản phẩm. Vui lòng quay lại sau.",
  odoo_unavailable: "Chưa đọc được sản phẩm từ cửa hàng. Bạn thử lại sau nhé.",
  chat_rate_limited: "Chat đang bận, bạn chờ một phút rồi thử lại nhé.",
};

export function ChatWidget({ embedded = false, sku = null }: { embedded?: boolean; sku?: string | null } = {}) {
  const currentSku = sku;
  const [open, setOpen] = useState(embedded);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState("");
  const [status, setStatus] = useState<{ enabled: boolean; contactText: string; supportState?: string | null } | null>(null);
  // The generated API types mark fields that have a default as optional, so fill the gaps once here.
  const toStatus = (s: { enabled?: boolean; contactText?: string; supportState?: string | null }) => ({
    enabled: s.enabled ?? false,
    contactText: s.contactText ?? "",
    supportState: s.supportState,
  });
  const [statusError, setStatusError] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const blocked = !status || !status.enabled || status.supportState === "active";
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function refresh() {
      try {
        const { data } = await browserApi.GET("/api/chat/status");
        if (!cancelled) {
          if (data) { setStatus(toStatus(data)); setStatusError(false); }
          else { setStatus(null); setStatusError(true); }
        }
      } catch { if (!cancelled) { setStatus(null); setStatusError(true); } }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [open]);
  async function requestSupport() {
    setSupportBusy(true); setError("");
    try {
      const message = text.trim() || messages.filter((m) => m.role === "user").at(-1)?.content || "Tôi cần nhân viên hỗ trợ.";
      const { data } = await browserApi.POST("/api/chat/support", {
        headers: { "X-Chat-Action": "support" }, body: { message },
      });
      if (!data) throw new Error("Chưa gửi được yêu cầu hỗ trợ. Bạn thử lại nhé.");
      const { data: latest } = await browserApi.GET("/api/chat/status");
      if (latest) setStatus(toStatus(latest));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Mất kết nối."); }
    finally { setSupportBusy(false); }
  }
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy, error]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  // Other parts of the site (the home page bar) open the chat with this event.
  useEffect(() => {
    const openChat = () => setOpen(true);
    window.addEventListener("snackstream:chat-open", openChat);
    return () => window.removeEventListener("snackstream:chat-open", openChat);
  }, []);

  async function send(value: string) {
    const question = value.trim();
    if (!question || busy || blocked) return;
    setBusy(true); setError(""); setFailed(""); setText("");
    const history = messages.slice(-10).map(({ role, content }) => ({ role, content }));
    try {
      const sku = currentSku ?? new URLSearchParams(window.location.search).get("sku");
      const { data, error: apiError } = await browserApi.POST("/api/chat/messages", {
        body: { message: question, history, sku },
      });
      if (!data) {
        const code = (apiError as { error?: { code?: string } } | undefined)?.error?.code;
        throw new Error(ERRORS[code ?? ""] ?? "AI chưa trả lời được. Bạn thử lại hoặc liên hệ cửa hàng nhé.");
      }
      setMessages((previous) => [...previous,
        { role: "user", content: question },
        { role: "assistant", content: data.answer, products: data.products, questionId: data.questionId },
      ]);
    } catch (cause) {
      setFailed(question);
      setError(cause instanceof Error ? cause.message : "Mất kết nối. Bạn thử lại nhé.");
    } finally { setBusy(false); }
  }

  async function cardClick(questionId: string | null | undefined, sku: string) {
    if (!questionId) return;
    await browserApi.POST("/api/chat/questions/{question_id}/click", {
      params: { path: { question_id: questionId } }, body: { sku },
    }).catch(() => undefined);
  }

  return (
    <aside className={embedded ? styles.embedded : styles.floating} aria-label="Trợ lý SnackStream">
      {!open ? <button type="button" aria-expanded={open} aria-controls="snackstream-chat-window" className={styles.launcher} onClick={() => setOpen(true)}><MessageCircle size={20} /> Chat với SnackStream</button> :
        <section id="snackstream-chat-window" className={styles.panel} aria-label="Hội thoại" onKeyDown={(e) => { if (e.key === "Escape" && !embedded) setOpen(false); }}>
          <header className={styles.header}>
            <span className={styles.avatar}><Sparkles size={20} /></span>
            <div className={styles.heading}><strong>Trợ lý SnackStream</strong><span><i />{status ? status.enabled ? "Sẵn sàng hỗ trợ bạn" : "Đang tạm nghỉ" : statusError ? "Chưa kết nối được máy chủ" : "Đang kết nối…"}</span></div>
            <button className={styles.iconButton} title="Xóa nội dung trên màn hình" aria-label="Xóa nội dung chat trên màn hình" disabled={busy} onClick={() => { setMessages([]); setError(""); setText(""); }}><Plus size={20} /></button>
            {!embedded && <button className={styles.iconButton} aria-label="Đóng chat" onClick={() => setOpen(false)}><X size={20} /></button>}
          </header>
          {statusError && <div className={styles.error} role="alert">Chưa kết nối được backend. Hãy kiểm tra terminal API đang chạy ở cổng 8000; hệ thống sẽ thử kết nối lại.</div>}
          <div className={styles.thread} role="log" aria-live="polite" aria-busy={busy}>
            {messages.length === 0 && <div className={styles.welcome}>
              <span className={styles.welcomeIcon}><Sparkles size={28} /></span>
              <span className={styles.eyebrow}>SNACKSTREAM ASSISTANT</span>
              <h1>Hôm nay bạn muốn<br />tìm món gì?</h1>
              <p>Mình giúp bạn tìm món ăn vặt, kiểm tra giá và số lượng còn hàng.</p>
              <div className={styles.suggestions}>{["Bánh tráng me cay giá bao nhiêu?", "Da cá trứng muối còn hàng không?", "Chatbot hỗ trợ những gì?"].map((question) => <button key={question} disabled={busy || blocked} onClick={() => void send(question)}>{question}<span>↗</span></button>)}</div>
            </div>}
            {currentSku && <p className={styles.context}>Đang tư vấn sản phẩm {currentSku}</p>}
            {messages.map((message, index) => <div key={index} className={message.role === "user" ? styles.userRow : styles.botRow}>
              {message.role === "assistant" && <span className={styles.smallAvatar}><Sparkles size={14} /></span>}
              <div className={message.role === "user" ? styles.userBubble : styles.botBubble}>
                <p>{message.content}</p>
                {message.products?.map((product) => <button key={product.sku} className={styles.product} onClick={() => { setText(`Tư vấn thêm về ${product.name} (${product.sku})`); void cardClick(message.questionId, product.sku); input.current?.focus(); }}>
                  <span className={styles.photo}><ProductPhoto src={product.image_url} name={product.name} sizes="64px" /></span>
                  <span><strong>{product.name}</strong><small>{product.sku}</small><b>{new Intl.NumberFormat("vi-VN").format(product.price)} {product.currency}</b></span>
                </button>)}
              </div>
            </div>)}
            {busy && <div className={styles.typing}><Sparkles size={14} /><span>Đang tra thông tin và trả lời…</span></div>}
            {error && <div className={styles.error} role="alert"><p>{error}</p>{failed && <button onClick={() => void send(failed)} disabled={busy || blocked}>Thử lại câu hỏi</button>}</div>}
            <div ref={end} />
          </div>
          <div className={styles.bottom}>
            {status && (!status.enabled || status.supportState) && <div className={styles.context} role="status">{!status.enabled ? "AI đang tạm tắt. " : ""}{status.supportState === "requested" ? "Đã ghi nhận yêu cầu, đang chờ nhân viên tiếp nhận." : status.supportState === "active" ? "Nhân viên đã tiếp nhận. AI tạm dừng trong hội thoại." : status.supportState === "resolved" ? "Yêu cầu hỗ trợ đã được xử lý." : ""}</div>}
            <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void send(text); }}>
              <input ref={input} aria-label="Nhập câu hỏi" placeholder="Hỏi mình về món bạn thích…" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} disabled={busy || blocked} />
              <button aria-label="Gửi câu hỏi" disabled={busy || blocked || !text.trim()}><Send size={18} /></button>
            </form>
            <div className={styles.footnote}><span>AI có thể nhầm. Hội thoại được lưu để hỗ trợ.</span><button onClick={() => void requestSupport()} disabled={supportBusy || status?.supportState === "requested" || status?.supportState === "active"}><Headphones size={13} />{supportBusy ? "Đang gửi…" : "Cần hỗ trợ"}</button></div>
            <details className={styles.contact}><summary>Thông tin liên hệ & quyền riêng tư</summary><p>{status?.contactText || "Đang tải thông tin liên hệ…"}</p><p>Không gửi mật khẩu, API key hoặc thông tin nhạy cảm vào hội thoại.</p></details>
          </div>
        </section>}
    </aside>
  );
}
