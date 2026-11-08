import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:bg-canvas focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">{label}</span>
      {children}
    </label>
  );
}
