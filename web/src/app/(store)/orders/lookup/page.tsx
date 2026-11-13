import type { Metadata } from "next";
import { LookupView } from "@/components/orders/lookup-view";

export const metadata: Metadata = { title: "Tra cứu đơn hàng" };

export default function LookupPage() {
  return <LookupView />;
}
