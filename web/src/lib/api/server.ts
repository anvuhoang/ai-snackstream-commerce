import "server-only";
import createClient from "openapi-fetch";
import { headers } from "next/headers";
import type { paths } from "./schema";
import { API_URL } from "@/lib/proxy";

/**
 * Typed API client for server components. It forwards the visitor's cookie header VERBATIM
 * (cookies().toString() would re-encode "=" and break the signed session).
 */
export async function serverApi() {
  const cookie = (await headers()).get("cookie") ?? "";
  return createClient<paths>({ baseUrl: API_URL, headers: { cookie }, cache: "no-store" });
}
