"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Hook: true once the element has scrolled into view (fires once). */
export function useInView<T extends HTMLElement>(threshold = 0.06) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window) || prefersReducedMotion()) { const id = requestAnimationFrame(() => setSeen(true)); return () => cancelAnimationFrame(id); }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { threshold, rootMargin: "0px 0px -4% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, seen };
}

/** Wraps a block so it fades/slides in when scrolled into view, staggered by index. */
export function Reveal({ children, className = "", index = 0, as = "div", style }: {
  children: ReactNode; className?: string; index?: number; as?: "div" | "section"; style?: CSSProperties;
}) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const Tag = as as "div";
  return (
    <Tag ref={ref} className={`rv ${seen ? "in" : ""} ${className}`} style={{ ["--d" as string]: `${Math.min(index, 9) * 55}ms`, ...style }}>
      {children}
    </Tag>
  );
}
