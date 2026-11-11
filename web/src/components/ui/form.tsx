import type { SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-xl border-2 border-line bg-surface px-4 text-[15px] placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:bg-canvas disabled:text-muted";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 py-3", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "h-12", className)} {...props} />;
}

/** A labelled form row with an optional hint and error line. */
export function FormRow({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      {children}
      {hint && !error && <span className="text-xs font-normal text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs font-normal text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

/** A line of feedback after an action: green for success, red for failure. */
export function Status({ kind, children }: { kind: "ok" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl border-2 px-4 py-2.5 text-sm font-medium",
        kind === "ok" ? "border-ok/25 bg-ok-soft text-ok" : "border-danger/25 bg-danger-soft text-danger",
      )}
    >
      {children}
    </p>
  );
}
