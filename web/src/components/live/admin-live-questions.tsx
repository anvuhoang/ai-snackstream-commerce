"use client";

import { useEffect, useRef, useState } from "react";
import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { components } from "@/lib/api/schema";
import { errorText } from "@/lib/errors";

type Snapshot = components["schemas"]["LiveCurrentOut"];

const STATUS_LABELS = {
  queued: "Chờ xử lý",
  processing: "Đang xử lý",
  ready: "Video đã sẵn sàng",
  answering: "Đang phát trả lời",
  answered: "Đã phát xong",
  failed: "Không tạo được câu trả lời",
  skipped: "Đã bỏ qua",
};

export function AdminLiveQuestions({ liveId }: { liveId: string }) {
  const { user, csrf } = useAdmin();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sending = useRef(false);

  useEffect(() => {
    const stream = new EventSource("/api/live/events");

    stream.addEventListener("state", (event) => {
      try {
        setSnapshot(JSON.parse(event.data) as Snapshot);
        setConnected(true);
      } catch {
        setConnected(false);
      }
    });

    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, []);

  const live = snapshot?.session;
  const sameSession = live?.liveId === liveId;
  const questions = sameSession ? (live.questions ?? []) : [];
  const queuedCount = questions.filter(
    (question) => question.status === "queued",
  ).length;

  const canSkip =
    connected &&
    sameSession &&
    live.status !== "ended" &&
    user.role === "admin";

  async function skipQuestion(questionId: string) {
    if (sending.current || !canSkip) return;

    sending.current = true;
    setBusyId(questionId);
    setError("");
    setNotice("");

    try {
      const { response, error: failure } = await browserApi.POST(
        "/api/admin/live/{live_id}/questions/{question_id}/skip",
        {
          params: {
            path: {
              live_id: liveId,
              question_id: questionId,
            },
          },
          headers: adminHeaders(csrf),
        },
      );

      if (!response.ok) {
        setError(errorText(failure));
        return;
      }

      setNotice("Đã bỏ qua câu hỏi. Danh sách sẽ tự cập nhật.");
    } catch {
      setError(
        "Chưa xác nhận được kết quả. Hãy kiểm tra trạng thái câu hỏi trước khi thử lại.",
      );
    } finally {
      sending.current = false;
      setBusyId(null);
    }
  }

  return (
    <section className="grid gap-4 rounded-card border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">Quản lý câu hỏi</h2>

      <p role="status" className="text-sm text-muted">
        {connected
          ? "Đã kết nối. Danh sách câu hỏi cập nhật tự động."
          : "Chưa kết nối danh sách câu hỏi. Đang thử kết nối…"}
      </p>

      {snapshot !== null && !sameSession && (
        <p className="text-sm text-muted">
          Phiên đã thay đổi. Hãy tải lại trang quản trị.
        </p>
      )}

      {sameSession && (
        <>
          <p className="text-sm text-muted">
            Đang chờ: {queuedCount}/3
          </p>

          {questions.length === 0 ? (
            <p className="text-sm text-muted">Chưa có câu hỏi.</p>
          ) : (
            <ul className="grid max-h-96 gap-3 overflow-y-auto">
              {questions.map((question) => (
                <li
                  key={question.questionId}
                  className="grid gap-2 rounded-xl border border-line p-3"
                >
                  <p className="whitespace-pre-wrap break-words">
                    {question.text}
                  </p>

                  <p className="text-sm text-muted">
                    SKU: {question.sku} · {STATUS_LABELS[question.status]}
                  </p>
                  {question.mediaSource === "prerecorded" && (
                    <p className="text-sm text-muted">
                      Video mô phỏng: dùng clip có sẵn để kiểm tra luồng phát, chưa tạo câu trả lời AI cho câu hỏi này.
                    </p>
                  )}
                  {["queued", "processing", "ready", "answering"].includes(question.status) &&
                    user.role === "admin" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      disabled={!canSkip || busyId !== null}
                      onClick={() => void skipQuestion(question.questionId)}
                    >
                      {busyId === question.questionId
                        ? "Đang bỏ qua…"
                        : "Bỏ qua"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
    </section>
  );
}