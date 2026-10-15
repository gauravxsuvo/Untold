import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  getAuthenticatedSession,
  unauthorizedResponse,
  backendErrorResponse,
  trustedBrowserOrigin,
  forbiddenOriginResponse,
  readJsonBody,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import {
  authSession,
  authUser,
  memberships,
  conversations,
  conversationMembers,
} from "@/lib/server/schema";
import { findUserByEmail, listConversationsForUser } from "@/lib/server/conversations";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { maxGroupMembers, normalizeGroupName } from "@/lib/messaging/groups";
import { isCallId } from "@/lib/messaging/call-signatures";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ conversationId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const { conversationId } = await context.params;
    if (!isCallId(conversationId))
      return Response.json({ message: "Group not found." }, { status: 404 });
    const parsed = await readJsonBody(request, 2048);
    if (!parsed.ok)
      return Response.json({ message: "Please try again." }, { status: parsed.status });
    const body = parsed.body as {
      action?: unknown;
      name?: unknown;
      email?: unknown;
      userId?: unknown;
    } | null;
    if (!body || !["rename", "add", "remove", "leave", "transfer"].includes(String(body.action)))
      return Response.json({ message: "Choose a group action." }, { status: 400 });
    const { db } = getDatabase();
    const limit = await consumeRateLimit(db, `group-edit:${session.user.id}`, {
      max: 60,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    const target =
      body.action === "add" && typeof body.email === "string" && body.email.length <= 254
        ? await findUserByEmail(db, body.email)
        : null;
    const result = await db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update");
      const members = await tx
        .select()
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            isNull(conversationMembers.leftAt),
          ),
        )
        .orderBy(conversationMembers.joinedAt, conversationMembers.userId);
      if (!group?.groupName || !members.some((m) => m.userId === session.user.id))
        return { error: "Group not found.", status: 404 };
      if (body.action !== "leave" && group.groupOwnerId !== session.user.id)
        return { error: "Only the group owner can change these details.", status: 403 };
      const lockIds = [
        ...new Set([...members.map((m) => m.userId), ...(target ? [target.id] : [])]),
      ].sort();
      await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(inArray(authUser.id, lockIds))
        .orderBy(authUser.id)
        .for("no key update");
      const [live] = await tx
        .select({ id: authSession.id })
        .from(authSession)
        .where(and(eq(authSession.id, session.session.id), gt(authSession.expiresAt, new Date())))
        .limit(1);
      const [access] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, session.user.id), eq(memberships.status, "approved")));
      if (!live || !access)
        return { error: "Your account access changed. Sign in again to continue.", status: 403 };
      if (body.action === "rename") {
        const name = normalizeGroupName(body.name);
        if (!name) return { error: "Use a group name between 1 and 80 characters.", status: 400 };
        await tx
          .update(conversations)
          .set({ groupName: name })
          .where(eq(conversations.id, conversationId));
      } else if (body.action === "add") {
        if (!target || members.some((m) => m.userId === target.id))
          return {
            error: "Choose an approved account that isn’t already in this group.",
            status: 400,
          };
        if (members.length >= maxGroupMembers)
          return { error: `Groups can have up to ${maxGroupMembers} people.`, status: 400 };
        const [approved] = await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.userId, target.id), eq(memberships.status, "approved")));
        if (!approved) return { error: "This person isn’t available on Untold yet.", status: 400 };
        await tx
          .insert(conversationMembers)
          .values({ conversationId, userId: target.id, initiatedAt: new Date() })
          .onConflictDoUpdate({
            target: [conversationMembers.conversationId, conversationMembers.userId],
            set: { leftAt: null, joinedAt: new Date(), initiatedAt: new Date() },
          });
      } else if (body.action === "transfer") {
        if (
          typeof body.userId !== "string" ||
          body.userId === session.user.id ||
          !members.some((m) => m.userId === body.userId)
        )
          return { error: "Choose another group member.", status: 400 };
        const [approved] = await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.userId, body.userId), eq(memberships.status, "approved")));
        if (!approved)
          return { error: "Choose a member with approved account access.", status: 400 };
        await tx
          .update(conversations)
          .set({ groupOwnerId: body.userId })
          .where(eq(conversations.id, conversationId));
      } else {
        const removedId = body.action === "leave" ? session.user.id : body.userId;
        if (
          typeof removedId !== "string" ||
          !members.some((m) => m.userId === removedId) ||
          (body.action === "remove" && removedId === session.user.id)
        )
          return { error: "Choose another group member, or use Leave group.", status: 400 };
        await tx
          .update(conversationMembers)
          .set({ leftAt: new Date() })
          .where(
            and(
              eq(conversationMembers.conversationId, conversationId),
              eq(conversationMembers.userId, removedId),
            ),
          );
        const nextOwner = members.find((m) => m.userId !== removedId);
        if (removedId === group.groupOwnerId && nextOwner)
          await tx
            .update(conversations)
            .set({ groupOwnerId: nextOwner.userId })
            .where(eq(conversations.id, conversationId));
      }
      return { error: null, status: 200 };
    });
    if (result.error) return Response.json({ message: result.error }, { status: result.status });
    const [conversation] = await listConversationsForUser(db, session.user.id, [conversationId]);
    return Response.json(
      { conversation: conversation ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
