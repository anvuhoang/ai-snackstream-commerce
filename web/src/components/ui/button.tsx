import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-transparent text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-accent-hover",
        outline: "border-ink bg-transparent text-ink hover:bg-ink hover:text-paper",
        ghost: "text-muted hover:bg-canvas hover:text-ink",
      },
      size: { sm: "h-9 px-4", md: "h-11 px-6", lg: "h-14 px-8 text-base" },
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
