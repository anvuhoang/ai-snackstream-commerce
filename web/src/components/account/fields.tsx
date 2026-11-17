"use client";

import { useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: string;
  hint?: string;
  error?: string;
  /** Something at the right edge of the input (the show/hide word of a password). */
  trailing?: ReactNode;
  optional?: boolean;
  /** A small link on the label line, for example "Quên mật khẩu?". */
  action?: ReactNode;
};

/** A plain labelled input: white, 1px line, a clear focus ring, the error in words under it. No icons, no tinted boxes. */
export function TextField({ label, hint, error, trailing, optional, action, id, ...props }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {label}
        </label>
        {optional && <span className="text-xs font-normal text-muted">Không bắt buộc</span>}
        {action}
      </div>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-12 w-full rounded-[10px] border bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/55",
            "transition-shadow focus:outline-none focus:ring-[3px]",
            "read-only:bg-paper read-only:text-muted",
            trailing && "pr-16",
            error
              ? "border-danger focus:border-danger focus:ring-danger/15"
              : "border-line hover:border-muted/50 focus:border-ink focus:ring-ink/10",
          )}
          {...props}
        />
        {trailing && <span className="absolute right-3 top-1/2 -translate-y-1/2">{trailing}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${inputId}-hint`} className="text-[13px] text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Password input with a "Hiện" / "Ẩn" word, so the shopper can check what they typed. */
export function PasswordField({ label, ...props }: Omit<FieldProps, "type" | "trailing">) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      label={label}
      type={shown ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-pressed={shown}
          className="rounded px-1 text-[13px] font-semibold text-muted hover:text-ink"
        >
          {shown ? "Ẩn" : "Hiện"}
        </button>
      }
    />
  );
}

/** Rough strength of a password. Only the length (8+) is enforced by the server; the line nudges towards a better one. */
export function passwordScore(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: "" };
  let points = 0;
  if (password.length >= 8) points++;
  if (/[a-zA-Z]/.test(password) && /\d/.test(password)) points++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) points++;
  if (password.length >= 12 || /[^a-zA-Z0-9]/.test(password)) points++;
  if (password.length < 8) points = Math.min(points, 1);
  const score = Math.max(1, points) as 1 | 2 | 3 | 4;
  return { score, label: ["", "Yếu", "Trung bình", "Khá", "Mạnh"][score] };
}

export function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordScore(password);
  const colour = score <= 1 ? "bg-danger" : score === 2 ? "bg-turmeric" : "bg-ok";
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="grid grid-cols-4 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-1 rounded-full transition-colors", i <= score ? colour : "bg-line")} />
        ))}
      </div>
      <p className="text-[13px] text-muted">{password ? `Độ mạnh: ${label}` : "Ít nhất 8 ký tự, nên có cả chữ và số."}</p>
    </div>
  );
}
