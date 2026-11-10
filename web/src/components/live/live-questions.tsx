"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { browserApi } from "@/lib/api/browser";
import type { components } from "@/lib/api/schema";
import { errorText } from "@/lib/errors";
import type { LivePlaybackLog } from "@/lib/live/playback-log";

type Live = components["schemas"]["LiveSessionOut"];
type QuestionIn = components["schemas"]["LiveQuestionIn"];

type Props = {
  live: Live;
  connected: boolean;
  onLog: LivePlaybackLog["record"];
};

const STATUS_LABELS = {
  queued: "Chờ xử lý",
  processing: "Đang xử lý",
  ready: "Video đã sẵn sàng",
  answering: "Đang phát trả lời",
  answered: "Đã phát xong",
  failed: "Không tạo được câu trả lời",
  skipped: "Đã bỏ qua",
};

export function LiveQuestions({ live, connected, onLog }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const viewerId = useRef<string | null>(null);
  const pending = useRef<QuestionIn | null>(null);
  const sending = useRef(false);

  const accepting = live.status === "playing" || live.status === "paused";
  const questions = live.questions ?? [];

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !connected || !accepting) return;

    const cleanText = text.trim();
    setError("");
    setNotice("");

    if (!cleanText) {
      setError("Bạn cần nhập câu hỏi.");
      return;
    }

    viewerId.current ??= crypto.randomUUID();
    const isRetry = pending.current?.text === cleanText;

    if (!pending.current || pending.current.text !== cleanText) {
      pending.current = {
        questionId: crypto.randomUUID(),
        sessionId: viewerId.current,
        text: cleanText,
      };
    }

    const request = pending.current;
    sending.current = true;
    setBusy(true);

    try {
      onLog(
        "live_question_sent",
        {
          liveId: live.liveId,
          questionId: request.questionId,
        },
        {
          isRetry,
          requestSessionId: request.sessionId,
          pinnedSkuAtSend: live.pinnedSku,
        },
      );

      const { response, data, error: failure } = await browserApi.POST(
        "/api/live/{live_id}/questions",
        {
          params: { path: { live_id: live.liveId } },
          body: request,
        },
      );

      if (!response.ok) {
        onLog(
          response.status < 500
            ? "live_question_rejected"
            : "live_question_delivery_unknown",
          {
            liveId: live.liveId,
            questionId: request.questionId,
          },
          {
            httpStatus: response.status,
          },
        );

        if (response.status < 500) pending.current = null;
        setError(response.status < 500 ? errorText(failure)
          : "Chưa xác nhận được kết quả. Giữ nguyên nội dung và gửi lại để kiểm tra.");
        return;
      }

      onLog(
        "live_question_accepted",
        {
          liveId: live.liveId,
          questionId: request.questionId,
          sku: data?.sku,
          mediaSource: data?.mediaSource ?? undefined,
        },
        {
          httpStatus: response.status,
          status: data?.status ?? null,
          receivedAt: data?.receivedAt ?? null,
        },
      );

      pending.current = null;
      setText("");
      setNotice(
        data?.status === "skipped"
          ? "Câu hỏi đã được nhận trước đó và hiện đã bỏ qua."
          : "Đã nhận câu hỏi. Danh sách sẽ tự cập nhật.",
      );
    } catch {
      onLog(
        "live_question_delivery_unknown",
        {
          liveId: live.liveId,
          questionId: request.questionId,
        },
        {
          reason: "network_error",
        },
      );

      setError(
        "Chưa xác nhận được kết quả. Giữ nguyên nội dung và gửi lại để kiểm tra.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-4 border-t border-line pt-5">
      <h2 className="text-lg font-bold">Câu hỏi trong phiên</h2>

      {questions.length === 0 ? (
        <p className="text-sm text-muted">Chưa có câu hỏi.</p>
      ) : (
        <ul className="grid max-h-80 gap-3 overflow-y-auto">
          {questions.map((question) => (
            <li
              key={question.questionId}
              className="grid gap-1 rounded-xl border border-line p-3"
            >
              <p className="whitespace-pre-wrap break-words">
                {question.text}
              </p>

              <p className="text-sm text-muted">
                SKU: {question.sku} · {STATUS_LABELS[question.status]}
              </p>

              {question.mediaSource === "prerecorded" && (
                <p className="text-sm text-muted">
                  Video mô phỏng: dùng clip có sẵn để kiểm tra luồng phát,
                  chưa tạo câu trả lời AI cho câu hỏi này.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!accepting && (
        <p className="text-sm text-muted">
          Phiên hiện không nhận câu hỏi.
        </p>
      )}

      <form onSubmit={submitQuestion} className="grid gap-3">
        <fieldset
          disabled={busy || !connected || !accepting}
          className="grid gap-3"
        >
          <Field label="Câu hỏi của bạn">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              required
              maxLength={500}
              rows={3}
              placeholder="Nhập câu hỏi về sản phẩm đang giới thiệu"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 disabled:opacity-50"
            />
          </Field>

          <Button type="submit" className="w-fit">
            {busy ? "Đang gửi…" : "Gửi câu hỏi"}
          </Button>
        </fieldset>

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
      </form>
    </section>
  );
}
