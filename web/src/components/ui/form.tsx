import type { SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:bg-canvas focus:outline-none disabled:bg-canvas disabled:text-muted";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 py-2.5", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "h-11", className)} {...props} />;
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
    <label className="grid gap-1.5 text-sm">
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">{label}</span>
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
      className={cn("border px-3 py-2 text-sm", kind === "ok" ? "border-ink bg-canvas text-ink" : "border-danger bg-danger/5 text-danger")}
    >
      {children}
    </p>
  );
}
