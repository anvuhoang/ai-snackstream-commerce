import type { Metadata } from "next";
import { api } from "@/lib/api";
import type { Meta } from "@/lib/types";
import { fi } from "@/lib/format";
import { Chip } from "@/components/ui";
import { Page } from "@/components/Page";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = { title: "Định nghĩa chỉ số" };
const TARGET_KEY: Record<string, string> = { ctr_ad: "ctr_ad", roas: "roas", cac: "cac", cpc: "cpc" };

export default async function MetricsPage() {
  const meta = await api<Meta>("/api/meta");
  const target = (key: string) => {
    const t = meta.targets[TARGET_KEY[key]];
    if (!t) return "—";
    if (t.min != null && t.max != null) return `${t.min}–${t.max}${t.unit}`;
    return t.max != null ? `≤ ${fi(t.max)}${t.unit}` : "—";
  };
  return (
    <Page title="Định nghĩa chỉ số" lede="Công thức, mẫu số và phạm vi đo của từng chỉ số. Đây là bản để đối chiếu và chốt với nhóm (Việt) trước khi dùng số liệu thật." filters={false}>
      <Reveal as="section" className="card">
        <div className="card-h"><div><h2>Công thức</h2><p className="sub">Mẫu số bằng 0 hoặc thiếu dữ liệu thì hiển thị “Không tính được”, không hiển thị 0.</p></div></div>
        <div className="card-b flush tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Chỉ số</th><th>Quy tắc tính</th><th>Phạm vi</th><th>Cần</th><th>Mục tiêu (proposal)</th></tr></thead>
            <tbody>
              {meta.metricDefs.map((m) => (
                <tr key={m.key}><td><b>{m.label}</b></td><td><span className="formula">{m.formula}</span></td><td className="note">{m.scope}</td><td><code>{m.needs}</code></td><td>{target(m.key)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
      <div className="grid-2">
        <Reveal as="section" className="card">
          <div className="card-h"><div><h2>Quy tắc không cộng trùng</h2></div></div>
          <div className="card-b stack note" style={{ color: "var(--text-2)" }}>
            <div>• <b>Người xem:</b> lượt xem/hiển thị của các nền tảng không được cộng thành “số người duy nhất”. Mỗi nền tảng hiển thị riêng.</div>
            <div>• <b>Đơn hàng:</b> bảng đơn khóa theo mã đơn Shopee. Một đơn chỉ gắn với <b>một</b> nội dung. Tổng đơn lấy từ bảng đơn, không cộng từ nhiều báo cáo.</div>
            <div>• <b>Báo cáo tổng hợp</b> (không có mã đơn) chỉ hiện ở cấp nội dung, gắn nhãn “báo cáo”, <b>không</b> cộng vào tổng toàn hệ thống.</div>
            <div>• <b>Trạng thái đơn được tính:</b> {meta.counted.join(", ")}. Đơn hủy/hoàn trả bị loại.</div>
          </div>
        </Reveal>
        <Reveal as="section" className="card" index={1}>
          <div className="card-h"><div><h2>Các trạng thái thiếu dữ liệu</h2></div></div>
          <div className="card-b stack">
            <div className="row"><Chip status="not_collected" /><span className="note">Có thể lấy nhưng chưa nhập (ô trống trong file).</span></div>
            <div className="row"><Chip status="not_connected" /><span className="note">Nguồn chưa được kết nối (token <code>NC</code>).</span></div>
            <div className="row"><Chip status="not_provided" /><span className="note">Nguồn không cung cấp chỉ số này (token <code>NA</code>).</span></div>
            <div className="row"><Chip status="undetermined" /><span className="note">Không nối được chỉ số với đơn hàng (vd. đi qua website).</span></div>
            <div className="row"><b className="num">0</b><span className="note">Giá trị thật bằng 0, khác hẳn với các trạng thái trên.</span></div>
          </div>
        </Reveal>
      </div>
    </Page>
  );
}
