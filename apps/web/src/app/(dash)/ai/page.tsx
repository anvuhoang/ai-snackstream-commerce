import type { Metadata } from "next";
import { api, filterQuery, type SP } from "@/lib/api";
import type { AiData } from "@/lib/types";
import { fi, fp, fv } from "@/lib/format";
import { targetState, TARGETS } from "@/lib/labels";
import { A, AiBadge, Chip, ContentCell, Empty, Notice, R, Sec } from "@/components/ui";
import { Page } from "@/components/Page";
import { Kpi, Kpis, KV } from "@/components/Kpi";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = { title: "Hiệu quả AI" };

export default async function AiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const d = await api<AiData>("/api/ai", sp);
  const qs = filterQuery(sp);
  const c = d.chat;
  const one = (v: number | null) => ({ value: v, status: "not_collected", note: "", basis: "", nKnown: v == null ? 0 : 1, nTotal: 1 });
  return (
    <Page title="Hiệu quả AI & mức độ tự động hóa" lede="Đặt hiệu quả bán hàng, chất lượng trả lời, chi phí và mức cần người hỗ trợ lên cùng một nơi. Lượt xem hoặc đơn hàng cao chưa đủ để kết luận AI thay thế được người.">
      <Notice kind="info"><b>Cách đọc:</b> “tự xử lý thành công” = câu hỏi được trả lời mà không chuyển người. Độ chính xác chỉ tính trên các câu đã được kiểm tra thủ công (hiển thị cỡ mẫu). So sánh AI / người chỉ có ý nghĩa khi mỗi nhóm có đủ nội dung (≥ 5).</Notice>

      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>So sánh AI · Người · Kết hợp</h2><p className="sub">Video và phiên live trên Shopee. Cùng một bộ chỉ số cho cả ba nhóm.</p></div></div>
        <div className="card-b flush tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Nhóm</th><th className="n">Số nội dung</th><th className="n">Lượt xem</th><th className="n">Click / xem</th><th className="n">Đơn</th><th className="n">Đơn / 1.000 xem</th><th className="n">Chi phí</th><th className="n">Chi phí / đơn</th><th className="n">Phút sản xuất TB</th><th>Độ tin cậy</th></tr></thead>
            <tbody>
              {d.compare.map((g) => (
                <tr key={g.group}>
                  <td><AiBadge g={g.group} /></td><td className="n">{g.n}</td>
                  {g.summary ? (
                    <>
                      <td className="n"><A a={g.summary.views} /></td><td className="n"><R r={g.summary.clickPerView} /></td><td className="n"><A a={g.summary.orders} /></td>
                      <td className="n"><b><R r={g.summary.ordersPer1000} kind="dec" /></b></td><td className="n"><A a={g.summary.cost} kind="vnd" /></td>
                      <td className="n"><R r={g.summary.costPerOrder} kind="vnd" digits={0} /></td>
                      <td className="n">{g.avgMinutes != null ? fi(g.avgMinutes) : <Chip status="not_collected" />}</td>
                      <td>{g.enough ? <span className="badge ok">Đủ mẫu</span> : <span className="badge warn" title="Dưới 5 nội dung — chưa đủ để kết luận">Mẫu nhỏ</span>}</td>
                    </>
                  ) : <td colSpan={8} className="muted">Chưa có nội dung thuộc nhóm này (cần dữ liệu đối chứng)</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Sec>Chatbot (module của Phong · nhận log qua file mẫu chat_logs)</Sec>
      <Kpis>
        <Kpi index={0} label="Số câu hỏi" color="--s7" sub={`${fi(c.sessions)} phiên chat`}><KV a={one(c.n)} /></Kpi>
        <Kpi index={1} label="Tự xử lý thành công" color="--s3" sub="Không chuyển người ÷ tổng câu hỏi" help="Tiêu chí: câu hỏi được trả lời mà không cần chuyển người vận hành."><KV r={c.resolved} kind="pct" /></Kpi>
        <Kpi index={2} label="Chuyển người vận hành" color="--s4" sub="Chuyển người ÷ tổng câu hỏi"><KV r={c.handoff} kind="pct" /></Kpi>
        <Kpi index={3} label="Độ chính xác" color="--s3" sub={`Kiểm tra mẫu: ${fi(c.reviewed)} câu`} help="Trả lời đúng ÷ số câu đã được kiểm tra thủ công."><KV r={c.accuracy} kind="pct" /></Kpi>
        <Kpi index={4} label="Thời gian phản hồi TB" color="--s1" sub={c.p95Latency != null ? `P95: ${fi(c.p95Latency)} ms` : undefined} help="Từ lúc nhận câu hỏi đến lúc có câu trả lời, theo log chatbot."
          tgt={targetState("e2e", c.avgLatency)} tgtText="Mục tiêu < 3.500 ms">
          {c.avgLatency != null ? <>{fi(c.avgLatency)} ms</> : <Chip status="not_collected" />}
        </Kpi>
        <Kpi index={5} label="Bấm mua sau khi hỏi" color="--s2" sub="Phiên hỏi có click sang Shopee"><KV r={c.buy} kind="pct" /></Kpi>
        <Kpi index={6} label="Chi phí / câu hỏi" sub={c.cost != null ? `Tổng ${fv(c.cost)}` : undefined} help="Chi phí gọi mô hình AI theo log chatbot.">
          {c.costPerQuestion != null ? fv(c.costPerQuestion) : <Chip status="not_collected" />}
        </Kpi>
      </Kpis>
      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Chatbot theo loại ý định (intent)</h2><p className="sub">Danh mục intent theo proposal. INTENT_OTHER chỉ trả lời trong chat, không đọc bằng giọng nói, không ghim sản phẩm.</p></div></div>
        <div className="card-b flush tbl-wrap">
          {c.byIntent.length === 0 ? <Empty title="Chưa có hội thoại" text="Chờ Phong bàn giao log chatbot (file mẫu “chat_logs” ở mục Quản lý dữ liệu), hoặc nạp dữ liệu demo để xem giao diện." /> : (
            <table className="tbl">
              <thead><tr><th>Intent</th><th className="n">Số câu</th><th className="n">Chuyển người</th><th className="n">Độ chính xác (mẫu kiểm)</th><th className="n">Bấm mua</th></tr></thead>
              <tbody>
                {c.byIntent.map((x) => (
                  <tr key={x.intent}><td><b>{x.label}</b><div className="note"><code>{x.intent}</code></div></td><td className="n">{fi(x.n)}</td>
                    <td className="n"><R r={x.handoffRate} /></td><td className="n"><R r={x.accuracy} /> <span className="note">({x.reviewed})</span></td><td className="n">{fi(x.buy)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>

      <Sec>AI Livestream</Sec>
      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Từng phiên live</h2><p className="sub">Log từ Nguyên (phiên, câu hỏi, độ trễ, can thiệp, chi phí) ghép với kết quả bán hàng của cùng phiên. Mục tiêu độ trễ: dispatch &lt; 1.500 ms, end-to-end &lt; 3.500 ms.</p></div></div>
        <div className="card-b flush tbl-wrap">
          {d.lives.length === 0 ? <Empty title="Chưa có phiên live" text="Nhập danh mục (loại “live”) rồi nhập log phiên ở mục Quản lý dữ liệu." /> : (
            <table className="tbl">
              <thead><tr><th>Phiên</th><th>Nhóm</th><th className="n">Thời lượng</th><th className="n">Câu hỏi nhận / đã trả lời</th><th className="n">Tỷ lệ trả lời</th><th className="n">Độ chính xác</th><th className="n">Độ trễ dispatch</th><th className="n">Độ trễ end-to-end</th><th className="n">Can thiệp</th><th className="n">Gián đoạn</th><th className="n">Chi phí phiên</th><th className="n">Lượt xem</th><th className="n">Đơn</th><th className="n">Đơn / 1.000 xem</th></tr></thead>
              <tbody>
                {d.lives.map(({ row: r, session: s, answerRate, ordersPer1000 }) => (
                  <tr key={r.code}>
                    <td><ContentCell r={r} qs={qs} /></td><td><AiBadge g={r.aiGroup} /></td>
                    {s ? (
                      <>
                        <td className="n">{fi(s.durationMin)}′</td><td className="n">{fi(s.questionsReceived)} / {fi(s.questionsAnswered)}</td><td className="n"><R r={answerRate} /></td>
                        <td className="n">{s.accuracyPct != null ? fp(s.accuracyPct, 1) : <Chip status="not_collected" />}</td>
                        <td className="n">{s.avgDispatchMs != null ? <span className={`badge ${s.avgDispatchMs <= (TARGETS.dispatch.max ?? 0) ? "ok" : "bad"}`}>{fi(s.avgDispatchMs)} ms</span> : <Chip status="not_provided" />}</td>
                        <td className="n">{s.avgE2eMs != null ? <span className={`badge ${s.avgE2eMs <= (TARGETS.e2e.max ?? 0) ? "ok" : "bad"}`}>{fi(s.avgE2eMs)} ms</span> : <Chip status="not_provided" />}</td>
                        <td className="n">{s.interventions != null ? fi(s.interventions) : <Chip status="not_provided" />}</td>
                        <td className="n">{s.interruptions != null ? fi(s.interruptions) : <Chip status="not_provided" />}</td>
                        <td className="n">{s.costVnd != null ? fv(s.costVnd) : <Chip status="not_collected" />}</td>
                      </>
                    ) : <td colSpan={9}><Chip status="not_collected" label="Chưa có log phiên" /></td>}
                    <td className="n"><A a={r.views} /></td><td className="n"><b><A a={r.orders} /></b></td><td className="n"><R r={ordersPer1000} kind="dec" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>

      <Sec>Video AI</Sec>
      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Sản xuất &amp; hiệu quả theo video / kịch bản</h2><p className="sub">Thời gian và chi phí sản xuất đặt cạnh kết quả, để biết video rẻ có thật sự bán được không.</p></div></div>
        <div className="card-b flush tbl-wrap">
          {d.videos.length === 0 ? <Empty title="Chưa có video Shopee" text="Nhập danh mục và log sản xuất (mã video, phiên bản kịch bản, chi phí)." /> : (
            <table className="tbl">
              <thead><tr><th>Video</th><th>Nhóm</th><th>Kịch bản</th><th className="n">Phút sản xuất</th><th className="n">Chi phí SX</th><th className="n">Lượt xem</th><th className="n">Click / xem</th><th className="n">Đơn</th><th className="n">Đơn / 1.000 xem</th><th className="n">Chi phí SX / đơn</th></tr></thead>
              <tbody>
                {d.videos.map((x) => (
                  <tr key={x.row.code}><td><ContentCell r={x.row} qs={qs} /></td><td><AiBadge g={x.row.aiGroup} /></td><td className="note">{x.scriptVersion || "—"}</td>
                    <td className="n">{x.minutes != null ? fi(x.minutes) : <Chip status="not_collected" />}</td>
                    <td className="n">{x.productionCost != null ? fv(x.productionCost) : <Chip status="not_collected" />}</td>
                    <td className="n"><A a={x.row.views} /></td><td className="n"><R r={x.row.ratios.clickPerView} /></td><td className="n"><A a={x.row.orders} /></td><td className="n"><R r={x.row.ratios.ordersPer1000} kind="dec" /></td>
                    <td className="n">{x.productionCost != null && x.row.orders.value ? fv(x.productionCost / x.row.orders.value) : <span className="na" data-s="undetermined" title="Thiếu chi phí sản xuất hoặc chưa có đơn">Không tính được</span>}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>
    </Page>
  );
}
