import "server-only";
import { and, eq, gt } from "drizzle-orm";
import webpush from "web-push";
import { getDatabase } from "./database";
import { authSession, calls, memberships, pushSubscriptions } from "./schema";
import { getPushKeys, isAllowedPushEndpoint } from "./push";
export async function notifyIncomingCall(id: string) {
  const { db } = getDatabase();
  const [call] = await db
    .select()
    .from(calls)
    .where(and(eq(calls.id, id), eq(calls.status, "ringing"), gt(calls.expiresAt, new Date())))
    .limit(1);
  if (!call) return;
  const subscriptions = await db
    .select({ subscription: pushSubscriptions })
    .from(pushSubscriptions)
    .innerJoin(authSession, eq(authSession.id, pushSubscriptions.sessionId))
    .innerJoin(memberships, eq(memberships.userId, pushSubscriptions.userId))
    .where(
      and(
        eq(pushSubscriptions.userId, call.calleeId),
        eq(memberships.status, "approved"),
        gt(authSession.expiresAt, new Date()),
      ),
    )
    .limit(20);
  if (!subscriptions.length) return;
  const keys = await getPushKeys();
  await Promise.allSettled(
    subscriptions.map(async ({ subscription }) => {
      if (!isAllowedPushEndpoint(subscription.endpoint)) return;
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            type: "incoming-call",
            viewerId: subscription.userId,
            conversationId: call.conversationId,
            callId: call.id,
            expiresAt: call.expiresAt.toISOString(),
          }),
          {
            TTL: Math.max(
              1,
              Math.min(60, Math.floor((call.expiresAt.getTime() - Date.now()) / 1000)),
            ),
            urgency: "high",
            timeout: 5000,
            vapidDetails: {
              subject: process.env.BETTER_AUTH_URL?.trim() || "https://untold.portways.app",
              ...keys,
            },
          },
        );
      } catch (error) {
        const status =
          error && typeof error === "object" && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        if (status === 404 || status === 410)
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpointHash, subscription.endpointHash));
      }
    }),
  );
}
