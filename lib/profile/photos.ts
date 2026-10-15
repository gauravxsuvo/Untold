export const maxProfilePhotoSourceBytes = 8 * 1024 * 1024;
export const maxProfilePhotoUploadBytes = 1024 * 1024;
export const maxStoredProfilePhotoBytes = 64 * 1024;
export const profilePhotoSize = 256;

export function profilePhotoUrl(userId: string, version: string): string {
  return `/api/people/${encodeURIComponent(userId)}/photo?v=${version}`;
}

export function safeProfilePhotoUrl(userId: string, value: unknown): string | null {
  const prefix = `/api/people/${encodeURIComponent(userId)}/photo?v=`;
  if (typeof value !== "string" || !value.startsWith(prefix)) return null;
  const version = value.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(version)
    ? profilePhotoUrl(userId, version)
    : null;
}

export class ProfilePhotoError extends Error {}
