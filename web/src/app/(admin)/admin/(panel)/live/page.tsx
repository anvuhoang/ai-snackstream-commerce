import { LiveControls } from "@/components/live/live-controls";
import { CreateLiveForm } from "@/components/live/create-live-form";
import { serverApi } from "@/lib/api/server";

const STATUS_LABELS = {
  not_started: "Chưa bắt đầu",
  playing: "Đang hoạt động",
  paused: "Tạm dừng",
  ended: "Đã kết thúc",
};

async function readCurrentLive() {
  try {
    const api = await serverApi();
    const { data } = await api.GET("/api/live/current");
    return data ?? null;
  } catch {
    return null;
  }
}

export default async function AdminLivePage() {
  const current = await readCurrentLive();
  const live = current?.session;
  const status = live?.status;

  return (
    <div className="grid max-w-3xl gap-5">
      <header>
        <h1 className="text-2xl font-extrabold">Quản lý AI Live</h1>
        <p className="mt-2 text-sm text-muted">
          Nhấn F5 để cập nhật thông tin phiên hiện tại.
        </p>
      </header>

      {current !== null && (
        <CreateLiveForm disabled={Boolean(live && live.status !== "ended")} />
      )}

      {current === null ? (
        <p role="alert" className="text-danger">
          Không đọc được thông tin phiên. Kiểm tra backend đang chạy rồi tải lại trang.
        </p>
      ) : live ? (
        <section className="rounded-card border border-line bg-surface p-5">
          {live.isDemo && (
            <p className="mb-4 text-sm text-muted">Dữ liệu thử nghiệm</p>
          )}

          <dl className="grid gap-4">
            <div>
              <dt className="text-sm text-muted">Tiêu đề</dt>
              <dd className="font-semibold">{live.title}</dd>
            </div>

            <div>
              <dt className="text-sm text-muted">Mã phiên</dt>
              <dd className="break-all font-mono text-sm">{live.liveId}</dd>
            </div>

            <div>
              <dt className="text-sm text-muted">Trạng thái</dt>
              <dd className="font-semibold">
                {status ? STATUS_LABELS[status] : "Chưa xác định"}
              </dd>
            </div>
          </dl>
          <LiveControls key={live.liveId} live={live} />
        </section>
      ) : (
        <p className="text-muted">Chưa có phiên live hiện tại.</p>
      )}
    </div>
  );
}