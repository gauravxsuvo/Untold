import { after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/server/database";
import { pushSubscriptions } from "@/lib/server/schema";
import {
  deliverPushOutbox,
  endpointHash,
  getPushKeys,
  isAllowedPushEndpoint,
  validPushKeys,
} from "@/lib/server/push";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedSession,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const { db } = getDatabase();
    const limit = await consumeRateLimit(db, `push-read:${session.user.id}`, {
      max: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    const { publicKey } = await getPushKeys();
    const hash = new URL(request.url).searchParams.get("endpoint");
    const registered =
      hash && /^[a-f0-9]{64}$/.test(hash)
        ? (
            await db
              .select({ hash: pushSubscriptions.endpointHash })
              .from(pushSubscriptions)
              .where(
                and(
                  eq(pushSubscriptions.endpointHash, hash),
                  eq(pushSubscriptions.userId, session.user.id),
                  eq(pushSubscriptions.sessionId, session.session.id),
                ),
              )
              .limit(1)
          ).length > 0
        : false;
    after(async () => {
      try {
        await deliverPushOutbox();
      } catch {
        /* Subsequent activity retries. */
      }
    });
    return Response.json({ publicKey, registered }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
async function change(request: Request) {
  if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const parsed = await readJsonBody(request, 4096);
    if (!parsed.ok)
      return Response.json(
        { message: "We couldn’t save your notification preference." },
        { status: parsed.status },
      );
    const body = parsed.ok
      ? (parsed.body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null)
      : null;
    if (!body || typeof body.endpoint !== "string" || !isAllowedPushEndpoint(body.endpoint))
      return Response.json(
        { message: "We couldn’t save your notification preference." },
        { status: 400 },
      );
    const { db } = getDatabase();
    const limited = await consumeRateLimit(db, `push-settings:${session.user.id}`, {
      max: 30,
      windowSeconds: 3600,
    });
    if (!limited.allowed) return rateLimitedResponse(limited.retryAfterSeconds);
    const hash = endpointHash(body.endpoint);
    if (request.method === "DELETE") {
      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpointHash, hash),
            eq(pushSubscriptions.userId, session.user.id),
          ),
        );
    } else {
      const keys = body.keys;
      if (!keys || !validPushKeys(keys.p256dh, keys.auth))
        return Response.json(
          { message: "We couldn’t save your notification preference." },
          { status: 400 },
        );
      await db.transaction(async (tx) => {
        // Serialize an account's subscription limit and reassignment on a shared browser.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${session.user.id}, 19))`,
        );
        const rows = await tx
          .select({ hash: pushSubscriptions.endpointHash })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, session.user.id));
        if (rows.length >= 20 && !rows.some(({ hash: existing }) => existing === hash))
          throw new Error("Notification device limit");
        await tx
          .insert(pushSubscriptions)
          .values({
            endpointHash: hash,
            endpoint: body.endpoint as string,
            p256dh: keys.p256dh as string,
            auth: keys.auth as string,
            userId: session.user.id,
            sessionId: session.session.id,
          })
          .onConflictDoUpdate({
            target: pushSubscriptions.endpointHash,
            set: {
              p256dh: keys.p256dh as string,
              auth: keys.auth as string,
              userId: session.user.id,
              sessionId: session.session.id,
              updatedAt: new Date(),
            },
          });
      });
    }
    return Response.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
export const POST = change;
export const DELETE = change;
