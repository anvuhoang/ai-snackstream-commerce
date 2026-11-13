import "server-only";
import { serverApi } from "@/lib/api/server";

/** The shop settings the pages show (free-shipping threshold, shipping fee). Falls back to the defaults when the API cannot be reached, so a page still renders. */
const FALLBACK = { shippingFeeVnd: 30_000, freeShipFromVnd: 300_000 };

export async function getShopConfig(): Promise<{ shippingFeeVnd: number; freeShipFromVnd: number }> {
  try {
    const api = await serverApi();
    const { data } = await api.GET("/api/shop/config");
    if (data) return { shippingFeeVnd: data.shippingFeeVnd, freeShipFromVnd: data.freeShipFromVnd };
  } catch {
    /* use the fallback */
  }
  return FALLBACK;
}
