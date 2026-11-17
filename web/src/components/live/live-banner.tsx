"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { browserApi } from "@/lib/api/browser";

const POLL_MS = 15_000;
const DISMISSED_KEY = "ss_live_banner_dismissed";

type Live = { liveId: string; title: string };

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null; // storage can be blocked; the banner then simply comes back on the next page
  }
}

/**
 * "Đang LIVE" bar shown on every shop page while a livestream is running. It asks the public live endpoint every few
 * seconds (only while the tab is visible), hides itself on the live page, and a customer can close it for that session.
 */
export function LiveBanner() {
  const pathname = usePathname();
  const [live, setLive] = useState<Live | null>(null);
  // Read lazily on the client only; the banner renders nothing until the first poll answers, so there is no mismatch.
  const [dismissed, setDismissed] = useState<string | null>(() => (typeof window === "undefined" ? null : readDismissed()));

  useEffect(() => {
    let active = true;
    async function check() {
      if (document.visibilityState === "hidden") return;
      try {
        const { data } = await browserApi.GET("/api/live/current");
        if (!active || !data) return;
        const s = data.session;
        setLive(s && (s.status === "playing" || s.status === "paused") ? { liveId: s.liveId, title: s.title } : null);
      } catch {
        // offline or the API is restarting: keep what is shown and try again next time
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!live || dismissed === live.liveId || pathname.startsWith("/live")) return null;

  return (
    <div role="status" aria-live="polite" className="bg-accent px-4 py-2.5 text-white">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[14px] sm:px-4">
        <span className="inline-flex items-center gap-2 font-semibold">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-white" />
          Đang LIVE
        </span>
        <span className="min-w-0 truncate">{live.title}</span>
        <Link href="/live" className="rounded-full bg-white px-3.5 py-1 text-[13px] font-semibold text-accent hover:bg-white/90">
          Xem live
        </Link>
        <button
          type="button"
          aria-label="Đóng thông báo live"
          onClick={() => {
            try {
              window.sessionStorage.setItem(DISMISSED_KEY, live.liveId);
            } catch {
              /* ignore */
            }
            setDismissed(live.liveId);
          }}
          className="rounded-full px-2 py-0.5 text-lg leading-none hover:bg-white/15"
        >
          ×
        </button>
      </div>
    </div>
  );
}
