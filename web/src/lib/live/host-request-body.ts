// SdpText allows 100,000 characters. JSON can encode one character as six
// bytes (\uXXXX); leave 4 KiB for bounded ASCII IDs, keys and JSON punctuation.
export const HOST_COMMAND_BYTES = 4096;
export const HOST_SDP_BYTES = 6 * 100_000 + HOST_COMMAND_BYTES;

export class HostBodyTooLarge extends Error {}

export function hostJsonLimit(request: Request, path: string): number | null {
  if (request.method !== "POST" || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  const admin = /^\/api\/admin\/live\/[^/]+\/host\/(acquire|token|audio|action|offer|mock-video|reply-audio\/[^/]+)$/;
  const viewer = /^\/api\/live\/[^/]+\/host\/viewers(?:\/[^/]+\/(answer|leave))?$/;
  if (!admin.test(path) && !viewer.test(path)) return null;
  return /\/(offer|answer)$/.test(path) ? HOST_SDP_BYTES : HOST_COMMAND_BYTES;
}

export async function readHostJson(request: Request, limit: number): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    void request.body?.cancel().catch(() => {});
    throw new HostBodyTooLarge();
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > limit - size) {
        void reader.cancel().catch(() => {});
        throw new HostBodyTooLarge();
      }
      size += value.byteLength;
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } finally { reader.releaseLock(); }
}
