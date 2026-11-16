"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";
import { liveContentError } from "@/lib/live/content-errors";

type Segment = { name: string; sku: string; videoUrl: string; durationSeconds: string };
const emptySegment = (): Segment => ({ name: "", sku: "", videoUrl: "", durationSeconds: "" });

export function CreateLiveForm({ disabled }: { disabled: boolean }) {
  const { user, csrf } = useAdmin();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hostMode,setHostMode]=useState<"video"|"simli">("video");
  const [hostEnabled,setHostEnabled]=useState(false);
  const [videoSkus,setVideoSkus]=useState("");
  const [contentEnabled,setContentEnabled]=useState(false);
  const [generated,setGenerated]=useState(true);
  const [productSku,setProductSku]=useState("");
  const [productName,setProductName]=useState("");
  const [productFacts,setProductFacts]=useState("");
  const [audioSku,setAudioSku]=useState<string|null>(null);
  useEffect(()=>{void fetch("/api/admin/live/host-capabilities",{headers:adminHeaders(csrf)}).then(r=>r.ok?r.json():null).then(data=>{setHostEnabled(data?.enabled===true);setContentEnabled(data?.contentEnabled===true);setAudioSku(data?.audioSku??null);if(!data?.contentEnabled)setGenerated(false);}).catch(()=>{});},[csrf]);
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

    if (hostMode === "simli" && !generated && (!audioSku || scheduledSkus.length !== 1 || scheduledSkus[0].toUpperCase() !== audioSku)) {
      setError("SKU phiên phải khớp SKU audio đã cấu hình trên server.");
      return;
    }

    setBusy(true);
    try {
      const scriptPlaylist = (hostMode === "simli" ? [] : segments).map(item => ({
        name: item.name.trim(), sku: item.sku.trim(), videoUrl: item.videoUrl.trim(),
        durationSeconds: Number(item.durationSeconds),
      }));
      if (scriptPlaylist.some(item => !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0)) {
        setError("Thời lượng phải là số giây thực, hữu hạn và lớn hơn 0.");
        return;
      }
      const { response, error: failure } = await browserApi.POST("/api/admin/live", {
        body: { title, scheduledSkus, scriptPlaylist, ...(hostMode === "simli" ? {hostMode} : {}),
          ...(hostMode === "simli" && generated ? {products:[{sku:scheduledSkus[0],name:productName.trim(),facts:productFacts.trim()}]} : {}) },
        headers: adminHeaders(csrf),
      });

      if (!response.ok) {
        setError(generated && hostMode === "simli" ? liveContentError(failure) : errorText(failure));
        return;
      }

      form.reset();
      setVideoSkus("");
      setProductSku("");setProductName("");setProductFacts("");
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
        {hostEnabled && <label className="grid gap-2 text-sm font-medium">Người dẫn <select className="w-full rounded-lg border border-line bg-surface p-3" value={hostMode} onChange={event=>{setHostMode(event.target.value as "video"|"simli");if(contentEnabled)setGenerated(true);}}>
          <option value="video">Video / danh sách phát</option><option value="simli" disabled={!audioSku && !contentEnabled}>AI Host</option>
        </select></label>}
        {hostEnabled && !audioSku && !contentEnabled && <p role="status">Chưa cấu hình SKU cho lời dẫn. Chưa thể tạo phiên AI Host.</p>}
        {hostMode === "simli" && <label className="grid gap-2 text-sm font-medium">Lời dẫn<select className="w-full rounded-lg border border-line bg-surface p-3" value={generated?"generated":"configured"} onChange={event=>{setGenerated(event.target.value==="generated");}}>
          <option value="configured" disabled={!audioSku}>Audio có sẵn</option><option value="generated" disabled={!contentEnabled}>Nhập kịch bản và tạo audio</option>
        </select></label>}
        {hostMode === "simli" && !generated && <p>Lời dẫn có sẵn cho SKU <strong>{audioSku}</strong>. Tối đa 90 giây và 2 người xem; chỉ bắt đầu khi bạn bấm Bắt đầu live.</p>}
        <Field label="Tiêu đề phiên">
          <Input name="title" required maxLength={160} placeholder="Nhập tiêu đề phiên live" />
        </Field>
        <Field label="Mã sản phẩm (SKU), cách nhau bằng dấu phẩy">
          <Input name="skus" required maxLength={250} readOnly={hostMode === "simli" && !generated}
            value={hostMode === "simli" ? generated ? productSku : audioSku ?? "" : videoSkus}
            onChange={event=>hostMode === "simli" && generated ? setProductSku(event.target.value) : setVideoSkus(event.target.value)} />
        </Field>
        {hostMode === "simli" && generated && <>
          <Field label="Tên sản phẩm"><Input name="productName" value={productName} onChange={event=>setProductName(event.target.value)} required maxLength={160}/></Field>
          <Field label="Thông tin sản phẩm đã xác minh (mỗi ý một dòng)">
            <textarea name="productFacts" value={productFacts} onChange={event=>setProductFacts(event.target.value)} required maxLength={6000} rows={5}
              className="w-full rounded-xl border border-line bg-surface p-3" />
          </Field>
          <p className="text-sm text-muted">Thông tin này được dùng để trả lời câu hỏi về sản phẩm. Sau khi tạo phiên, nhập lời dẫn và tạo giọng đọc.</p>
        </>}
        {hostMode === "video" && <p className="text-sm text-muted">
          Danh sách phát một lượt, sau đó trả lời hết câu hỏi đã nhận. Để trống để phát lặp video có sẵn.
          Nhập thời lượng đã đo từ file video.
        </p>}
        {hostMode === "video" && segments.map((segment, index) => (
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
            <Field label="URL video (HTTP/HTTPS, không chứa thông tin đăng nhập)">
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
        {hostMode === "video" && <Button type="button" variant="outline" className="w-fit" disabled={segments.length >= 30}
          onClick={() => setSegments(items => [...items, emptySegment()])}>Thêm đoạn video (tối đa 30)</Button>}
        <Button type="submit" className="w-fit">
          {busy ? "Đang tạo…" : "Tạo phiên"}
        </Button>
      </fieldset>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
    </form>
  );
}
