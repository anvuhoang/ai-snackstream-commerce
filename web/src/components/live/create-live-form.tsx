"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";

type Segment = { name: string; sku: string; videoUrl: string; durationSeconds: string };
const emptySegment = (): Segment => ({ name: "", sku: "", videoUrl: "", durationSeconds: "" });

export function CreateLiveForm({ disabled }: { disabled: boolean }) {
  const { user, csrf } = useAdmin();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);

  function updateSegment(index: number, field: keyof Segment, value: string) {
    setSegments(items => items.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function moveSegment(index: number, direction: number) {
    setSegments(items => {
      const next = [...items];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled || user.role !== "admin") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const scheduledSkus = String(data.get("skus") ?? "")
  .split(",").map((sku) => sku.trim()).filter(Boolean);
    setError("");
    setNotice("");

    if (!title) {
      setError("Bạn cần nhập tiêu đề phiên.");
      return;
    }

    if (scheduledSkus.length < 1 || scheduledSkus.length > 6
      || !scheduledSkus.every((sku) => /^[A-Za-z0-9][A-Za-z0-9_-]{1,38}$/.test(sku))
      || new Set(scheduledSkus.map((sku) => sku.toUpperCase())).size !== scheduledSkus.length) {
      setError("Nhập 1–6 SKU không trùng nhau, chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới.");
      return;
    }

    setBusy(true);
    try {
      const scriptPlaylist = segments.map(item => ({
        name: item.name.trim(), sku: item.sku.trim(), videoUrl: item.videoUrl.trim(),
        durationSeconds: Number(item.durationSeconds),
      }));
      if (scriptPlaylist.some(item => !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0)) {
        setError("Thời lượng phải là số giây thực, hữu hạn và lớn hơn 0.");
        return;
      }
      const { response, error: failure } = await browserApi.POST("/api/admin/live", {
        body: { title, scheduledSkus, scriptPlaylist },
        headers: adminHeaders(csrf),
      });

      if (!response.ok) {
        setError(errorText(failure));
        return;
      }

      form.reset();
      setSegments([]);
      setNotice("Đã tạo phiên mới. Thông tin phiên được cập nhật bên dưới.");
      router.refresh();
    } catch {
      setError("Chưa xác nhận được kết quả. Hãy tải lại trang để kiểm tra phiên.");
    } finally {
      setBusy(false);
    }
  }

  if (user.role !== "admin") {
    return <p className="text-sm text-muted">Tài khoản này chỉ xem thông tin phiên.</p>;
  }

  return (
    <form onSubmit={createSession} className="grid gap-4 rounded-card border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">Tạo phiên live</h2>

      {disabled && (
        <p className="text-sm text-muted">
          Phiên hiện tại chưa kết thúc. Hãy kết thúc phiên đó trước khi tạo phiên mới.
        </p>
      )}

      <fieldset disabled={busy || disabled} className="grid gap-4">
        <Field label="Tiêu đề phiên">
          <Input name="title" required maxLength={160} placeholder="Nhập tiêu đề phiên live" />
        </Field>
        <Field label="SKU trong phiên, cách nhau bằng dấu phẩy">
          <Input name="skus" required maxLength={250} defaultValue="BT-XIKE-01, KG-LC-250" />
        </Field>
        <p className="text-sm text-muted">
          Video và nội dung dùng để thử nghiệm. Danh sách phát một lượt, sau đó xử lý hết câu hỏi đã nhận.
          Để trống để dùng demo lặp cũ. Nhập thời lượng đã đo từ đúng file video; hệ thống không tự đo URL.
        </p>
        {segments.map((segment, index) => (
          <fieldset key={index} className="grid gap-3 rounded-lg border border-line p-3">
            <legend>Đoạn {index + 1}</legend>
            <Field label="Tên đoạn">
              <Input required maxLength={160} value={segment.name}
                onChange={event => updateSegment(index, "name", event.target.value)} />
            </Field>
            <Field label="SKU thuộc phiên">
              <Input required maxLength={39} value={segment.sku}
                onChange={event => updateSegment(index, "sku", event.target.value)} />
            </Field>
            <Field label="URL video HTTP/HTTPS, không chứa credentials">
              <Input required type="url" value={segment.videoUrl}
                onChange={event => updateSegment(index, "videoUrl", event.target.value)} />
            </Field>
            <Field label="Thời lượng thực (giây, tối đa 3600)">
              <Input required type="number" min="0.000001" max="3600" step="any" value={segment.durationSeconds}
                onChange={event => updateSegment(index, "durationSeconds", event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={index === 0}
                onClick={() => moveSegment(index, -1)}>Lên</Button>
              <Button type="button" variant="outline" disabled={index === segments.length - 1}
                onClick={() => moveSegment(index, 1)}>Xuống</Button>
              <Button type="button" variant="outline"
                onClick={() => setSegments(items => items.filter((_, i) => i !== index))}>Xóa đoạn</Button>
            </div>
          </fieldset>
        ))}
        <Button type="button" variant="outline" className="w-fit" disabled={segments.length >= 30}
          onClick={() => setSegments(items => [...items, emptySegment()])}>Thêm đoạn video (tối đa 30)</Button>
        <Button type="submit" className="w-fit">
          {busy ? "Đang tạo…" : "Tạo phiên"}
        </Button>
      </fieldset>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
    </form>
  );
}
