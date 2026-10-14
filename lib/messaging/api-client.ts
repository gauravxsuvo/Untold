import type { ConversationMessage, ConversationSummary } from "@/lib/messaging/people";
import { encodeTextEnvelope } from "@/lib/messaging/text-envelope";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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

export async function fetchMessages(conversationId: string): Promise<ConversationMessage[]> {
  const { messages } = await request<{ messages: ConversationMessage[] }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  return messages;
}

export async function sendMessage(
  conversationId: string,
  text: string,
  clientMessageId: string,
): Promise<ConversationMessage> {
  const { message } = await request<{ message: ConversationMessage }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ clientMessageId, envelope: encodeTextEnvelope(text) }),
    },
  );
  return message;
}
