import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import type { getDatabase } from "@/lib/server/database";
import { conversationMembers, messageReceipts } from "@/lib/server/schema";

type Database = ReturnType<typeof getDatabase>["db"];

export async function outgoingMessageReceipts(
  db: Database,
  conversationId: string,
  senderId: string,
  messageIds: string[],
): Promise<Map<string, { receivedAt: string | null; readAt: string | null }>> {
  const result = new Map<string, { receivedAt: string | null; readAt: string | null }>();
  if (messageIds.length === 0) return result;
  const recipients = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        ne(conversationMembers.userId, senderId),
      ),
    );
  if (recipients.length === 0) return result;
  const receipts = await db
    .select()
    .from(messageReceipts)
    .where(
      and(
        inArray(messageReceipts.messageId, messageIds),
        inArray(
          messageReceipts.userId,
          recipients.map(({ userId }) => userId),
        ),
      ),
    );
  for (const id of messageIds) {
    const rows = receipts.filter((row) => row.messageId === id);
    const allReceived = rows.length === recipients.length;
    const allRead = allReceived && rows.every((row) => row.readAt !== null);
    result.set(id, {
      receivedAt: allReceived
        ? new Date(Math.max(...rows.map((row) => row.receivedAt.getTime()))).toISOString()
        : null,
      readAt: allRead
        ? new Date(Math.max(...rows.map((row) => row.readAt?.getTime() ?? 0))).toISOString()
        : null,
    });
  }
  return result;
}
