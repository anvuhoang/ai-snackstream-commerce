"use client";
import { useEffect, useState, type ReactNode } from "react";
import { fmt } from "@/lib/format";
import type { Kind } from "@/lib/types";
import { useInView, prefersReducedMotion } from "./Reveal";

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** A number that counts up from 0 to its real value when revealed; always ends exactly on the original value. */
export function CountNum({ value, kind = "int", digits = 2, tail }: { value: number; kind?: Kind; digits?: number; tail?: ReactNode }) {
  const { ref, seen } = useInView<HTMLSpanElement>(0.2);
  const [shown, setShown] = useState<number>(value);
  useEffect(() => {
    if (!seen) return;
    if (value === 0 || prefersReducedMotion()) { const id = requestAnimationFrame(() => setShown(value)); return () => cancelAnimationFrame(id); }
    const dur = Math.min(1500, 700 + Math.log10(Math.abs(value) + 10) * 160);
    let t0: number | null = null, raf = 0;
    const step = (ts: number) => {
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / dur);
      setShown(p < 1 ? value * easeOutExpo(p) : value);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame((ts) => { setShown(0); step(ts); });
    return () => cancelAnimationFrame(raf);
  }, [seen, value]);
  return <span ref={ref}>{fmt(kind, shown, digits)}{tail}</span>;
}
