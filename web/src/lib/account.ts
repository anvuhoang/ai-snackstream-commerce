import type { components } from "@/lib/api/schema";

type Schemas = components["schemas"];
export type CustomerOut = Schemas["CustomerOut"];
export type OrderOut = Schemas["OrderOut"];

/** One slash, then a path. No second slash or backslash, and no whitespace or control character anywhere. */
const SAME_SITE_PATH = /^\/(?![/\\])[^\s\u0000-\u001f\\]*$/;

/**
 * Where to go after signing in. Only same-site paths are accepted, so a crafted link cannot send a customer elsewhere.
 * Whitespace and control characters are refused because browsers drop tabs and newlines inside a URL: "/<tab>/evil"
 * would otherwise become "//evil", a link to another site.
 */
export function safeNext(value: string | string[] | undefined, fallback = "/account"): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && SAME_SITE_PATH.test(next) ? next : fallback;
}
