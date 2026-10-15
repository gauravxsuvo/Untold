import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDatabase } from "@/lib/server/database";
import { conversationMembers, messageEnvelopes, messageReceipts } from "@/lib/server/schema";
import { publishReceiptsUpdated } from "@/lib/server/ably";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedUser,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    const { db } = getDatabase();
    const limit = await consumeRateLimit(db, `delivery-read:${user.id}`, {
      max: 120,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    const messages = await db
      .select({
        id: messageEnvelopes.id,
        conversationId: messageEnvelopes.conversationId,
        envelope: messageEnvelopes.envelope,
      })
      .from(conversationMembers)
      .innerJoin(
        messageEnvelopes,
        eq(messageEnvelopes.conversationId, conversationMembers.conversationId),
      )
      .leftJoin(
        messageReceipts,
        and(
          eq(messageReceipts.messageId, messageEnvelopes.id),
          eq(messageReceipts.userId, user.id),
        ),
      )
      .where(
        and(
          eq(conversationMembers.userId, user.id),
          ne(messageEnvelopes.senderId, user.id),
          isNull(messageReceipts.messageId),
        ),
      )
      .orderBy(asc(messageEnvelopes.createdAt), asc(messageEnvelopes.id))
      .limit(100);
    return Response.json(
      {
        viewerId: user.id,
        messages: messages.map((message) => ({
          ...message,
          envelope: Buffer.from(message.envelope).toString("base64"),
        })),
      },
      { headers: { "Cache-Control": "no-store", Vary: "Cookie" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    const parsed = await readJsonBody(request, 8192);
    if (!parsed.ok)
      return Response.json({ message: "We couldn’t confirm delivery." }, { status: parsed.status });
    const body = parsed.body as { messageIds?: unknown; viewerId?: unknown } | null;
    if (
      !body ||
      body.viewerId !== user.id ||
      !Array.isArray(body.messageIds) ||
      body.messageIds.length < 1 ||
      body.messageIds.length > 100 ||
      body.messageIds.some((id) => typeof id !== "string" || !uuid.test(id))
    )
      return Response.json({ message: "We couldn’t confirm delivery." }, { status: 400 });
    const ids = [...new Set(body.messageIds as string[])];
    const { db } = getDatabase();
    const limit = await consumeRateLimit(db, `delivery-write:${user.id}`, {
      max: 120,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    const incoming = await db
      .select({ id: messageEnvelopes.id, conversationId: messageEnvelopes.conversationId })
      .from(messageEnvelopes)
      .innerJoin(
        conversationMembers,
        eq(conversationMembers.conversationId, messageEnvelopes.conversationId),
      )
      .where(
        and(
          eq(conversationMembers.userId, user.id),
          ne(messageEnvelopes.senderId, user.id),
          inArray(messageEnvelopes.id, ids),
        ),
      );
    if (incoming.length !== ids.length)
      return Response.json({ message: "We couldn’t confirm delivery." }, { status: 400 });
    const changed = await db
      .insert(messageReceipts)
      .values(ids.map((messageId) => ({ messageId, userId: user.id })))
      .onConflictDoNothing()
      .returning({ id: messageReceipts.messageId });
    const changedIds = new Set(changed.map(({ id }) => id));
    const conversations = [
      ...new Set(
        incoming.filter(({ id }) => changedIds.has(id)).map(({ conversationId }) => conversationId),
      ),
    ];
    await Promise.allSettled(conversations.map((id) => publishReceiptsUpdated(id)));
    return Response.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
