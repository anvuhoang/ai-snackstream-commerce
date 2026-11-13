import type { components } from "@/lib/api/schema";

/**
 * Behaviour events for the dashboard. Browser-only: import it from client components.
 *
 * - The session id is a random value kept in this browser. It identifies a browser, not a person.
 * - The last UTM the visitor arrived with is remembered for 7 days (last touch, see docs/ARCHITECTURE.md) and sent with each event and with
 *   the checkout, so an order can be credited to a source.
 * - Tracking must never get in the way of shopping: every failure is swallowed, nothing is awaited by the caller.
 */
type EventIn = components["schemas"]["EventIn"];
export type TrackName = EventIn["event"];
type Extra = Partial<Pick<EventIn, "sku" | "qty" | "surface" | "cartValueVnd" | "liveId" | "conversationId">>;

const SESSION_KEY = "ss_sid";
const UTM_KEY = "ss_utm";
const UTM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Utm = { source: string; campaign: string; contentCode: string; at: number };

let memorySession: string | null = null;

function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private window or blocked storage: carry on without it
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function sessionId(): string {
  const stored = read(SESSION_KEY);
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
  memorySession ??= randomId();
  write(SESSION_KEY, memorySession);
  return memorySession;
}

/** Remember the campaign in the address (?utm_source=…) if there is one. A new campaign replaces the old one (last touch). */
export function captureUtm(search: string): void {
  const q = new URLSearchParams(search);
  const source = (q.get("utm_source") ?? "").trim().slice(0, 100);
  const campaign = (q.get("utm_campaign") ?? "").trim().slice(0, 100);
  const contentCode = (q.get("utm_content") ?? "").trim().slice(0, 100);
  if (!source && !campaign && !contentCode) return;
  write(UTM_KEY, JSON.stringify({ source, campaign, contentCode, at: Date.now() } satisfies Utm));
}

function currentUtm(): Utm | null {
  const raw = read(UTM_KEY);
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as Utm;
    if (typeof u.at === "number" && Date.now() - u.at < UTM_WINDOW_MS) return u;
  } catch {
    /* fall through */
  }
  write(UTM_KEY, null); // expired or damaged
  return null;
}

/** What to send with the checkout so the order is credited to the visitor's last touch. */
export function attribution() {
  const u = currentUtm();
  return { sessionId: sessionId(), source: u?.source ?? "", campaign: u?.campaign ?? "", contentCode: u?.contentCode ?? "" };
}

export function track(event: TrackName, extra: Extra = {}): void {
  try {
    const body: EventIn = { event, eventId: randomId(), ...attribution(), ...extra };
    // keepalive lets the request finish even when the click opens another page (the Shopee button).
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* tracking is optional */
  }
}
