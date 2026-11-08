"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { STORY_HTML } from "./story-html";

/**
 * The home page: a scroll-driven story. The markup is static; the engine (three.js, loaded only here) drives it from the scroll
 * position. Without WebGL the engine falls back to the same pages with the 3D bag hidden.
 */
export function Story() {
  const router = useRouter();

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const [THREE, { startStory }, { default: Lenis }] = await Promise.all([import("three"), import("./story-engine"), import("lenis")]);
      if (!cancelled) stop = startStory(THREE, Lenis);
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div
      className="story"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".shop")) router.push("/products");
      }}
      // Trusted, static markup from our own source (no user input reaches it).
      dangerouslySetInnerHTML={{ __html: STORY_HTML }}
    />
  );
}
