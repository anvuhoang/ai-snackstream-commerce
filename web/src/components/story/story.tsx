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

  // The header button says "Đăng nhập" in the static markup; once we know who is here it becomes their account link.
  useEffect(() => {
    let live = true;
    fetch("/api/account/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { customer?: { fullName: string } | null } | null) => {
        const button = document.getElementById("acct");
        if (!live || !button || !data?.customer) return;
        const first = data.customer.fullName.trim().split(/\s+/).at(-1) ?? "bạn";
        button.textContent = `Xin chào, ${first}`;
        button.setAttribute("data-href", "/account");
      })
      .catch(() => {});
    return () => {
      live = false;
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
