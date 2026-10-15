import "server-only";

import { and, eq, exists, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { getDatabase } from "@/lib/server/database";
import {
  conversationMembers,
  conversations,
  authUser,
  messageEnvelopes,
  profilePhotos,
} from "@/lib/server/schema";
import { profilePhotoUrl } from "@/lib/profile/photos";
import type { ConversationSummary, Person } from "@/lib/messaging/people";

type Database = ReturnType<typeof getDatabase>["db"];

export async function isConversationMember(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function findUserByEmail(db: Database, email: string): Promise<Person | null> {
  const [user] = await db
    .select({ id: authUser.id, name: authUser.name, email: authUser.email })
    .from(authUser)
    .where(sql`lower(${authUser.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return user ?? null;
}

export function directConversationKey(firstUserId: string, secondUserId: string): string {
  return [firstUserId, secondUserId].sort().join(":");
}

export async function startDirectConversation(
  db: Database,
  userId: string,
  otherUserId: string,
): Promise<string> {
  const directKey = directConversationKey(userId, otherUserId);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(conversations)
      .values({ id: crypto.randomUUID(), createdBy: userId, directKey })
      .onConflictDoNothing({ target: conversations.directKey })
      .returning({ id: conversations.id });

    const conversationId =
      created?.id ??
      (
        await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.directKey, directKey))
          .limit(1)
      )[0]?.id;
    if (!conversationId) throw new Error("Direct conversation could not be created.");

    await tx
      .insert(conversationMembers)
      .values([
        { conversationId, userId },
        { conversationId, userId: otherUserId },
      ])
      .onConflictDoNothing();

    // Starting an existing chat is an explicit action by this person too.
    // Do not change the other member's visibility or create a duplicate chat.
    await tx
      .update(conversationMembers)
      .set({ initiatedAt: sql`coalesce(${conversationMembers.initiatedAt}, now())` })
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, userId),
        ),
      );

    return conversationId;
  });
}

type LastMessageRow = {
  conversation_id: string;
  sender_id: string;
  created_at: Date | string;
  attachment_id: string | null;
};

function toIsoString(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export async function listConversationsForUser(
  db: Database,
  userId: string,
  conversationIds?: string[],
): Promise<ConversationSummary[]> {
  const memberships = await db
    .select({ id: conversations.id, createdAt: conversations.createdAt })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.userId, userId),
        or(
          eq(conversations.createdBy, userId),
          isNotNull(conversationMembers.initiatedAt),
          exists(
            db
              .select({ id: messageEnvelopes.id })
              .from(messageEnvelopes)
              .where(eq(messageEnvelopes.conversationId, conversations.id)),
          ),
        ),
        conversationIds ? inArray(conversationMembers.conversationId, conversationIds) : undefined,
      ),
    );
  if (memberships.length === 0) return [];

  const ids = memberships.map(({ id }) => id);
  const members = await db
    .select({
      conversationId: conversationMembers.conversationId,
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      photoVersion: profilePhotos.version,
    })
    .from(conversationMembers)
    .innerJoin(authUser, eq(authUser.id, conversationMembers.userId))
    .leftJoin(profilePhotos, eq(profilePhotos.userId, authUser.id))
    .where(inArray(conversationMembers.conversationId, ids));

  const lastMessages = await db.execute<LastMessageRow>(sql`
    SELECT c.id AS conversation_id, latest.sender_id, latest.created_at, latest.attachment_id
    FROM untold_app.conversation AS c
    JOIN LATERAL (
      SELECT m.sender_id, m.created_at, m.attachment_id
      FROM untold_app.message_envelope AS m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) AS latest ON true
    WHERE c.id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);
  const lastByConversation = new Map(
    lastMessages.rows.map((row) => [row.conversation_id, row] as const),
  );

  return memberships
    .map(({ id, createdAt }) => {
      const last = lastByConversation.get(id);
      return {
        id,
        createdAt: createdAt.toISOString(),
        members: members
          .filter((member) => member.conversationId === id)
          .map(({ id: memberId, name, email, photoVersion }) => ({
            id: memberId,
            name,
            email,
            image: photoVersion ? profilePhotoUrl(memberId, photoVersion) : null,
          })),
        lastMessage: last
          ? {
              text: null,
              senderId: last.sender_id,
              createdAt: toIsoString(last.created_at),
              hasAttachment: last.attachment_id !== null,
            }
          : null,
      };
    })
    .sort(
      (first, second) =>
        Date.parse(second.lastMessage?.createdAt ?? second.createdAt) -
        Date.parse(first.lastMessage?.createdAt ?? first.createdAt),
    );
}
