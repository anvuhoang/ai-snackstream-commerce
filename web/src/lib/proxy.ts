import "server-only";
import type { NextRequest } from "next/server";

export const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

const DROP_REQUEST = new Set(["host", "connection", "content-length"]);
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

/**
 * Forward a browser request to the API. The browser only ever talks to this web app (same origin), so the
 * session cookie works without CORS and no API address or key is exposed. API_URL is read at runtime.
 * The response body is passed through as a stream, which is what server-sent events (live) need.
 */
export async function proxy(req: NextRequest, apiPath: string): Promise<Response> {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!DROP_REQUEST.has(key)) headers.set(key, value);
  });
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const upstream = await fetch(`${API_URL}${apiPath}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: "manual",
    // @ts-expect-error duplex is required by Node when the body is a stream
    duplex: hasBody ? "half" : undefined,
    cache: "no-store",
  });
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE.has(key) && key !== "set-cookie") out.append(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
