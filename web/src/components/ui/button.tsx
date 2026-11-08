import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 text-[11px] font-medium uppercase tracking-[0.04em] transition-colors disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-brand-hover",
        outline: "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-ink)] hover:bg-canvas",
        ghost: "text-muted hover:bg-canvas hover:text-ink",
      },
      size: { sm: "h-8 px-3", md: "h-10 px-5", lg: "h-12 px-7" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

/** Same look for links that should behave like buttons. */
export const buttonClass = (opts?: VariantProps<typeof button>) => button(opts);
