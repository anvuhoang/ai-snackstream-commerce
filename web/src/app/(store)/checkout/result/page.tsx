import type { Metadata } from "next";
import { PaymentResult } from "@/components/checkout/payment-result";

export const metadata: Metadata = { title: "Kết quả thanh toán" };

export default function PaymentResultPage() {
  return <PaymentResult />;
}
