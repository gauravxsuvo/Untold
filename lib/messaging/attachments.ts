import { maxAttachmentBytes } from "@/crypto/src/protocol";

export const attachmentMessagePrefix = "untold-attachment:v1\n";

export type AttachmentManifest = Readonly<{
  kind: "untold-attachment";
  version: 1;
  id: string;
  name: string;
  contentType: string;
  size: number;
  key: string;
  nonce: string;
}>;

export type OpenedMessageContent =
  | { kind: "text"; text: string }
  | { kind: "attachment"; attachment: AttachmentManifest }
  | { kind: "invalid-attachment" };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base64UrlKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const base64UrlNoncePattern = /^[A-Za-z0-9_-]{16}$/;

export function sanitizeAttachmentName(value: string): string {
  const name = value.normalize("NFC")
    .replaceAll("/", "_")
    .replaceAll("\\", "_")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? "_" : character;
    })
    .join("")
    .trim()
    .slice(0, 180);
  return name || "File";
}

export function normalizeAttachmentContentType(value: string): string {
  const contentType = value.trim().toLowerCase();
  return contentType.length <= 127 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)
    ? contentType
    : "application/octet-stream";
}

export function encodeAttachmentMessage(attachment: AttachmentManifest): string {
  return `${attachmentMessagePrefix}${JSON.stringify(attachment)}`;
}

export function openMessageContent(plaintext: string, attachmentId: string | null | undefined): OpenedMessageContent {
  if (!attachmentId) return { kind: "text", text: plaintext };
  if (!plaintext.startsWith(attachmentMessagePrefix)) return { kind: "invalid-attachment" };

  let value: unknown;
  try {
    value = JSON.parse(plaintext.slice(attachmentMessagePrefix.length));
  } catch {
    return { kind: "invalid-attachment" };
  }
  if (!value || typeof value !== "object") return { kind: "invalid-attachment" };
  const candidate = value as Partial<AttachmentManifest>;
  if (
    candidate.kind !== "untold-attachment" ||
    candidate.version !== 1 ||
    candidate.id !== attachmentId ||
    !uuidPattern.test(candidate.id) ||
    typeof candidate.name !== "string" ||
    candidate.name.length === 0 ||
    candidate.name.length > 180 ||
    typeof candidate.contentType !== "string" ||
    normalizeAttachmentContentType(candidate.contentType) !== candidate.contentType ||
    typeof candidate.size !== "number" ||
    !Number.isSafeInteger(candidate.size) ||
    candidate.size < 0 ||
    candidate.size > maxAttachmentBytes ||
    typeof candidate.key !== "string" ||
    !base64UrlKeyPattern.test(candidate.key) ||
    typeof candidate.nonce !== "string" ||
    !base64UrlNoncePattern.test(candidate.nonce)
  ) {
    return { kind: "invalid-attachment" };
  }
  return {
    kind: "attachment",
    attachment: { ...candidate, name: sanitizeAttachmentName(candidate.name) } as AttachmentManifest,
  };
}

export function attachmentPreviewKind(contentType: string): "image" | "video" | "audio" | null {
  if (["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(contentType)) return "image";
  if (["video/mp4", "video/ogg", "video/webm"].includes(contentType)) return "video";
  if (["audio/aac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm"].includes(contentType)) return "audio";
  return null;
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
