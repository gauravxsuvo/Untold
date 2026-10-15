import { and, inArray, eq, isNull } from "drizzle-orm";
import {
  getAuthenticatedUser,
  backendErrorResponse,
  forbiddenOriginResponse,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { createConversationSubscribeToken } from "@/lib/server/ably";
import { consumeRateLimit, rateLimitedResponse, rateLimitRules } from "@/lib/server/rate-limit";
import { conversationMembers } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();

    const parsed = await readJsonBody(request, 8 * 1024);
    if (!parsed.ok) {
      return Response.json(
        { message: parsed.status === 413 ? "Request is too large." : "We couldn’t complete that action. Refresh the page and try again." },
        { status: parsed.status },
      );
    }
    const { body } = parsed;

    if (!body || typeof body !== "object" || !("conversationIds" in body)) {
      return Response.json({ message: "Choose a conversation first." }, { status: 400 });
    }

    const conversationIds = (body as { conversationIds?: unknown }).conversationIds;
    if (
      !Array.isArray(conversationIds) ||
      conversationIds.length < 1 ||
      conversationIds.length > 25 ||
      !conversationIds.every((id): id is string => typeof id === "string" && uuidPattern.test(id))
    ) {
      return Response.json({ message: "We couldn’t open these conversations. Refresh the page and try again." }, { status: 400 });
    }

    const uniqueIds = [...new Set(conversationIds)];
    const { db } = getDatabase();
    const limit = await consumeRateLimit(db, `realtime-token:${user.id}`, rateLimitRules.realtimeToken);
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

    const memberships = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.userId, user.id),
          isNull(conversationMembers.leftAt),
          inArray(conversationMembers.conversationId, uniqueIds),
        ),
      );

    if (memberships.length !== uniqueIds.length) {
      return Response.json({ message: "You do not have access to every conversation." }, { status: 403 });
    }

    const tokenRequest = await createConversationSubscribeToken(user.id, uniqueIds);
    return Response.json(tokenRequest, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
