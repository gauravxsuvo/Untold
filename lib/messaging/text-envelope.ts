// Compatibility decoder for messages stored before browser-side encryption was connected.
// New message sends use the versioned protocol in crypto/src/protocol.ts.

export const maxMessageLength = 2000;

type TextEnvelope = { v: 1; type: "text"; text: string };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function normalizeMessageText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > maxMessageLength) return null;
  return trimmed;
}

export function encodeTextEnvelope(text: string): string {
  const normalized = normalizeMessageText(text);
  if (normalized === null) throw new Error("Message text is empty or too long.");

  const envelope: TextEnvelope = { v: 1, type: "text", text: normalized };
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope)));
}

export function decodeTextEnvelope(value: string | Uint8Array): string | null {
  try {
    const bytes = typeof value === "string" ? base64ToBytes(value) : value;
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object") return null;

    const envelope = parsed as Partial<TextEnvelope>;
    if (envelope.v !== 1 || envelope.type !== "text" || typeof envelope.text !== "string") {
      return null;
    }
    return normalizeMessageText(envelope.text) === envelope.text ? envelope.text : null;
  } catch {
    return null;
  }
}
