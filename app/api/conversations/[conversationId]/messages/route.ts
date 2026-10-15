import { and, desc, eq, isNull } from "drizzle-orm";
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
import { isConversationMember } from "@/lib/server/conversations";
import { decodeMessageEnvelope } from "@/lib/server/message-envelope";
import { consumeRateLimit, rateLimitedResponse, rateLimitRules } from "@/lib/server/rate-limit";
import { conversationMembers, devices, messageAttachments, messageEnvelopes } from "@/lib/server/schema";
import { parseE2eeEnvelope } from "@/lib/server/e2ee-envelope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ conversationId: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxRequestBytes = 90 * 1024;

function notFoundResponse(): Response {
  return Response.json({ message: "Conversation not found." }, { status: 404 });
}

async function notifyMessageAvailable(conversationId: string, messageId: string) {
  try {
    return await publishMessageAvailable(conversationId, messageId);
  } catch {
    console.error("Untold message notification could not be published");
    return false;
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { conversationId } = await context.params;
    if (!uuidPattern.test(conversationId)) {
      return Response.json({ message: "Conversation ID is invalid." }, { status: 400 });
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) return notFoundResponse();

    const messages = await db
      .select({
        id: messageEnvelopes.id,
        senderId: messageEnvelopes.senderId,
        clientMessageId: messageEnvelopes.clientMessageId,
        attachmentId: messageEnvelopes.attachmentId,
        envelope: messageEnvelopes.envelope,
        createdAt: messageEnvelopes.createdAt,
      })
      .from(messageEnvelopes)
      .where(eq(messageEnvelopes.conversationId, conversationId))
      .orderBy(desc(messageEnvelopes.createdAt), desc(messageEnvelopes.id))
      .limit(100);

    const encryptedMessages = messages.filter(({ envelope }) => parseE2eeEnvelope(envelope) !== null);

    return Response.json(
      {
        messages: encryptedMessages.reverse().map(({ envelope, createdAt, ...message }) => ({
          ...message,
          envelope: Buffer.from(envelope).toString("base64"),
          createdAt: createdAt.toISOString(),
        })),
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

    const input = body as { clientMessageId?: unknown; envelope?: unknown; attachmentId?: unknown };
    if (typeof input.clientMessageId !== "string" || !uuidPattern.test(input.clientMessageId)) {
      return Response.json({ message: "A valid client message ID is required." }, { status: 400 });
    }
    if (
      input.attachmentId !== undefined &&
      input.attachmentId !== null &&
      (typeof input.attachmentId !== "string" || !uuidPattern.test(input.attachmentId))
    ) {
      return Response.json({ message: "Attachment ID is invalid." }, { status: 400 });
    }
    const attachmentId = typeof input.attachmentId === "string" ? input.attachmentId : null;

    const decoded = decodeMessageEnvelope(input.envelope);
    if (!decoded.ok) {
      return Response.json(
        { message: decoded.error === "too-large" ? "Message envelope is too large." : "Message envelope is invalid." },
        { status: decoded.error === "too-large" ? 413 : 400 },
      );
    }
    const envelope = parseE2eeEnvelope(decoded.bytes);
    if (
      !envelope ||
      envelope.conversationId !== conversationId ||
      envelope.messageId !== input.clientMessageId ||
      envelope.senderId !== user.id ||
      !envelope.wrappedKeys.some(({ deviceId }) => deviceId === envelope.senderDeviceId)
    ) {
      return Response.json({ message: "Send a valid Untold encrypted message." }, { status: 400 });
    }

    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) return notFoundResponse();
    if (attachmentId) {
      const [attachment] = await db
        .select({ id: messageAttachments.id })
        .from(messageAttachments)
        .where(and(
          eq(messageAttachments.id, attachmentId),
          eq(messageAttachments.conversationId, conversationId),
          eq(messageAttachments.senderId, user.id),
        ))
        .limit(1);
      if (!attachment) {
        return Response.json({ message: "Upload the encrypted attachment before sending its message." }, { status: 409 });
      }
    }

    const conversationDevices = await db
      .select({ id: devices.id })
      .from(conversationMembers)
      .innerJoin(devices, eq(devices.userId, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, conversationId), isNull(devices.revokedAt)));
    const expectedDeviceIds = new Set(conversationDevices.map(({ id }) => id));
    const wrappedDeviceIds = new Set(envelope.wrappedKeys.map(({ deviceId }) => deviceId));
    if (
      expectedDeviceIds.size === 0 ||
      wrappedDeviceIds.size !== envelope.wrappedKeys.length ||
      wrappedDeviceIds.size !== expectedDeviceIds.size ||
      [...expectedDeviceIds].some((deviceId) => !wrappedDeviceIds.has(deviceId))
    ) {
      return Response.json(
        { message: "The conversation device list changed. Reload the conversation and try again." },
        { status: 409 },
      );
    }

    const [senderDevice] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(
        eq(devices.id, envelope.senderDeviceId),
        eq(devices.userId, user.id),
        isNull(devices.revokedAt),
      ))
      .limit(1);
    if (!senderDevice) {
      return Response.json({ message: "Register this browser as a messaging device first." }, { status: 409 });
    }

    const limit = await consumeRateLimit(db, `send-message:${user.id}`, rateLimitRules.sendMessage);
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

    const inserted = await db
      .insert(messageEnvelopes)
      .values({
        id: crypto.randomUUID(),
        conversationId,
        senderId: user.id,
        clientMessageId: input.clientMessageId,
        attachmentId,
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
          attachmentId: messageEnvelopes.attachmentId,
          envelope: messageEnvelopes.envelope,
        })
        .from(messageEnvelopes)
        .where(
          and(
            eq(messageEnvelopes.senderId, user.id),
            eq(messageEnvelopes.clientMessageId, input.clientMessageId),
          ),
        )
        .limit(1);

      if (
        !existing ||
        existing.conversationId !== conversationId ||
        existing.attachmentId !== attachmentId
      ) {
        return Response.json({ message: "This client message ID has already been used." }, { status: 409 });
      }

      return Response.json(
        {
          message: {
            id: existing.id,
            senderId: user.id,
            clientMessageId: input.clientMessageId,
            attachmentId: existing.attachmentId,
            envelope: Buffer.from(existing.envelope).toString("base64"),
            createdAt: existing.createdAt.toISOString(),
          },
          duplicate: true,
          realtimePublished: await notifyMessageAvailable(conversationId, existing.id),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      {
        message: {
          id: inserted[0].id,
          senderId: user.id,
          clientMessageId: input.clientMessageId,
          attachmentId,
          envelope: Buffer.from(decoded.bytes).toString("base64"),
          createdAt: inserted[0].createdAt.toISOString(),
        },
        realtimePublished: await notifyMessageAvailable(conversationId, inserted[0].id),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
