import { readBoundedStream } from "../messaging/bounded-stream";
import { maxProcessedAttachmentBytes } from "../messaging/attachment-policy";

export const maxAccountAttachmentBytes = 1024 * 1024 * 1024;
const maxCiphertextBytes = maxProcessedAttachmentBytes + 16;

export async function readAttachmentUpload(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity")
    throw new TypeError("Upload content encoding is not supported.");
  const length = request.headers.get("content-length");
  let expectedBytes: number | undefined;
  if (length !== null) {
    expectedBytes = Number(length);
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(expectedBytes) || expectedBytes < 16) {
      throw new TypeError("Invalid encrypted file size.");
    }
    if (expectedBytes > maxCiphertextBytes)
      throw new RangeError("Files must be 20 MiB or smaller.");
  }
  if (!request.body) throw new TypeError("Encrypted file bytes are required.");
  const bytes = await readBoundedStream(request.body, {
    maxBytes: maxCiphertextBytes,
    expectedBytes,
    timeoutMs: 30_000,
    signal: request.signal,
  });
  if (bytes.byteLength < 16) {
    bytes.fill(0);
    throw new TypeError("Invalid encrypted file size.");
  }
  return bytes;
}

// Bound simultaneous upload buffers per process as well as per-account request rates.
// The database quota/rate limit still applies across all application replicas.
const activeUploads = new Map<string, number>();
let totalUploads = 0;

export function acquireAttachmentUpload(userId: string): (() => void) | null {
  const current = activeUploads.get(userId) ?? 0;
  if (current >= 2 || totalUploads >= 4) return null;
  activeUploads.set(userId, current + 1);
  totalUploads++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (activeUploads.get(userId) ?? 1) - 1;
    if (remaining === 0) activeUploads.delete(userId);
    else activeUploads.set(userId, remaining);
    totalUploads--;
  };
}
