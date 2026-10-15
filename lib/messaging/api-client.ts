import type { ConversationMessage, ConversationSummary } from "@/lib/messaging/people";
import type { PublicDevice } from "@/crypto/src/protocol";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type AccountDevice = {
  deviceId: string;
  deviceName: string;
  agreementKey: string;
  signingKey: string;
  createdAt: string;
  revokedAt: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError("Untold could not be reached. Check your connection.", 0);
  }

  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) {
    throw new ApiError(body?.message ?? "Something went wrong. Please try again.", response.status);
  }
  return body as T;
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const { conversations } = await request<{ conversations: ConversationSummary[] }>(
    "/api/conversations",
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
}): Promise<void> {
  await request<{ device: unknown }>("/api/devices", {
    method: "POST",
    body: JSON.stringify(device),
  });
}

export async function fetchAccountDevices(): Promise<AccountDevice[]> {
  const { devices } = await request<{ devices: AccountDevice[] }>("/api/devices");
  return devices;
}

export async function revokeAccountDevice(deviceId: string): Promise<void> {
  await request<{ revoked: boolean }>(`/api/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
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
    if (signal?.aborted) { reject(signal.reason); return; }
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
    xhr.onerror = () => reject(new ApiError("Untold could not be reached. Check your connection.", 0));
    xhr.onabort = () => reject(new ApiError("File upload was cancelled.", 0));
    xhr.ontimeout = () => reject(new ApiError("File upload timed out. Check your connection and retry.", 0));
    xhr.onload = () => {
      const body = xhr.response as { message?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new ApiError(body?.message ?? "The encrypted file could not be uploaded.", xhr.status));
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
