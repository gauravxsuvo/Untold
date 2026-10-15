import "server-only";

import { sql } from "drizzle-orm";
import type { getDatabase } from "@/lib/server/database";
import { appRateLimits } from "@/lib/server/schema";

type Database = ReturnType<typeof getDatabase>["db"];

export type RateLimitRule = { max: number; windowSeconds: number };

export const rateLimitRules = {
  startConversation: { max: 20, windowSeconds: 60 * 60 },
  sendMessage: { max: 60, windowSeconds: 60 },
  uploadAttachment: { max: 10, windowSeconds: 60 * 60 },
  downloadAttachment: { max: 120, windowSeconds: 60 },
  realtimeToken: { max: 30, windowSeconds: 60 },
  messageReceipts: { max: 120, windowSeconds: 60 },
  profilePhoto: { max: 20, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

export async function consumeRateLimit(
  db: Database,
  key: string,
  rule: RateLimitRule,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const expiredBefore = now - windowMs;

  const [row] = await db
    .insert(appRateLimits)
    .values({ key, count: 1, windowStartedAt: now })
    .onConflictDoUpdate({
      target: appRateLimits.key,
      set: {
        count: sql`CASE WHEN ${appRateLimits.windowStartedAt} <= ${expiredBefore} THEN 1 ELSE ${appRateLimits.count} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${appRateLimits.windowStartedAt} <= ${expiredBefore} THEN ${now} ELSE ${appRateLimits.windowStartedAt} END`,
      },
    })
    .returning({ count: appRateLimits.count, windowStartedAt: appRateLimits.windowStartedAt });

  const retryAfterSeconds = Math.max(1, Math.ceil((row.windowStartedAt + windowMs - now) / 1000));
  return { allowed: row.count <= rule.max, retryAfterSeconds };
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { code: "rate_limited", message: "Too many requests. Please wait a moment and try again." },
    {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) },
    },
  );
}
