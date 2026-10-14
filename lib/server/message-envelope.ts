export const maxMessageEnvelopeBytes = 64 * 1024;

export type MessageEnvelopeError = "invalid" | "too-large";

export function decodeMessageEnvelope(value: unknown):
  | { ok: true; bytes: Buffer }
  | { ok: false; error: MessageEnvelopeError } {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return { ok: false, error: "invalid" };
  }

  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    return { ok: false, error: "invalid" };
  }

  if (bytes.length > maxMessageEnvelopeBytes) {
    return { ok: false, error: "too-large" };
  }

  return { ok: true, bytes };
}
