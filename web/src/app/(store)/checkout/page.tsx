import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";

export const metadata: Metadata = { title: "Giỏ hàng và thanh toán" };

export default function CheckoutPage() {
  return <CheckoutView />;
}
