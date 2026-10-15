import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  attachmentCiphertextOverhead,
  maxAttachmentBytes,
} from "@/crypto/src/protocol";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedUser,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { isConversationMember } from "@/lib/server/conversations";
import {
  createAttachmentObjectKey,
  getObjectStorage,
  removeEncryptedAttachment,
  storeEncryptedAttachment,
} from "@/lib/server/object-storage";
import { consumeRateLimit, rateLimitedResponse, rateLimitRules } from "@/lib/server/rate-limit";
import { devices, messageAttachments, messageEnvelopes } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ conversationId: string; attachmentId: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxCiphertextBytes = maxAttachmentBytes + attachmentCiphertextOverhead;

async function readCiphertext(
  request: Request,
): Promise<{ bytes: Uint8Array<ArrayBuffer> } | { error: "invalid" | "too-large" }> {
  const declaredSize = request.headers.get("content-length");
  if (declaredSize !== null) {
    const parsedSize = Number(declaredSize);
    if (!Number.isSafeInteger(parsedSize) || parsedSize < attachmentCiphertextOverhead) return { error: "invalid" };
    if (parsedSize > maxCiphertextBytes) return { error: "too-large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { error: "invalid" };
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxCiphertextBytes) {
        await reader.cancel();
        return { error: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "invalid" };
  } finally {
    reader.releaseLock();
  }

  if (totalBytes < attachmentCiphertextOverhead) return { error: "invalid" };
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

function notFoundResponse(): Response {
  return Response.json({ message: "Conversation not found." }, { status: 404 });
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  let objectKey: string | null = null;
  let objectStored = false;
  let ciphertext: Uint8Array<ArrayBuffer> | null = null;
  try {
    const { conversationId, attachmentId } = await context.params;
    if (!uuidPattern.test(conversationId) || !uuidPattern.test(attachmentId)) {
      return Response.json({ message: "Attachment ID is invalid." }, { status: 400 });
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/octet-stream") {
      return Response.json({ message: "Upload encrypted file bytes only." }, { status: 415 });
    }

    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) return notFoundResponse();

    const deviceId = request.headers.get("x-untold-device-id");
    if (!deviceId || !uuidPattern.test(deviceId)) {
      return Response.json({ message: "A registered messaging device is required." }, { status: 400 });
    }
    const [activeDevice] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, user.id), isNull(devices.revokedAt)))
      .limit(1);
    if (!activeDevice) {
      return Response.json({ message: "Register this browser as a messaging device first." }, { status: 409 });
    }

    const storage = getObjectStorage();
    if (!storage) {
      return Response.json({ message: "File sharing is not configured yet." }, { status: 503 });
    }

    const limit = await consumeRateLimit(db, `upload-attachment:${user.id}`, rateLimitRules.uploadAttachment);
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

    const result = await readCiphertext(request);
    if ("error" in result) {
      return Response.json(
        { message: result.error === "too-large" ? "Files must be 20 MiB or smaller." : "Encrypted file upload is invalid." },
        { status: result.error === "too-large" ? 413 : 400 },
      );
    }
    ciphertext = result.bytes;

    const digest = createHash("sha256").update(ciphertext).digest("hex");
    const [existing] = await db
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.id, attachmentId))
      .limit(1);
    if (existing) {
      if (
        existing.conversationId === conversationId &&
        existing.senderId === user.id &&
        existing.ciphertextBytes === ciphertext.byteLength &&
        existing.ciphertextSha256 === digest
      ) {
        return Response.json({ attachmentId }, { headers: { "Cache-Control": "no-store" } });
      }
      return Response.json({ message: "This attachment ID has already been used." }, { status: 409 });
    }

    objectKey = createAttachmentObjectKey(storage);
    objectStored = true;
    await storeEncryptedAttachment(objectKey, ciphertext);
    const inserted = await db
      .insert(messageAttachments)
      .values({
        id: attachmentId,
        conversationId,
        senderId: user.id,
        objectKey,
        ciphertextBytes: ciphertext.byteLength,
        ciphertextSha256: digest,
      })
      .onConflictDoNothing()
      .returning({ id: messageAttachments.id });

    if (inserted.length === 0) {
      const [raced] = await db
        .select()
        .from(messageAttachments)
        .where(eq(messageAttachments.id, attachmentId))
        .limit(1);
      await removeEncryptedAttachment(objectKey);
      objectStored = false;
      if (
        raced?.conversationId === conversationId &&
        raced.senderId === user.id &&
        raced.ciphertextBytes === ciphertext.byteLength &&
        raced.ciphertextSha256 === digest
      ) {
        return Response.json({ attachmentId }, { headers: { "Cache-Control": "no-store" } });
      }
      return Response.json({ message: "This attachment ID has already been used." }, { status: 409 });
    }

    return Response.json({ attachmentId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (objectStored && objectKey) {
      try {
        await removeEncryptedAttachment(objectKey);
      } catch {
        // The stored object is still encrypted; an orphan can be removed from Portways storage.
      }
    }
    return backendErrorResponse(error);
  } finally {
    ciphertext?.fill(0);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { conversationId, attachmentId } = await context.params;
    if (!uuidPattern.test(conversationId) || !uuidPattern.test(attachmentId)) {
      return Response.json({ message: "Attachment ID is invalid." }, { status: 400 });
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();

    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) return notFoundResponse();
    const [attachment] = await db
      .select({ id: messageAttachments.id, objectKey: messageAttachments.objectKey })
      .from(messageAttachments)
      .where(and(
        eq(messageAttachments.id, attachmentId),
        eq(messageAttachments.conversationId, conversationId),
        eq(messageAttachments.senderId, user.id),
      ))
      .limit(1);
    if (!attachment) {
      return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
    }

    const [linkedMessage] = await db
      .select({ id: messageEnvelopes.id })
      .from(messageEnvelopes)
      .where(eq(messageEnvelopes.attachmentId, attachmentId))
      .limit(1);
    if (linkedMessage) {
      return Response.json({ message: "A sent attachment cannot be discarded." }, { status: 409 });
    }

    await removeEncryptedAttachment(attachment.objectKey);
    await db.delete(messageAttachments).where(eq(messageAttachments.id, attachmentId));
    return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
