import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatPercent, orDash, RATIO_NOTE, type AiOut, type ChannelRow, type ChannelsOut, type ShopeeOut } from "@/lib/analytics";
import { formatVnd } from "@/lib/format";

const th = "px-4 py-3 text-right font-medium";
const NOT_REPORTED = "Kênh chưa báo số này (không phải bằng 0)";

function Cell({ value }: { value: string }) {
  return value === "—" ? (
    <span title={NOT_REPORTED} className="text-muted">
      —
    </span>
  ) : (
    <>{value}</>
  );
}

function Ratio({ value, note }: { value: number | null; note: keyof typeof RATIO_NOTE }) {
  return value === null ? <span className="text-xs text-muted">{RATIO_NOTE[note]}</span> : <>{formatPercent(value)}</>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-8 text-center text-sm text-muted">{children}</p>;
}

/** What TikTok, Facebook and the others report. These are the channels' own claims: they are shown next to the web's numbers and never added to them. */
export function ChannelsView({ data }: { data: ChannelsOut }) {
  return (
    <section className="overflow-x-auto rounded-[20px] border border-line bg-surface" aria-label="Kênh ngoài">
      <h2 className="border-b border-line px-5 py-3 text-sm font-extrabold">Số liệu do các kênh báo cáo</h2>
      {data.rows.length === 0 ? (
        <Empty>
          Chưa có số liệu kênh ngoài trong khoảng này. Nhập từ file CSV hoặc nhập tay ở tab{" "}
          <Link href="/admin/analytics?tab=data" className="border-b border-current font-medium text-ink">
            Dữ liệu
          </Link>
          .
        </Empty>
      ) : (
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-line text-[10px] uppercase tracking-[0.04em] text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Kênh</th>
              <th className={th}>Lượt xem</th>
              <th className={th}>Hiển thị</th>
              <th className={th}>Click</th>
              <th className={th}>CTR</th>
              <th className={th}>Đơn (kênh báo)</th>
              <th className={th}>Doanh thu (kênh báo)</th>
              <th className={th}>Chi phí</th>
              <th className={th}>Chi phí / đơn</th>
              <th className="px-5 py-3 text-right font-medium">Số ngày</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.channel} className="border-b border-hair last:border-0">
                <td className="px-5 py-3 font-semibold">{r.channel}</td>
                <td className="px-4 py-3 text-right tabular-nums"><Cell value={orDash(r.views)} /></td>
                <td className="px-4 py-3 text-right tabular-nums"><Cell value={orDash(r.impressions)} /></td>
                <td className="px-4 py-3 text-right tabular-nums"><Cell value={orDash(r.clicks)} /></td>
                <td className="px-4 py-3 text-right tabular-nums"><Ratio value={r.ctr} note={r.ctrNote} /></td>
                <td className="px-4 py-3 text-right tabular-nums"><Cell value={orDash(r.orders)} /></td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums"><Cell value={orDash(r.revenueVnd, formatVnd)} /></td>
                <td className="px-4 py-3 text-right tabular-nums"><Cell value={orDash(r.costVnd, formatVnd)} /></td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.costPerOrderVnd === null ? <span className="text-xs text-muted">{RATIO_NOTE[r.costPerOrderNote]}</span> : formatVnd(r.costPerOrderVnd)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{r.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="grid gap-1.5 border-t border-hair px-5 py-4 text-xs leading-relaxed text-muted">
        <li>
          “—” nghĩa là kênh <b className="font-medium text-ink">chưa báo</b> số đó, không phải bằng 0.
        </li>
        <li>CTR và chi phí / đơn chỉ tính trên những ngày kênh báo đủ cả hai số. Mẫu số bằng 0 hoặc thiếu thì ghi “không tính được”.</li>
        <li>Đơn và doanh thu ở đây là số do kênh tự báo, không cộng vào đơn của web. Với chi phí chỉ tính được “chi phí / đơn”, chưa tính được chi phí mua khách mới (CAC) vì chưa nhận diện được khách mới.</li>
      </ul>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid content-between gap-3 bg-surface p-5">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      <div>
        <b className="block text-[30px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{value}</b>
        {note && <span className="mt-1.5 block text-xs text-muted">{note}</span>}
      </div>
    </div>
  );
}

function ReportedTiles({ row }: { row: ChannelRow }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Đơn Shopee báo" value={orDash(row.orders)} />
      <Tile label="Doanh thu Shopee báo" value={orDash(row.revenueVnd, formatVnd)} />
      <Tile label="Lượt xem" value={orDash(row.views)} />
      <Tile label="Click" value={orDash(row.clicks)} />
    </div>
  );
}

/** Two sources about Shopee, kept side by side and never added together. */
export function ShopeeView({ data }: { data: ShopeeOut }) {
  return (
    <div className="grid gap-6">
      <section className="grid gap-3 rounded-[20px] border border-line bg-surface p-5" aria-label="Từ web sang Shopee">
        <h2 className="text-sm font-extrabold">Từ web sang Shopee</h2>
        <p className="text-4xl font-extrabold tabular-nums tracking-[-0.03em]">{data.webClicks.toLocaleString("vi-VN")}</p>
        <p className="text-sm text-muted">Số lần khách bấm “Mua trên Shopee” trên web. Đây là lượt chuyển khách đi, không phải đơn của web và không phải đơn bán được trên Shopee.</p>
      </section>

      <section className="grid gap-3" aria-label="Shopee báo cáo">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-extrabold">Shopee báo cáo (nhập từ file)</h2>
          {!data.reported && <Badge tone="warn">Chưa nhập</Badge>}
        </div>
        {data.reported ? (
          <ReportedTiles row={data.reported} />
        ) : (
          <p className="rounded-[20px] border-2 border-dashed border-line p-10 text-center text-sm text-muted">
            Chưa có số liệu Shopee trong khoảng này. Nhập file báo cáo của Shopee (kênh <b className="font-medium text-ink">shopee</b>) ở tab{" "}
            <Link href="/admin/analytics?tab=data" className="border-b border-current font-medium text-ink">
              Dữ liệu
            </Link>
            .
          </p>
        )}
      </section>
      <p className="text-xs leading-relaxed text-muted">
        Hai nguồn này không được cộng lại và không được so là “tỷ lệ chuyển đổi”: lượt bấm đếm trên web, còn đơn do Shopee tự báo, và một đơn có thể đến từ lần bấm ở ngày khác.
      </p>
    </div>
  );
}

/** What the chatbot and the live host brought in. They start sending events in later phases; until then nothing is claimed. */
export function AiView({ data }: { data: AiOut }) {
  const v = (n: number) => (data.collected ? n.toLocaleString("vi-VN") : "—");
  return (
    <div className="grid gap-6">
      {!data.collected && (
        <p className="rounded-[20px] border-2 border-dashed border-line p-6 text-sm leading-relaxed text-muted" role="status">
          <b className="font-semibold text-ink">Chatbot và live chưa gửi dữ liệu nào.</b> Dấu “—” nghĩa là chưa thu thập, không phải chưa có ai hỏi. Các số sẽ hiện khi chatbot (giai đoạn 5) và live (giai đoạn 6) bắt đầu ghi sự kiện.
        </p>
      )}
      <div className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Câu hỏi cho chatbot" value={v(data.chatQuestions)} />
        <Tile label="Phiên có hỏi chatbot" value={v(data.chatSessions)} note="Đếm theo phiên truy cập" />
        <Tile label="Lượt vào xem live" value={v(data.liveJoins)} />
        <Tile label="Bấm sản phẩm trong live" value={v(data.liveProductClicks)} />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        So sánh với nội dung người làm (video, bài đăng) cần có thêm nhật ký chatbot và live (loại nội dung, có tự giải quyết hay không) từ hai giai đoạn đó. Khi có, tab này sẽ bổ sung phần so sánh.
      </p>
    </div>
  );
}
