import { and, desc, eq } from "drizzle-orm";
import {
  getAuthenticatedUser,
  backendErrorResponse,
  forbiddenOriginResponse,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { publishMessageAvailable } from "@/lib/server/ably";
import { decodeMessageEnvelope } from "@/lib/server/message-envelope";
import { conversationMembers, messageEnvelopes } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ conversationId: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxRequestBytes = 90 * 1024;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { conversationId } = await context.params;
    if (!uuidPattern.test(conversationId)) {
      return Response.json({ message: "Conversation ID is invalid." }, { status: 400 });
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const { db } = getDatabase();
    const membership = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, user.id),
        ),
      )
      .limit(1);

    if (membership.length === 0) {
      return Response.json({ message: "Conversation not found." }, { status: 404 });
    }

    const messages = await db
      .select({
        id: messageEnvelopes.id,
        senderId: messageEnvelopes.senderId,
        clientMessageId: messageEnvelopes.clientMessageId,
        envelope: messageEnvelopes.envelope,
        createdAt: messageEnvelopes.createdAt,
      })
      .from(messageEnvelopes)
      .where(eq(messageEnvelopes.conversationId, conversationId))
      .orderBy(desc(messageEnvelopes.createdAt), desc(messageEnvelopes.id))
      .limit(50);

    return Response.json(
      {
        messages: messages
          .reverse()
          .map(({ envelope, ...message }) => ({ ...message, envelope: envelope.toString("base64") })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { conversationId } = await context.params;
    if (!uuidPattern.test(conversationId)) {
      return Response.json({ message: "Conversation ID is invalid." }, { status: 400 });
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();

    const parsed = await readJsonBody(request, maxRequestBytes);
    if (!parsed.ok) {
      return Response.json(
        {
          message:
            parsed.status === 413 ? "Message envelope is too large." : "Send a valid JSON request.",
        },
        { status: parsed.status },
      );
    }
    const { body } = parsed;
    if (!body || typeof body !== "object") {
      return Response.json({ message: "Send a valid message envelope." }, { status: 400 });
    }

    const input = body as { clientMessageId?: unknown; envelope?: unknown };
    if (typeof input.clientMessageId !== "string" || !uuidPattern.test(input.clientMessageId)) {
      return Response.json({ message: "A valid client message ID is required." }, { status: 400 });
    }

    const decoded = decodeMessageEnvelope(input.envelope);
    if (!decoded.ok) {
      return Response.json(
        { message: decoded.error === "too-large" ? "Message envelope is too large." : "Message envelope is invalid." },
        { status: decoded.error === "too-large" ? 413 : 400 },
      );
    }

    const { db } = getDatabase();
    const membership = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, user.id),
        ),
      )
      .limit(1);
    if (membership.length === 0) {
      return Response.json({ message: "Conversation not found." }, { status: 404 });
    }

    const messageId = crypto.randomUUID();
    const inserted = await db
      .insert(messageEnvelopes)
      .values({
        id: messageId,
        conversationId,
        senderId: user.id,
        clientMessageId: input.clientMessageId,
        envelope: decoded.bytes,
      })
      .onConflictDoNothing({
        target: [messageEnvelopes.senderId, messageEnvelopes.clientMessageId],
      })
      .returning({ id: messageEnvelopes.id, createdAt: messageEnvelopes.createdAt });

    if (inserted.length === 0) {
      const [existing] = await db
        .select({
          id: messageEnvelopes.id,
          conversationId: messageEnvelopes.conversationId,
          createdAt: messageEnvelopes.createdAt,
        })
        .from(messageEnvelopes)
        .where(
          and(
            eq(messageEnvelopes.senderId, user.id),
            eq(messageEnvelopes.clientMessageId, input.clientMessageId),
          ),
        )
        .limit(1);

      if (!existing || existing.conversationId !== conversationId) {
        return Response.json({ message: "This client message ID has already been used." }, { status: 409 });
      }

      let realtimePublished = false;
      try {
        realtimePublished = await publishMessageAvailable(conversationId, existing.id);
      } catch {
        console.error("Untold message notification could not be published");
      }

      return Response.json(
        {
          id: existing.id,
          clientMessageId: input.clientMessageId,
          createdAt: existing.createdAt,
          duplicate: true,
          realtimePublished,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    let realtimePublished = false;
    try {
      realtimePublished = await publishMessageAvailable(conversationId, inserted[0].id);
    } catch {
      console.error("Untold message notification could not be published");
    }

    return Response.json(
      {
        id: inserted[0].id,
        clientMessageId: input.clientMessageId,
        createdAt: inserted[0].createdAt,
        realtimePublished,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
