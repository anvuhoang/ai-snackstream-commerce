import type { Metadata } from "next";
import { ChatLauncher } from "@/components/chat-launcher";
import { Story } from "@/components/story/story";
import "./story.css";

export const metadata: Metadata = {
  title: { absolute: "SnackStream · Đặc sản ăn vặt đường phố" },
  description: "Bánh tráng, khô gà, khô bò, trái cây sấy và nhiều món ăn vặt đường phố. Thành phần đối chiếu với bao bì thật.",
};

export default function HomePage() {
  return (
    <>
      <Story />
      <ChatLauncher />
    </>
  );
}
