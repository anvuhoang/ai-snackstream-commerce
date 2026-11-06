import "server-only";
import type { NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";
const DROP_REQ = new Set(["host", "connection", "content-length"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

/** Forward a request to FastAPI (API_URL is read at runtime, so it can change without a rebuild). */
export async function proxy(req: NextRequest, apiPath: string): Promise<Response> {
  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!DROP_REQ.has(k)) headers.set(k, v); });
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const upstream = await fetch(`${API_URL}${apiPath}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: "manual",
    // @ts-expect-error duplex is required when passing a stream
    duplex: hasBody ? "half" : undefined,
    cache: "no-store",
  });
  const out = new Headers();
  upstream.headers.forEach((v, k) => { if (!DROP_RES.has(k) && k !== "set-cookie") out.append(k, v); });
  for (const c of upstream.headers.getSetCookie()) out.append("set-cookie", c);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
