export const maxGroupMembers = 8;
export function normalizeGroupName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim();
  // Reject invisible controls that can disguise names or change text direction.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Group names must not contain controls.
  const controls = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
  return name.length > 0 && name.length <= 80 && !controls.test(name) ? name : null;
}
export function groupPhotoUrl(conversationId: string, version: string) {
  return `/api/groups/${encodeURIComponent(conversationId)}/photo?v=${version}`;
}
export function safeGroupPhotoUrl(conversationId: string, value: unknown): string | null {
  const prefix = `/api/groups/${encodeURIComponent(conversationId)}/photo?v=`;
  if (typeof value !== "string" || !value.startsWith(prefix)) return null;
  const version = value.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(version)
    ? groupPhotoUrl(conversationId, version)
    : null;
}
