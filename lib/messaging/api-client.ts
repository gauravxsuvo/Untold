import type { ConversationMessage, ConversationSummary } from "@/lib/messaging/people";
import type { PublicDevice } from "@/crypto/src/protocol";
import type {
  AccountIdentity,
  ContactVerification,
  DeviceApproval,
  DeviceRemoval,
  SealedApproval,
} from "@/crypto/src/account-types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Only known, useful local errors may reach the interface. Browser and crypto
// exceptions can contain implementation details and must use the fallback.
const localErrorMessages = new Map([
  [
    "The linking code doesn’t match this device. Check the code on your new device and try again.",
    "The linking code doesn’t match this device. Check the code on your new device and try again.",
  ],
  [
    "Your account safety identity changed. Open Settings to recover this device.",
    "Your messaging access changed. Open Settings to recover this device, or use an approved device.",
  ],
  [
    "Approve this device before verifying a contact.",
    "Approve this device in Settings first. Your contact verifications will carry over.",
  ],
  [
    "The account safety code changed. Refresh and compare the new code.",
    "Your contact’s account safety code changed. Refresh and compare the new code before continuing.",
  ],
  ["Files must be 20 MiB or smaller.", "Choose a file that’s 20 MB or smaller."],
  [
    "Executable files, scripts, shortcuts, and macro-enabled documents cannot be shared.",
    "Apps, scripts, shortcuts, and documents with macros can’t be shared.",
  ],
  ["Executable files and scripts cannot be shared.", "Apps and scripts can’t be shared."],
  [
    "This image or video is too large to process safely. Use a smaller resolution.",
    "This photo or video is too large to open safely. Try a smaller version.",
  ],
  [
    "The file contents do not match its media type.",
    "This file doesn’t match its file type. Try another copy.",
  ],
  [
    "The image header is invalid or unsupported.",
    "We can’t open this photo. Try another copy or file type.",
  ],
  ["Update your browser to open this compressed file.", "Update your browser to open this file."],
  ["Unsupported file format. Update Untold and try again.", "Update Untold to open this file."],
  [
    "This image is available as a download only.",
    "This photo can only be downloaded. A preview isn’t available.",
  ],
  ["Media processing timed out.", "Preparing this file took too long. Try a smaller version."],
  [
    "This browser does not provide secure Web Crypto. Open Untold over HTTPS.",
    "This browser can’t protect your messages. Use an up-to-date browser and open Untold from its secure web address.",
  ],
  [
    "This device was added after the message was sent and cannot open it.",
    "This message was sent before you added this device. Open it in the browser you used before.",
  ],
  [
    "This device key changed. Stop and verify the account with its owner.",
    "This safety code has changed. Check with your contact before continuing.",
  ],
  [
    "Message signature is invalid. The message may have been changed.",
    "This message may have been changed. Ask your contact to send it again.",
  ],
  [
    "File authentication failed. Its encrypted bytes may have changed.",
    "This file may have been changed. Ask your contact to send it again.",
  ],
  ["Message exceeds the encrypted text limit.", "This message is too long. Try a shorter message."],
]);

export function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return localErrorMessages.get(error.message) ?? fallback;
  return fallback;
}

function requestErrorMessage(status: number, message: unknown): string {
  if (status >= 500) return "Untold isn’t available right now. Please try again in a moment.";
  if (status === 401) return "Sign in again to continue.";
  if (status === 429) return "Please wait a moment before trying again.";
  if (typeof message !== "string") return "Something went wrong. Please try again.";
  // Our messaging endpoints return fixed, user-facing validation messages.
  return localErrorMessages.get(message) ?? message;
}

export type AccountDevice = PublicDevice & {
  deviceId: string;
  deviceName: string;
  agreementKey: string;
  signingKey: string;
  createdAt: string;
  revokedAt: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      headers,
    });
  } catch {
    throw new ApiError("Untold could not be reached. Check your connection.", 0);
  }

  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) {
    const wait = Number(response.headers.get("Retry-After"));
    if (response.status === 429 && Number.isInteger(wait) && wait >= 1 && wait <= 3600)
      throw new ApiError(`Please wait ${wait} seconds before trying again.`, response.status);
    throw new ApiError(requestErrorMessage(response.status, body?.message), response.status);
  }
  return body as T;
}

export async function updateProfilePhoto(photo: Blob, signal?: AbortSignal): Promise<string> {
  const result = await request<{ image: string }>("/api/profile/photo", {
    method: "PUT",
    headers: { "Content-Type": photo.type },
    body: photo,
    signal,
  });
  return result.image;
}

export async function removeProfilePhoto(): Promise<void> {
  await request<{ image: null }>("/api/profile/photo", { method: "DELETE" });
}

export async function createGroup(name: string, emails: string[]): Promise<ConversationSummary> {
  const result = await request<{ conversation: ConversationSummary }>("/api/groups", {
    method: "POST",
    body: JSON.stringify({ name, emails }),
  });
  return result.conversation;
}
export async function changeGroup(
  conversationId: string,
  change: {
    action: "rename" | "add" | "remove" | "leave" | "transfer";
    name?: string;
    email?: string;
    userId?: string;
  },
) {
  const result = await request<{ conversation: ConversationSummary | null }>(
    `/api/groups/${encodeURIComponent(conversationId)}`,
    { method: "POST", body: JSON.stringify(change) },
  );
  return result.conversation;
}
export async function uploadGroupPhoto(
  conversationId: string,
  photo: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const result = await request<{ image: string }>(
    `/api/groups/${encodeURIComponent(conversationId)}/photo`,
    { method: "PUT", headers: { "Content-Type": photo.type }, body: photo, signal },
  );
  return result.image;
}
export async function removeGroupPhoto(conversationId: string) {
  await request(`/api/groups/${encodeURIComponent(conversationId)}/photo`, { method: "DELETE" });
}

export async function fetchConversations(signal?: AbortSignal): Promise<ConversationSummary[]> {
  const { conversations } = await request<{ conversations: ConversationSummary[] }>(
    "/api/conversations",
    { signal },
  );
  return conversations;
}

export async function startConversation(email: string): Promise<ConversationSummary> {
  const { conversation } = await request<{ conversation: ConversationSummary }>(
    "/api/conversations",
    { method: "POST", body: JSON.stringify({ email: email.trim() }) },
  );
  return conversation;
}

export async function registerDevice(device: {
  deviceId: string;
  name: string;
  agreementKey: string;
  signingKey: string;
  linkHash: string;
}): Promise<void> {
  await request<{ device: unknown }>("/api/devices", {
    method: "POST",
    body: JSON.stringify(device),
  });
}

export type DeviceSecuritySnapshot = {
  identity: AccountIdentity | null;
  devices: PublicDevice[];
  verifications: ContactVerification[];
  contacts: AccountIdentity[];
  sealedApproval: SealedApproval | null;
};
export function fetchDeviceSecurity(deviceId: string) {
  return request<DeviceSecuritySnapshot>(
    `/api/security/devices?device=${encodeURIComponent(deviceId)}`,
  );
}
export function approveLinkedDevice(approval: DeviceApproval, sealed: SealedApproval) {
  return request<{ status: boolean }>("/api/security/devices", {
    method: "POST",
    body: JSON.stringify({ action: "approve", approval, sealed }),
  });
}
export function syncContactVerification(proof: ContactVerification) {
  return request<{ status: boolean }>("/api/security/devices", {
    method: "POST",
    body: JSON.stringify({ action: "verify", proof }),
  });
}
export function recoverDeviceIdentity(
  deviceId: string,
  password: string,
  code: string,
  method: "totp" | "backup",
) {
  return request<{ identity: AccountIdentity }>("/api/security/devices/recover", {
    method: "POST",
    body: JSON.stringify({ deviceId, password, code, method, confirm: true }),
  });
}

export async function fetchAccountDevices(): Promise<AccountDevice[]> {
  const { devices } = await request<{ devices: AccountDevice[] }>("/api/devices");
  return devices;
}

export async function revokeAccountDevice(deviceId: string, proof: DeviceRemoval): Promise<void> {
  await request<{ revoked: boolean }>(`/api/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    body: JSON.stringify(proof),
  });
}

export async function fetchConversationDevices(conversationId: string): Promise<PublicDevice[]> {
  const { devices } = await request<{ devices: PublicDevice[] }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/devices`,
  );
  return devices;
}

export async function fetchMessages(conversationId: string): Promise<ConversationMessage[]> {
  const { messages } = await request<{ messages: ConversationMessage[] }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  return messages;
}

export async function fetchMessageSnapshot(
  conversationId: string,
  knownIds: string[],
  etag: string | null,
  signal: AbortSignal,
  before?: string | null,
  deviceId?: string,
  liveIds?: string[],
): Promise<{
  messages: ConversationMessage[];
  calls: import("./call-history").CallHistoryEntry[];
  nextCursor: string | null;
  etag: string | null;
} | null> {
  const query = new URLSearchParams();
  query.set("timeline", "true");
  if (deviceId) query.set("deviceId", deviceId);
  if (liveIds?.length) query.set("live", liveIds.slice(0, 100).join(","));
  if (before) query.set("before", before);
  if (knownIds.length) query.set("known", knownIds.slice(0, 100).join(","));
  let response: Response;
  try {
    response = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        signal,
        headers: etag ? { "If-None-Match": etag } : undefined,
      },
    );
  } catch {
    throw new ApiError("Untold could not be reached. Check your connection.", 0);
  }
  if (response.status === 304) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(requestErrorMessage(response.status, body?.message), response.status);
  if (!Array.isArray(body?.messages))
    throw new ApiError("We couldn’t refresh this conversation. Please try again.", 0);
  return {
    messages: body.messages,
    calls: body.calls ?? [],
    nextCursor: body.nextCursor ?? null,
    etag: response.headers.get("etag"),
  };
}

export async function acknowledgeMessages(
  conversationId: string,
  receivedIds: string[],
  readIds: string[],
  signal?: AbortSignal,
): Promise<void> {
  await request<{ updated: boolean }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/receipts`,
    {
      method: "POST",
      body: JSON.stringify({ receivedIds, readIds }),
      signal,
    },
  );
}

export async function sendMessage(
  conversationId: string,
  envelope: string,
  clientMessageId: string,
  attachmentId: string | null = null,
): Promise<ConversationMessage> {
  const { message } = await request<{ message: ConversationMessage }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ clientMessageId, envelope, attachmentId }),
    },
  );
  return message;
}

export async function uploadEncryptedAttachment(
  conversationId: string,
  attachmentId: string,
  deviceId: string,
  ciphertext: Uint8Array<ArrayBuffer>,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener("abort", abort);
    xhr.open(
      "PUT",
      `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    xhr.withCredentials = true;
    xhr.timeout = 60_000;
    xhr.responseType = "json";
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Untold-Device-Id", deviceId);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError("Untold could not be reached. Check your connection.", 0));
    xhr.onabort = () => reject(new ApiError("File upload was cancelled.", 0));
    xhr.ontimeout = () =>
      reject(new ApiError("File upload timed out. Check your connection and retry.", 0));
    xhr.onload = () => {
      const body = xhr.response as { message?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new ApiError(requestErrorMessage(xhr.status, body?.message), xhr.status));
    };
    xhr.send(ciphertext);
  });
}

export async function discardEncryptedAttachment(
  conversationId: string,
  attachmentId: string,
): Promise<void> {
  await request<{ deleted: boolean }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" },
  );
}

export async function fetchAttachmentDownloadUrl(attachmentId: string): Promise<string> {
  const { url } = await request<{ url: string }>(
    `/api/attachments/${encodeURIComponent(attachmentId)}/download`,
  );
  return url;
}
