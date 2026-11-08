"use client";

import { useEffect } from "react";
import { captureUtm, track, type TrackName } from "@/lib/track";

/** Remembers the campaign a visitor arrived with. Mounted once, in the root layout, so every landing page is covered. */
export function UtmCapture() {
  useEffect(() => {
    captureUtm(window.location.search);
  }, []);
  return null;
}

/** Sends one event when the page it sits on is shown (for example a product page being opened). */
export function TrackOnMount({ event, sku }: { event: TrackName; sku?: string }) {
  useEffect(() => {
    track(event, sku ? { sku } : {});
  }, [event, sku]);
  return null;
}
