import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/server/database";
import { isConversationMember, messageAudience } from "@/lib/server/conversations";
import { publishReceiptsUpdated } from "@/lib/server/ably";
import { messageEnvelopes, messageReceipts } from "@/lib/server/schema";
import { consumeRateLimit, rateLimitedResponse, rateLimitRules } from "@/lib/server/rate-limit";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedUser,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RouteContext = { params: Promise<{ conversationId: string }> };

function messageIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((id) => typeof id === "string" && uuidPattern.test(id))
  );
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const { conversationId } = await context.params;
    if (!uuidPattern.test(conversationId))
      return Response.json({ message: "Conversation not found." }, { status: 404 });
    const parsed = await readJsonBody(request, 16 * 1024);
    if (!parsed.ok)
      return Response.json(
        { message: "We couldn’t update the message status." },
        { status: parsed.status },
      );
    const body = parsed.body as { receivedIds?: unknown; readIds?: unknown } | null;
    if (!body || !messageIds(body.receivedIds) || !messageIds(body.readIds)) {
      return Response.json({ message: "We couldn’t update the message status." }, { status: 400 });
    }
    const ids = [...new Set([...body.receivedIds, ...body.readIds])];
    if (ids.length === 0 || ids.length > 100)
      return Response.json({ message: "We couldn’t update the message status." }, { status: 400 });
    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) {
      return Response.json({ message: "Conversation not found." }, { status: 404 });
    }
    const limit = await consumeRateLimit(
      db,
      `message-receipts:${user.id}`,
      rateLimitRules.messageReceipts,
    );
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

    // A user can acknowledge only incoming messages in a conversation they belong to.
    const incoming = await db
      .select({ id: messageEnvelopes.id })
      .from(messageEnvelopes)
      .where(
        and(
          eq(messageEnvelopes.conversationId, conversationId),
          ne(messageEnvelopes.senderId, user.id),
          messageAudience(db, user.id),
          inArray(messageEnvelopes.id, ids),
        ),
      );
    if (incoming.length !== ids.length)
      return Response.json({ message: "We couldn’t update the message status." }, { status: 400 });
    const readIds = new Set(body.readIds);
    // Use the database clock for both values. Retries can only move status forward.
    const changed = await db
      .insert(messageReceipts)
      .values(
        ids.map((id) => ({
          messageId: id,
          userId: user.id,
          readAt: readIds.has(id) ? sql`CURRENT_TIMESTAMP` : null,
        })),
      )
      .onConflictDoUpdate({
        target: [messageReceipts.messageId, messageReceipts.userId],
        set: {
          readAt: sql`coalesce(${messageReceipts.readAt}, greatest(${messageReceipts.receivedAt}, excluded.read_at))`,
        },
        setWhere: sql`${messageReceipts.readAt} IS NULL AND excluded.read_at IS NOT NULL`,
      })
      .returning({ messageId: messageReceipts.messageId });

    if (changed.length > 0) {
      try {
        await publishReceiptsUpdated(conversationId);
      } catch {
        console.error("Untold message status notification could not be published");
      }
    }
    return Response.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
