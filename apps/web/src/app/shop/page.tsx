import type { Metadata } from "next";
import { API_URL } from "@/lib/api";
import type { Product } from "@/lib/types";
import { ShopClient } from "./ShopClient";

export const metadata: Metadata = {
  title: "SnackStream · Đặc sản ăn vặt",
  description: "Bánh tráng trộn, khô bò, khô gà và các món ăn vặt đường phố. Đặt hàng trên Shopee.",
  robots: { index: true, follow: true },
};
export const dynamic = "force-dynamic";

async function load(): Promise<Product[]> {
  try {
    const res = await fetch(`${API_URL}/api/public/products`, { cache: "no-store" });
    return res.ok ? ((await res.json()).products as Product[]) : [];
  } catch {
    return [];
  }
}

export default async function ShopPage() {
  return <ShopClient products={await load()} />;
}
