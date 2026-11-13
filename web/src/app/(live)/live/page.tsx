import type { Metadata } from "next";
import { LiveSessionViewer } from "@/components/live/live-session-viewer";

export const metadata: Metadata = { title: "Live" };

export default function LivePage() {
  return <LiveSessionViewer />;
}