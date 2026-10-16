import "server-only";

import { Rest, type CapabilityOp } from "ably";
import { BackendConfigurationError } from "@/lib/server/database";

export async function createConversationSubscribeToken(userId: string, conversationIds: string[]) {
  const key = process.env.ABLY_API_KEY?.trim();
  if (!key) throw new BackendConfigurationError(["ABLY_API_KEY"], "realtime");

  const capability: Record<string, CapabilityOp[]> = Object.fromEntries(
    conversationIds.map((id) => [`untold:conversation:${id}`, ["subscribe"] as CapabilityOp[]]),
  );
  const realtime = new Rest({ key });

  return realtime.auth.createTokenRequest({
    clientId: userId,
    capability,
    ttl: 15 * 60 * 1000,
  });
}

export async function publishMessageAvailable(
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  const key = process.env.ABLY_API_KEY?.trim();
  if (!key) return false;

  const realtime = new Rest({ key });
  await realtime.channels
    .get(`untold:conversation:${conversationId}`)
    .publish("message-available", { conversationId, messageId });
  return true;
}

export async function publishReceiptsUpdated(conversationId: string): Promise<boolean> {
  const key = process.env.ABLY_API_KEY?.trim();
  if (!key) return false;
  const realtime = new Rest({ key });
  await realtime.channels
    .get(`untold:conversation:${conversationId}`)
    .publish("receipts-updated", { conversationId });
  return true;
}

export async function publishCallHistoryUpdated(conversationId: string): Promise<boolean> {
  const key = process.env.ABLY_API_KEY?.trim();
  if (!key) return false;
  await new Rest({ key }).channels
    .get(`untold:conversation:${conversationId}`)
    .publish("call-history-updated", { conversationId });
  return true;
}
