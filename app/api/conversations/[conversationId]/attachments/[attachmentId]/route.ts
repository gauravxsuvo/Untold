import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  acquireAttachmentUpload,
  maxAccountAttachmentBytes,
  readAttachmentUpload,
} from "@/lib/server/attachment-upload";
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

function notFoundResponse(): Response {
  return Response.json({ message: "Conversation not found." }, { status: 404 });
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  let objectKey: string | null = null;
  let objectStored = false;
  let objectCommitted = false;
  let databaseWriteStarted = false;
  let releaseUpload: (() => void) | null = null;
  let ciphertext: Uint8Array<ArrayBuffer> | null = null;
  try {
    const { conversationId, attachmentId } = await context.params;
    if (!uuidPattern.test(conversationId) || !uuidPattern.test(attachmentId)) {
      return Response.json({ message: "We couldn’t find that file. Refresh the conversation and try again." }, { status: 400 });
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    if (
      request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/octet-stream"
    ) {
      return Response.json({ message: "We couldn’t upload that file safely. Please try again." }, { status: 415 });
    }

    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) return notFoundResponse();

    const deviceId = request.headers.get("x-untold-device-id");
    if (!deviceId || !uuidPattern.test(deviceId)) {
      return Response.json(
        { message: "This browser isn’t ready to share files yet. Refresh the page and try again." },
        { status: 400 },
      );
    }
    const [activeDevice] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, user.id), isNull(devices.revokedAt)))
      .limit(1);
    if (!activeDevice) {
      return Response.json(
        { message: "This browser isn’t ready to send messages yet. Refresh the page and try again." },
        { status: 409 },
      );
    }

    const storage = getObjectStorage();
    if (!storage) {
      return Response.json({ message: "File sharing isn’t available right now. Please try again in a moment." }, { status: 503 });
    }

    const limit = await consumeRateLimit(
      db,
      `upload-attachment:${user.id}`,
      rateLimitRules.uploadAttachment,
    );
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

    releaseUpload = acquireAttachmentUpload(user.id);
    if (!releaseUpload) return rateLimitedResponse(3);
    try {
      ciphertext = await readAttachmentUpload(request);
    } catch (error) {
      return Response.json(
        {
          message:
            error instanceof RangeError
              ? "Files must be 20 MiB or smaller."
              : "The file upload didn’t finish. Check your connection and try again.",
        },
        { status: error instanceof RangeError ? 413 : 400 },
      );
    }

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
      return Response.json(
        { message: "This upload couldn’t be completed. Select the file again to retry." },
        { status: 409 },
      );
    }

    objectKey = createAttachmentObjectKey(storage);
    objectStored = true;
    await storeEncryptedAttachment(objectKey, ciphertext);
    const storedBytes = ciphertext.byteLength;
    const key = objectKey;
    databaseWriteStarted = true;
    const inserted = await db.transaction(async (tx) => {
      // Serialize quota checks for this sender across concurrent requests and replicas.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attachment-quota:${user.id}`}, 0))`,
      );
      const [usage] = await tx
        .select({ bytes: sql<string>`coalesce(sum(${messageAttachments.ciphertextBytes}), 0)` })
        .from(messageAttachments)
        .where(eq(messageAttachments.senderId, user.id));
      if (Number(usage.bytes) + storedBytes > maxAccountAttachmentBytes) return null;
      return tx
        .insert(messageAttachments)
        .values({
          id: attachmentId,
          conversationId,
          senderId: user.id,
          objectKey: key,
          ciphertextBytes: storedBytes,
          ciphertextSha256: digest,
        })
        .onConflictDoNothing()
        .returning({ id: messageAttachments.id });
    });

    if (inserted === null) {
      await removeEncryptedAttachment(objectKey);
      objectStored = false;
      return Response.json(
        {
          code: "attachment_quota",
          message: "Your account has reached its 1 GB file storage limit.",
        },
        { status: 413 },
      );
    }

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
      return Response.json(
        { message: "This upload couldn’t be completed. Select the file again to retry." },
        { status: 409 },
      );
    }

    objectCommitted = true;
    return Response.json(
      { attachmentId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (objectStored && !objectCommitted && objectKey && !databaseWriteStarted) {
      try {
        await removeEncryptedAttachment(objectKey);
      } catch {
        // The stored object is still encrypted; an orphan can be removed from Portways storage.
      }
    } else if (objectStored && !objectCommitted && databaseWriteStarted) {
      // A lost COMMIT acknowledgement does not prove rollback. Preserve the object
      // for reconciliation instead of potentially deleting a committed message's file.
      console.error("Untold encrypted attachment needs database/storage reconciliation");
    }
    return backendErrorResponse(error);
  } finally {
    ciphertext?.fill(0);
    releaseUpload?.();
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { conversationId, attachmentId } = await context.params;
    if (!uuidPattern.test(conversationId) || !uuidPattern.test(attachmentId)) {
      return Response.json({ message: "We couldn’t find that file. Refresh the conversation and try again." }, { status: 400 });
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();

    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) return notFoundResponse();
    const result = await db.transaction(async (tx) => {
      const [attachment] = await tx
        .select({ id: messageAttachments.id, objectKey: messageAttachments.objectKey })
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
      if (!attachment) return { kind: "missing" } as const;

      const [linkedMessage] = await tx
        .select({ id: messageEnvelopes.id })
        .from(messageEnvelopes)
        .where(eq(messageEnvelopes.attachmentId, attachmentId))
        .limit(1);
      if (linkedMessage) {
        return { kind: "linked" } as const;
      }

      // Delete the reference while holding its row lock. A concurrent message insert
      // must finish before this check or observe the missing attachment afterwards.
      await tx.delete(messageAttachments).where(eq(messageAttachments.id, attachmentId));
      return { kind: "deleted", objectKey: attachment.objectKey } as const;
    });
    if (result.kind === "linked") {
      return Response.json({ message: "A file that’s already been sent can’t be removed here." }, { status: 409 });
    }
    if (result.kind === "deleted") {
      try {
        await removeEncryptedAttachment(result.objectKey);
      } catch {
        console.error("Untold orphaned encrypted attachment needs storage cleanup");
      }
    }
    return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
