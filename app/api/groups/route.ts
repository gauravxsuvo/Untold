import { and, eq, gt, inArray, sql } from "drizzle-orm";
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
import { listConversationsForUser } from "@/lib/server/conversations";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { maxGroupMembers, normalizeGroupName } from "@/lib/messaging/groups";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const parsed = await readJsonBody(request, 4096);
    if (!parsed.ok)
      return Response.json(
        { message: "Check the group details and try again." },
        { status: parsed.status },
      );
    const body = parsed.body as { name?: unknown; emails?: unknown } | null;
    const name = normalizeGroupName(body?.name);
    if (
      !name ||
      !Array.isArray(body?.emails) ||
      body.emails.length > maxGroupMembers ||
      body.emails.some(
        (email) =>
          typeof email !== "string" ||
          email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()),
      )
    )
      return Response.json(
        { message: "Choose a group name and valid account emails." },
        { status: 400 },
      );
    const emails = [
      ...new Set((body.emails as string[]).map((email) => email.trim().toLowerCase())),
    ].filter((email) => email !== session.user.email.toLowerCase());
    if (!emails.length || emails.length >= maxGroupMembers)
      return Response.json(
        { message: `Add between 1 and ${maxGroupMembers - 1} other people.` },
        { status: 400 },
      );
    const { db } = getDatabase();
    const limit = await consumeRateLimit(db, `group-create:${session.user.id}`, {
      max: 10,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    const users = await db
      .select({ id: authUser.id, email: authUser.email })
      .from(authUser)
      .where(inArray(sql`lower(${authUser.email})`, emails));
    if (users.length !== emails.length)
      return Response.json(
        {
          message:
            "Some people aren’t available on Untold yet. Check their emails and account approval.",
        },
        { status: 400 },
      );
    const ids = [session.user.id, ...users.map((user) => user.id)].sort();
    const id = crypto.randomUUID();
    const created = await db.transaction(async (tx) => {
      await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(inArray(authUser.id, ids))
        .orderBy(authUser.id)
        .for("no key update");
      const [live] = await tx
        .select({ id: authSession.id })
        .from(authSession)
        .where(and(eq(authSession.id, session.session.id), gt(authSession.expiresAt, new Date())))
        .limit(1);
      const approved = await tx
        .select()
        .from(memberships)
        .where(and(inArray(memberships.userId, ids), eq(memberships.status, "approved")));
      if (!live || approved.length !== ids.length) return false;
      await tx
        .insert(conversations)
        .values({ id, createdBy: session.user.id, groupName: name, groupOwnerId: session.user.id });
      await tx
        .insert(conversationMembers)
        .values(ids.map((userId) => ({ conversationId: id, userId, initiatedAt: new Date() })));
      return true;
    });
    if (!created)
      return Response.json(
        { message: "Some account access changed. Refresh and try again." },
        { status: 403 },
      );
    const [conversation] = await listConversationsForUser(db, session.user.id, [id]);
    return Response.json(
      { conversation },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
