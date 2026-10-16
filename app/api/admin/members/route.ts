import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  getAuthenticatedSession,
  backendErrorResponse,
  unauthorizedResponse,
  trustedBrowserOrigin,
  forbiddenOriginResponse,
  readJsonBody,
} from "@/lib/server/http";
import { accountAccess } from "@/lib/server/membership";
import { getDatabase } from "@/lib/server/database";
import { authUser, memberships, pushSubscriptions } from "@/lib/server/schema";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { revokeCallAccess } from "@/lib/server/group-calls";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    if (!(await accountAccess(session.user)).admin)
      return Response.json({ message: "You don’t have access to this page." }, { status: 403 });
    const { db } = getDatabase();
    // Include signups that have not visited the app or waiting page yet.
    await db.execute(
      sql`INSERT INTO untold_app.membership (user_id, requested_at) SELECT id, created_at FROM untold_auth."user" ON CONFLICT DO NOTHING`,
    );
    const status = new URL(request.url).searchParams.get("status") ?? "pending";
    if (!["pending", "approved", "rejected"].includes(status))
      return Response.json({ message: "Choose a valid filter." }, { status: 400 });
    const page = Number(new URL(request.url).searchParams.get("page") ?? "0");
    if (!Number.isInteger(page) || page < 0 || page > 10_000)
      return Response.json({ message: "Choose a valid page." }, { status: 400 });
    const members = await db
      .select({
        id: authUser.id,
        name: authUser.name,
        email: authUser.email,
        status: memberships.status,
        requestedAt: memberships.requestedAt,
      })
      .from(memberships)
      .innerJoin(authUser, eq(authUser.id, memberships.userId))
      .where(and(eq(memberships.status, status), ne(authUser.id, session.user.id)))
      .orderBy(desc(memberships.requestedAt), authUser.id)
      .limit(51)
      .offset(page * 50);
    return Response.json(
      { members: members.slice(0, 50), hasMore: members.length > 50 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    if (!(await accountAccess(session.user)).admin)
      return Response.json({ message: "You don’t have access to this page." }, { status: 403 });
    const parsed = await readJsonBody(request, 2048);
    if (!parsed.ok)
      return Response.json({ message: "Please try again." }, { status: parsed.status });
    const body = parsed.body as { userId?: unknown; status?: unknown } | null;
    if (
      !body ||
      typeof body.userId !== "string" ||
      body.userId.length > 128 ||
      body.userId === session.user.id ||
      !["approved", "rejected"].includes(String(body.status))
    )
      return Response.json({ message: "Choose another account and an action." }, { status: 400 });
    const { db } = getDatabase();
    const limit = await consumeRateLimit(db, `admin-review:${session.user.id}`, {
      max: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    const userId = body.userId;
    const status = String(body.status);
    const changed = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(authUser).where(eq(authUser.id, userId)).for("update");
      if (!user) return false;
      await tx
        .insert(memberships)
        .values({ userId, status, reviewedBy: session.user.id, reviewedAt: new Date() })
        .onConflictDoUpdate({
          target: memberships.userId,
          set: { status, reviewedBy: session.user.id, reviewedAt: new Date() },
        });
      if (status === "rejected") {
        await revokeCallAccess(tx, userId);
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
      }
      return true;
    });
    return Response.json(changed ? { ok: true } : { message: "Account not found." }, {
      status: changed ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
