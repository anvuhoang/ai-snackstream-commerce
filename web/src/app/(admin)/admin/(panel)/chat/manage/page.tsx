"use client";

import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/admin-shell";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { components } from "@/lib/api/schema";

type Faq = components["schemas"]["FAQEntry"];
type Config = components["schemas"]["BotConfig"];
type Support = components["schemas"]["SupportEntry"];
const blank = { question: "", answer: "", approved: false };

export default function ChatManagement() {
  const { csrf } = useAdmin();
  const [config, setConfig] = useState<Config>({ enabled: true, contactText: "" });
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [support, setSupport] = useState<Support[]>([]);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState(blank);
  const [editId, setEditId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const results = await Promise.all([
      browserApi.GET("/api/admin/chat/settings"), browserApi.GET("/api/admin/chat/faqs"),
      browserApi.GET("/api/admin/chat/support", { params: { query: { offset, limit: 20 } } }),
    ]);
    if (!results[0].data || !results[1].data || !results[2].data) throw new Error("Không tải được dữ liệu. Kiểm tra phiên đăng nhập rồi thử lại.");
    setConfig(results[0].data); setFaqs(results[1].data); setSupport(results[2].data); setReady(true);
  }, [offset]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) void load().catch(() => setError("Không tải được dữ liệu. Thử làm mới.")); }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [load]);
  async function action(work: () => Promise<{ response: Response }>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await work();
      if (!result.response.ok) throw new Error("Không lưu được thay đổi. Tải lại trang rồi thử lại.");
      await load(); setNotice(message); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Mất kết nối."); return false; }
    finally { setBusy(false); }
  }
  const headers = adminHeaders(csrf);
  return <section className={`${styles.page} ${styles.management}`}>
    <div className={styles.pageHeading}><div><span className={styles.eyebrow}>ASSISTANT SETTINGS</span><h1>FAQ & hỗ trợ</h1><p>Nội dung rõ ràng. Trợ lý đáng tin cậy hơn.</p></div><Link className={styles.secondary} href="/admin/chat">← Hội thoại</Link></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}{notice && <p role="status" className="text-green-700">{notice}</p>}
    <button className="underline" disabled={busy} onClick={() => void load().catch(() => setError("Không tải được dữ liệu."))}>Làm mới dữ liệu</button>
    {!ready ? <p>Đang tải cấu hình…</p> : <>
      <form className="space-y-3 rounded-xl border border-line p-4" onSubmit={(e) => { e.preventDefault(); void action(() => browserApi.PUT("/api/admin/chat/settings", { headers, body: config }), "Đã lưu cấu hình."); }}>
        <h2 className="text-lg font-semibold">Trạng thái bot và liên hệ</h2>
        <label className="flex gap-2"><input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />Bật trả lời bằng AI</label>
        <label className="block">Hướng dẫn liên hệ khi tắt bot / cần hỗ trợ<textarea required maxLength={1000} className="mt-1 block w-full rounded border border-line p-2" value={config.contactText} onChange={(e) => setConfig({ ...config, contactText: e.target.value })} /></label>
        <button disabled={busy} className="rounded bg-brand px-4 py-2 text-white">Lưu cấu hình</button>
      </form>
      <section className="space-y-3 rounded-xl border border-line p-4"><h2 className="text-lg font-semibold">FAQ đã duyệt và bản nháp</h2>
        <p className="text-sm text-muted">Chỉ FAQ được duyệt mới gửi cho AI. Không nhập giá hoặc tồn cố định; dữ liệu đó lấy từ Odoo.</p>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await action(() => editId === null ? browserApi.POST("/api/admin/chat/faqs", { headers, body: draft }) : browserApi.PUT("/api/admin/chat/faqs/{faq_id}", { headers, params: { path: { faq_id: editId } }, body: draft }), "Đã lưu FAQ."); if (ok) { setDraft(blank); setEditId(null); } }}>
          <label className="block">Câu hỏi<input required maxLength={500} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value, approved: false })} className="mt-1 block w-full rounded border border-line p-2" /></label>
          <label className="block">Câu trả lời<textarea required maxLength={4000} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value, approved: false })} className="mt-1 block w-full rounded border border-line p-2" /></label>
          <label className="flex gap-2"><input type="checkbox" checked={draft.approved} onChange={(e) => setDraft({ ...draft, approved: e.target.checked })} />Đã kiểm tra nội dung, cho phép AI sử dụng</label>
          <button disabled={busy} className="rounded bg-brand px-4 py-2 text-white">{editId === null ? "Thêm FAQ" : "Lưu FAQ"}</button>{editId !== null && <button type="button" className="ml-3 underline" onClick={() => { setDraft(blank); setEditId(null); }}>Hủy sửa</button>}
        </form>
        {faqs.length === 0 && <p>Chưa có FAQ. Hãy nhập chính sách thật của cửa hàng.</p>}
        {faqs.map((faq) => <article key={faq.id} className="space-y-2 border-t border-line pt-3"><h3 className="font-semibold">{faq.question}</h3><p className="whitespace-pre-wrap break-words">{faq.answer}</p><p className="text-sm text-muted">{faq.approved ? "Đã duyệt" : "Bản nháp"}</p><button className="underline" disabled={busy} onClick={() => { setEditId(faq.id); setDraft({ question: faq.question ?? "", answer: faq.answer ?? "", approved: faq.approved ?? false }); }}>Sửa</button><button className="ml-4 underline" disabled={busy} onClick={() => void action(() => browserApi.PUT("/api/admin/chat/faqs/{faq_id}", { headers, params: { path: { faq_id: faq.id } }, body: { question: faq.question, answer: faq.answer, approved: !faq.approved } }), "Đã đổi trạng thái FAQ.")}>{faq.approved ? "Bỏ duyệt" : "Duyệt"}</button><button className="ml-4 text-red-700 underline" disabled={busy} onClick={() => { if (window.confirm("Xóa FAQ này?")) void action(() => browserApi.DELETE("/api/admin/chat/faqs/{faq_id}", { headers, params: { path: { faq_id: faq.id } } }), "Đã xóa FAQ."); }}>Xóa</button></article>)}
      </section>
      <section className="space-y-3 rounded-xl border border-line p-4"><h2 className="text-lg font-semibold">Yêu cầu nhân viên hỗ trợ</h2><p className="text-sm text-muted">Tiếp nhận sẽ tạm dừng AI trong hội thoại. Dùng kênh liên hệ của cửa hàng để hỗ trợ; đây chưa phải khung chat trực tiếp với nhân viên.</p>
        {support.length === 0 && <p>Chưa có yêu cầu trong trang này.</p>}
        {support.map((item) => <article key={item.id} className="space-y-2 border-t border-line pt-3"><p className="text-xs text-muted">Hội thoại {item.conversationId.slice(0, 12)}…</p><p className="whitespace-pre-wrap break-words">{item.message}</p><p>{item.state === "requested" ? "Mới yêu cầu" : item.state === "active" ? "Đang tiếp nhận" : "Đã xử lý"}</p>{item.state !== "resolved" && <div className="flex gap-4">{item.state === "requested" && <button disabled={busy} className="underline" onClick={() => void action(() => browserApi.PATCH("/api/admin/chat/support/{support_id}", { headers, params: { path: { support_id: item.id } }, body: { state: "active" } }), "Đã tiếp nhận, AI tạm dừng trong hội thoại.")}>Tiếp nhận</button>}<button disabled={busy} className="underline" onClick={() => void action(() => browserApi.PATCH("/api/admin/chat/support/{support_id}", { headers, params: { path: { support_id: item.id } }, body: { state: "resolved" } }), "Đã đánh dấu xử lý xong.")}>Đã xử lý</button></div>}</article>)}
        <div className="flex gap-4"><button disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 20))}>← Trước</button><button disabled={support.length < 20 || busy} onClick={() => setOffset(offset + 20)}>Sau →</button></div>
      </section>
    </>}
  </section>;
}
