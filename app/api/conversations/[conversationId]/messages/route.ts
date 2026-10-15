import { createHash } from "node:crypto";
import { after } from "next/server";
import { pushOutbox } from "@/lib/server/schema";
import { deliverPushOutbox } from "@/lib/server/push";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  getAuthenticatedUser,
  backendErrorResponse,
  forbiddenOriginResponse,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { accountDeviceDirectory } from "@/lib/server/device-trust";
import { publishMessageAvailable } from "@/lib/server/ably";
import { isConversationMember } from "@/lib/server/conversations";
import { decodeMessageEnvelope } from "@/lib/server/message-envelope";
import { consumeRateLimit, rateLimitedResponse, rateLimitRules } from "@/lib/server/rate-limit";
import {
  conversationMembers,
  authUser,
  devices,
  messageAttachments,
  messageEnvelopes,
} from "@/lib/server/schema";
import { parseE2eeEnvelope } from "@/lib/server/e2ee-envelope";
import { outgoingMessageReceipts } from "@/lib/server/message-receipts";

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
      return Response.json(
        { message: "We couldn’t find that conversation. Refresh the page and try again." },
        { status: 400 },
      );
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) return notFoundResponse();

    const knownParam = new URL(request.url).searchParams.get("known");
    const knownIds = knownParam ? knownParam.split(",") : [];
    if (
      (knownParam?.length ?? 0) > 4000 ||
      knownIds.length > 100 ||
      knownIds.some((id) => !uuidPattern.test(id))
    ) {
      return Response.json(
        { message: "We couldn’t refresh this conversation. Please try again." },
        { status: 400 },
      );
    }
    const known = new Set(knownIds.map((id) => id.toLowerCase()));
    // Metadata and receipt reads do not load the larger encrypted message bodies.
    const messages = await db
      .select({
        id: messageEnvelopes.id,
        senderId: messageEnvelopes.senderId,
        clientMessageId: messageEnvelopes.clientMessageId,
        attachmentId: messageEnvelopes.attachmentId,
        createdAt: messageEnvelopes.createdAt,
      })
      .from(messageEnvelopes)
      .where(eq(messageEnvelopes.conversationId, conversationId))
      .orderBy(desc(messageEnvelopes.createdAt), desc(messageEnvelopes.id))
      .limit(100);

    const receipts = await outgoingMessageReceipts(
      db,
      conversationId,
      user.id,
      messages.filter(({ senderId }) => senderId === user.id).map(({ id }) => id),
    );
    const metadata = messages.reverse().map(({ createdAt, ...message }) => ({
      ...message,
      createdAt: createdAt.toISOString(),
      ...(receipts.get(message.id) ?? {}),
    }));
    const etag = `"${createHash("sha256")
      .update(JSON.stringify([user.id, conversationId, metadata]))
      .digest("base64url")}"`;
    const headers = { "Cache-Control": "no-store", Vary: "Cookie", ETag: etag };
    if (
      request.headers.get("if-none-match") === etag &&
      metadata.every(({ id }) => known.has(id))
    ) {
      return new Response(null, { status: 304, headers });
    }
    const missingIds = metadata.filter(({ id }) => !known.has(id)).map(({ id }) => id);
    const missing = missingIds.length
      ? await db
          .select({ id: messageEnvelopes.id, envelope: messageEnvelopes.envelope })
          .from(messageEnvelopes)
          .where(
            and(
              eq(messageEnvelopes.conversationId, conversationId),
              inArray(messageEnvelopes.id, missingIds),
            ),
          )
      : [];
    const bodies = new Map(missing.map(({ id, envelope }) => [id, envelope]));

    return Response.json(
      {
        messages: metadata.flatMap((message) => {
          if (known.has(message.id)) return [message];
          const envelope = bodies.get(message.id);
          return envelope && parseE2eeEnvelope(envelope)
            ? [{ ...message, envelope: Buffer.from(envelope).toString("base64") }]
            : [];
        }),
      },
      { headers },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { conversationId } = await context.params;
    if (!uuidPattern.test(conversationId)) {
      return Response.json(
        { message: "We couldn’t find that conversation. Refresh the page and try again." },
        { status: 400 },
      );
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();

    const parsed = await readJsonBody(request, maxRequestBytes);
    if (!parsed.ok) {
      return Response.json(
        {
          message:
            parsed.status === 413
              ? "This message is too large. Try a shorter message."
              : "We couldn’t complete that action. Refresh the page and try again.",
        },
        { status: parsed.status },
      );
    }
    const { body } = parsed;
    if (!body || typeof body !== "object") {
      return Response.json(
        { message: "We couldn’t send that message. Refresh the conversation and try again." },
        { status: 400 },
      );
    }

    const input = body as { clientMessageId?: unknown; envelope?: unknown; attachmentId?: unknown };
    if (typeof input.clientMessageId !== "string" || !uuidPattern.test(input.clientMessageId)) {
      return Response.json(
        { message: "We couldn’t send that message. Refresh the conversation and try again." },
        { status: 400 },
      );
    }
    if (
      input.attachmentId !== undefined &&
      input.attachmentId !== null &&
      (typeof input.attachmentId !== "string" || !uuidPattern.test(input.attachmentId))
    ) {
      return Response.json(
        { message: "We couldn’t find that file. Refresh the conversation and try again." },
        { status: 400 },
      );
    }
    const attachmentId = typeof input.attachmentId === "string" ? input.attachmentId : null;

    const decoded = decodeMessageEnvelope(input.envelope);
    if (!decoded.ok) {
      return Response.json(
        {
          message:
            decoded.error === "too-large"
              ? "This message is too large. Try a shorter message."
              : "We couldn’t send that message. Refresh the conversation and try again.",
        },
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
      return Response.json(
        {
          message: "We couldn’t send that message safely. Refresh the conversation and try again.",
        },
        { status: 400 },
      );
    }

    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) return notFoundResponse();

    const members = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId));
    const directory = await accountDeviceDirectory(members.map((member) => member.userId));
    const expectedDeviceIds = new Set(
      directory
        .filter((device) => !device.revoked && device.approved)
        .map((device) => device.deviceId),
    );
    const wrappedDeviceIds = new Set(envelope.wrappedKeys.map(({ deviceId }) => deviceId));
    if (
      expectedDeviceIds.size === 0 ||
      wrappedDeviceIds.size !== envelope.wrappedKeys.length ||
      wrappedDeviceIds.size !== expectedDeviceIds.size ||
      [...expectedDeviceIds].some((deviceId) => !wrappedDeviceIds.has(deviceId))
    ) {
      return Response.json(
        { message: "Someone’s approved devices changed. Refresh the conversation and try again." },
        { status: 409 },
      );
    }

    const [senderDevice] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(
        and(
          eq(devices.id, envelope.senderDeviceId),
          eq(devices.userId, user.id),
          isNull(devices.revokedAt),
        ),
      )
      .limit(1);
    if (!senderDevice) {
      return Response.json(
        {
          message: "This browser isn’t ready to send messages yet. Refresh the page and try again.",
        },
        { status: 409 },
      );
    }

    const limit = await consumeRateLimit(db, `send-message:${user.id}`, rateLimitRules.sendMessage);
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

    const clientMessageId = input.clientMessageId;
    const inserted = await db.transaction(async (tx) => {
      await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(
          inArray(
            authUser.id,
            members.map((member) => member.userId),
          ),
        )
        .orderBy(authUser.id)
        .for("no key update");
      const currentDirectory = await accountDeviceDirectory(
        members.map((member) => member.userId),
        tx,
      );
      const currentIds = new Set(
        currentDirectory
          .filter((device) => !device.revoked && device.approved)
          .map((device) => device.deviceId),
      );
      if (
        currentIds.size !== wrappedDeviceIds.size ||
        [...currentIds].some((id) => !wrappedDeviceIds.has(id)) ||
        !currentIds.has(envelope.senderDeviceId)
      )
        return "devices-changed" as const;
      if (attachmentId) {
        const [attachment] = await tx
          .select({ id: messageAttachments.id })
          .from(messageAttachments)
          .where(
            and(
              eq(messageAttachments.id, attachmentId),
              eq(messageAttachments.conversationId, conversationId),
              eq(messageAttachments.senderId, user.id),
            ),
          )
          .limit(1)
          .for("update");
        if (!attachment) return null;
      }
      const created = await tx
        .insert(messageEnvelopes)
        .values({
          id: crypto.randomUUID(),
          conversationId,
          senderId: user.id,
          clientMessageId,
          attachmentId,
          envelope: decoded.bytes,
        })
        .onConflictDoNothing()
        .returning({ id: messageEnvelopes.id, createdAt: messageEnvelopes.createdAt });
      if (created.length)
        await tx.insert(pushOutbox).values({ messageId: created[0].id }).onConflictDoNothing();
      return created;
    });

    if (inserted === "devices-changed")
      return Response.json(
        { message: "Someone’s approved devices changed. Refresh the conversation and try again." },
        { status: 409 },
      );
    if (inserted === null) {
      return Response.json(
        { message: "The file hasn’t finished uploading. Please try again." },
        { status: 409 },
      );
    }

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
        existing.attachmentId !== attachmentId ||
        !Buffer.from(existing.envelope).equals(decoded.bytes)
      ) {
        return Response.json(
          {
            message:
              "This message couldn’t be sent again. Refresh the conversation to check whether it arrived.",
          },
          { status: 409 },
        );
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

    after(async () => {
      try {
        await deliverPushOutbox();
      } catch {
        console.error("Untold notification delivery will retry");
      }
    });
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
