import type { Metadata } from "next";
import { PlaybackDemo } from "./playback-demo";

export const metadata: Metadata = { title: "Live" };

export default function LivePage() {
  return <PlaybackDemo />;
}
