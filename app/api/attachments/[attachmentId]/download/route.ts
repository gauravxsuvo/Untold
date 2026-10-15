import { and, eq } from "drizzle-orm";
import {
  backendErrorResponse,
  getAuthenticatedUser,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { isConversationMember } from "@/lib/server/conversations";
import { createAttachmentDownloadUrl, getObjectStorage } from "@/lib/server/object-storage";
import { consumeRateLimit, rateLimitedResponse, rateLimitRules } from "@/lib/server/rate-limit";
import { messageAttachments, messageEnvelopes } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attachmentId: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { attachmentId } = await context.params;
    if (!uuidPattern.test(attachmentId)) {
      return Response.json({ message: "We couldn’t find that file. Refresh the conversation and try again." }, { status: 400 });
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const { db } = getDatabase();
    const [attachment] = await db
      .select({
        conversationId: messageAttachments.conversationId,
        objectKey: messageAttachments.objectKey,
      })
      .from(messageAttachments)
      .innerJoin(messageEnvelopes, eq(messageEnvelopes.attachmentId, messageAttachments.id))
      .where(and(
        eq(messageAttachments.id, attachmentId),
        eq(messageEnvelopes.attachmentId, attachmentId),
        eq(messageEnvelopes.conversationId, messageAttachments.conversationId),
      ))
      .limit(1);
    if (!attachment || !(await isConversationMember(db, attachment.conversationId, user.id))) {
      return Response.json({ message: "This file is no longer available." }, { status: 404 });
    }

    const limit = await consumeRateLimit(db, `download-attachment:${user.id}`, rateLimitRules.downloadAttachment);
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    if (!getObjectStorage()) {
      return Response.json({ message: "File sharing isn’t available right now. Please try again in a moment." }, { status: 503 });
    }

    const url = await createAttachmentDownloadUrl(attachment.objectKey);
    return Response.json(
      { url, expiresIn: 300 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
