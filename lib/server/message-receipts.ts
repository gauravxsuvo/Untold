import "server-only";

import { and, inArray } from "drizzle-orm";
import type { getDatabase } from "@/lib/server/database";
import { messageRecipients, messageReceipts } from "@/lib/server/schema";

type Database = ReturnType<typeof getDatabase>["db"];

export async function outgoingMessageReceipts(
  db: Database,
  _conversationId: string,
  _senderId: string,
  messageIds: string[],
): Promise<Map<string, { receivedAt: string | null; readAt: string | null }>> {
  const result = new Map<string, { receivedAt: string | null; readAt: string | null }>();
  if (messageIds.length === 0) return result;
  const recipients = await db
    .select({ userId: messageRecipients.userId, messageId: messageRecipients.messageId })
    .from(messageRecipients)
    .where(inArray(messageRecipients.messageId, messageIds));
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
    const expected = recipients.filter((recipient) => recipient.messageId === id);
    const rows = receipts.filter(
      (row) =>
        row.messageId === id && expected.some((recipient) => recipient.userId === row.userId),
    );
    const allReceived =
      expected.length > 0 &&
      expected.every((recipient) => rows.some((row) => row.userId === recipient.userId));
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
