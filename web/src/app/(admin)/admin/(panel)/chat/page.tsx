"use client";

import Link from "next/link";
import { RefreshCw, ArrowUpRight, MessageSquare, Check, X, RotateCcw, Clock3, MousePointer2 } from "lucide-react";
import styles from "@/components/admin/admin.module.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdmin } from "@/components/admin/admin-shell";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { components } from "@/lib/api/schema";

type Entry = components["schemas"]["LogEntry"];

export default function ChatAdmin() {
  const { csrf } = useAdmin();
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const requestVersion = useRef(0);
  const invalidate = useCallback(() => { requestVersion.current++; }, []);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setError("");
    try {
      const { data } = await browserApi.GET("/api/admin/chat/logs", { params: { query: { offset, limit: 20, needs_review: filter } } });
      if (version !== requestVersion.current) return;
      if (!data) throw new Error("Không tải được log. Kiểm tra phiên đăng nhập rồi thử lại.");
      setItems(data.items); setTotal(data.total);
    } catch (e) { if (version === requestVersion.current) setError(e instanceof Error ? e.message : "Mất kết nối."); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [offset, filter]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => { clearTimeout(timer); invalidate(); };
  }, [load, invalidate]);
  async function review(id: string, correct: boolean | null) {
    setSaving(true); setError("");
    try {
      const { data } = await browserApi.PATCH("/api/admin/chat/logs/{question_id}", {
        params: { path: { question_id: id } }, headers: adminHeaders(csrf), body: { reviewedCorrect: correct },
      });
      if (!data) throw new Error("Không lưu được đánh giá. Tải lại trang rồi thử lại.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Mất kết nối."); }
    finally { setSaving(false); }
  }
  return <section className={styles.page}>
    <div className={styles.pageHeading}><div><span className={styles.eyebrow}>CONVERSATIONS</span><h1>Hội thoại & đánh giá<span className={styles.count}>{total}</span></h1><p>Lắng nghe khách hàng. Chăm chút chất lượng từng phản hồi.</p></div><Link className={styles.secondary} href="/admin/chat/manage">Quản lý trợ lý <ArrowUpRight size={15} /></Link></div>
    <div className={styles.toolbar}><div className={styles.tabs}><button className={!filter ? styles.selected : ""} onClick={() => { setFilter(false); setOffset(0); }}>Tất cả hội thoại</button><button className={filter ? styles.selected : ""} onClick={() => { setFilter(true); setOffset(0); }}>Chưa đánh giá</button></div><button className={styles.secondary} onClick={() => void load()} disabled={loading}><RefreshCw size={14} />{loading ? "Đang tải…" : "Làm mới"}</button></div>
    <p className={styles.hint}>“Đã trả lời” ghi nhận AI có phản hồi. Độ đúng được người quản trị đánh giá riêng.</p>
    {error && <p role="alert" className={styles.alert}>{error}</p>}
    {loading ? <div className={styles.empty}><RefreshCw size={24} /><h2>Đang tải hội thoại…</h2></div> : items.length === 0 ? <div className={styles.empty}><MessageSquare size={30} /><h2>Chưa có hội thoại ở đây</h2><p>Các câu hỏi mới từ web chat sẽ xuất hiện trong danh sách này.</p><Link href="/" className={styles.secondary}>Mở web chat <ArrowUpRight size={14} /></Link></div> : <div className={styles.logList}>{items.map((item) => <article key={item.questionId} className={styles.logCard}>
      <header className={styles.logHeader}><span className={styles.sessionIcon}><MessageSquare size={16} /></span><div><strong>Hội thoại #{item.conversationId.slice(0, 8)}</strong><small>{new Date(item.receivedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</small></div><span className={item.outcome === "answered" ? styles.successBadge : item.outcome === "error" ? styles.dangerBadge : styles.badge}>{item.outcome === "answered" ? "Đã trả lời" : item.outcome === "error" ? "Có lỗi" : "Đang xử lý"}</span></header>
      <div className={styles.exchange}><div><span className={styles.speaker}>KHÁCH HÀNG</span><p className={styles.question}>{item.question}</p></div><div className={styles.answer}><span className={styles.speaker}>SNACKSTREAM AI</span><p>{item.answer ?? "Chưa có câu trả lời."}</p>{item.errorCode && <code>{item.errorCode}</code>}</div></div>
      <div className={styles.logMeta}><span><Clock3 size={13} />{item.durationMs === null ? "Chưa hoàn thành" : `${(item.durationMs / 1000).toFixed(1)} giây`}</span>{item.sku && <span>SKU · {item.sku}</span>}<span><MousePointer2 size={13} />{item.cardClicked ? "Đã bấm thẻ" : "Chưa bấm thẻ"}</span><details><summary>Mã câu hỏi</summary><code>{item.questionId}</code></details></div>
      <footer className={styles.review}><span className={item.reviewedCorrect === null ? styles.reviewLabel : item.reviewedCorrect ? styles.correctLabel : styles.incorrectLabel}>{item.reviewedCorrect === null ? "Chưa đánh giá" : item.reviewedCorrect ? "Đã đánh giá: Đúng" : "Đã đánh giá: Cần xử lý"}</span><div><button className={item.reviewedCorrect === true ? styles.positiveSelected : styles.reviewButton} disabled={saving || loading} onClick={() => void review(item.questionId, true)}><Check size={14} />Đúng</button><button className={item.reviewedCorrect === false ? styles.negativeSelected : styles.reviewButton} disabled={saving || loading} onClick={() => void review(item.questionId, false)}><X size={14} />Cần xử lý</button>{item.reviewedCorrect !== null && <button title="Bỏ đánh giá" aria-label="Bỏ đánh giá" className={styles.reviewButton} disabled={saving || loading} onClick={() => void review(item.questionId, null)}><RotateCcw size={14} /></button>}</div></footer>
    </article>)}</div>}
    <div className={styles.pagination}><span>{total === 0 ? "Chưa có dữ liệu" : `Hiển thị ${offset + 1}–${Math.min(offset + 20, total)} / ${total} câu hỏi`}</span><div><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>← Trước</button><span>{Math.floor(offset / 20) + 1}</span><button disabled={loading || offset + 20 >= total} onClick={() => setOffset(offset + 20)}>Sau →</button></div></div>
  </section>;
}
