import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-xl border-2 border-line bg-surface px-4 text-[15px] placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:bg-canvas disabled:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}
