import "server-only";

import { createHash, ECDH } from "node:crypto";
import webpush from "web-push";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { and, eq, gt, inArray, lte, ne, sql, isNull, exists } from "drizzle-orm";
import { getAuth } from "@/lib/auth/server";
import { getDatabase } from "@/lib/server/database";
import {
  authSession,
  conversationMembers,
  messageEnvelopes,
  messageRecipients,
  messageReceipts,
  pushDeliveries,
  pushKeys,
  pushOutbox,
  pushSubscriptions,
} from "@/lib/server/schema";

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export function validPushKeys(p256dh: unknown, auth: unknown): p256dh is string {
  if (
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    !/^[A-Za-z0-9_-]{87}=?$/.test(p256dh) ||
    !/^[A-Za-z0-9_-]{22}={0,2}$/.test(auth)
  )
    return false;
  try {
    const point = Buffer.from(p256dh, "base64url");
    if (point.length !== 65 || point[0] !== 4 || Buffer.from(auth, "base64url").length !== 16)
      return false;
    ECDH.convertKey(point, "prime256v1", undefined, undefined, "uncompressed");
    return true;
  } catch {
    return false;
  }
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443") ||
      endpoint.length > 2048
    )
      return false;
    const host = url.hostname.toLowerCase();
    // Only browser-vendor push services. User-supplied endpoints must never become an SSRF proxy.
    return (
      host === "fcm.googleapis.com" ||
      host === "updates.push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host === "web.push.apple.com" ||
      host.endsWith(".push.apple.com") ||
      host.endsWith(".notify.windows.com")
    );
  } catch {
    return false;
  }
}

export async function getPushKeys() {
  const { db } = getDatabase();
  const context = await getAuth().$context;
  let [keys] = await db.select().from(pushKeys).where(eq(pushKeys.id, "default")).limit(1);
  if (!keys) {
    const created = webpush.generateVAPIDKeys();
    await db
      .insert(pushKeys)
      .values({
        id: "default",
        publicKey: created.publicKey,
        privateKey: await symmetricEncrypt({ key: context.secretConfig, data: created.privateKey }),
      })
      .onConflictDoNothing();
    [keys] = await db.select().from(pushKeys).where(eq(pushKeys.id, "default")).limit(1);
  }
  if (!keys) throw new Error("Notification keys unavailable");
  return {
    publicKey: keys.publicKey,
    privateKey: await symmetricDecrypt({ key: context.secretConfig, data: keys.privateKey }),
  };
}

export async function deliverPushOutbox() {
  const { db } = getDatabase();
  const jobs = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: pushOutbox.messageId, attempts: pushOutbox.attempts })
      .from(pushOutbox)
      .where(lte(pushOutbox.nextAttemptAt, new Date()))
      .orderBy(pushOutbox.nextAttemptAt)
      .limit(4)
      .for("update", { skipLocked: true });
    if (rows.length)
      await tx
        .update(pushOutbox)
        .set({
          attempts: sql`${pushOutbox.attempts} + 1`,
          nextAttemptAt: new Date(Date.now() + 5 * 60_000),
        })
        .where(
          inArray(
            pushOutbox.messageId,
            rows.map(({ id }) => id),
          ),
        );
    return rows;
  });
  if (!jobs.length) return;
  const keys = await getPushKeys();
  for (const job of jobs) {
    let retry = false;
    const [message] = await db
      .select({
        id: messageEnvelopes.id,
        conversationId: messageEnvelopes.conversationId,
        senderId: messageEnvelopes.senderId,
        createdAt: messageEnvelopes.createdAt,
      })
      .from(messageEnvelopes)
      .where(eq(messageEnvelopes.id, job.id))
      .limit(1);
    if (!message) continue;
    if (message.createdAt.getTime() < Date.now() - 3600_000 || job.attempts >= 5) {
      await db.delete(pushOutbox).where(eq(pushOutbox.messageId, job.id));
      continue;
    }
    const targets = await db
      .select({ subscription: pushSubscriptions })
      .from(pushSubscriptions)
      .innerJoin(
        authSession,
        and(eq(authSession.id, pushSubscriptions.sessionId), gt(authSession.expiresAt, new Date())),
      )
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.userId, pushSubscriptions.userId),
          eq(conversationMembers.conversationId, message.conversationId),
        ),
      )
      .where(
        and(
          ne(pushSubscriptions.userId, message.senderId),
          isNull(conversationMembers.leftAt),
          exists(db.select({ id: messageRecipients.messageId }).from(messageRecipients).where(and(eq(messageRecipients.messageId, message.id), eq(messageRecipients.userId, pushSubscriptions.userId)))),
          lte(pushSubscriptions.updatedAt, message.createdAt),
        ),
      )
      .limit(160);
    const delivered = new Set(
      (
        await db
          .select({ hash: pushDeliveries.endpointHash })
          .from(pushDeliveries)
          .where(eq(pushDeliveries.messageId, job.id))
      ).map(({ hash }) => hash),
    );
    async function sendTarget({ subscription }: (typeof targets)[number]) {
      if (delivered.has(subscription.endpointHash)) return;
      const [receipt] = await db
        .select({ readAt: messageReceipts.readAt })
        .from(messageReceipts)
        .where(
          and(
            eq(messageReceipts.messageId, message.id),
            eq(messageReceipts.userId, subscription.userId),
          ),
        )
        .limit(1);
      if (receipt?.readAt) return;
      if (!isAllowedPushEndpoint(subscription.endpoint)) return;
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            type: "new-message",
            viewerId: subscription.userId,
            conversationId: message.conversationId,
            messageId: message.id,
          }),
          {
            TTL: 3600,
            urgency: "normal",
            timeout: 5000,
            vapidDetails: {
              subject: process.env.BETTER_AUTH_URL?.trim() || "https://untold.portways.app",
              ...keys,
            },
          },
        );
        await db
          .insert(pushDeliveries)
          .values({ messageId: job.id, endpointHash: subscription.endpointHash })
          .onConflictDoNothing();
      } catch (error) {
        const status =
          error && typeof error === "object" && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        if (status === 404 || status === 410)
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpointHash, subscription.endpointHash));
        else retry = true;
      }
    }
    for (let offset = 0; offset < targets.length; offset += 4)
      await Promise.all(targets.slice(offset, offset + 4).map(sendTarget));
    if (!retry || job.attempts >= 4 || message.createdAt.getTime() < Date.now() - 3600_000)
      await db.delete(pushOutbox).where(eq(pushOutbox.messageId, job.id));
    else
      await db
        .update(pushOutbox)
        .set({
          nextAttemptAt: new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** job.attempts)),
        })
        .where(eq(pushOutbox.messageId, job.id));
  }
}
