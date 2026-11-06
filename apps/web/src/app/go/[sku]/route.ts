import type { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";

// /go/BTT-001?c=SV-001 -> record a click_shopee event, then redirect to the Shopee product page
export async function GET(req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  return proxy(req, `/api/public/go/${encodeURIComponent(sku)}`);
}
export const dynamic = "force-dynamic";
