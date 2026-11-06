import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";
export type SP = Record<string, string | string[] | undefined>;

// Forward the Cookie header VERBATIM (cookies().toString() re-encodes '=' and breaks the session signature)
const rawCookie = async () => (await headers()).get("cookie") ?? "";

/** Call the API from a server component, forwarding the session cookie. 401 -> redirect to the login page. */
export async function api<T>(path: string, params?: SP): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) qs.set(k, val);
  }
  const url = `${API_URL}${path}${qs.size ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: { cookie: await rawCookie() }, cache: "no-store" });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`API ${path} lỗi ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiOptional<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { headers: { cookie: await rawCookie() }, cache: "no-store" });
  return res.ok ? ((await res.json()) as T) : null;
}

/** Keep the filter parameters when navigating between pages. */
export const FILTER_KEYS = ["from", "to", "platform", "dist", "campaign", "sku", "content", "mode"] as const;
export function filterQuery(sp: SP, extra: Record<string, string | undefined> = {}): string {
  const qs = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined);
    if (v) qs.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v) qs.set(k, v);
    else qs.delete(k);
  }
  return qs.size ? `?${qs}` : "";
}
