import type { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";

type Ctx = { params: Promise<{ path: string[] }> };
const handler = async (req: NextRequest, { params }: Ctx) => proxy(req, `/api/${(await params).path.join("/")}`);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const dynamic = "force-dynamic";
