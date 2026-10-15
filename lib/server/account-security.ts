import "server-only";

import { isIP } from "node:net";
import { and, eq, ne, sql } from "drizzle-orm";
import { symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@/lib/auth/server";
import {
  consumeTotpCode,
  createRecoveryCodes,
  normalizeRecoveryCode,
  readRecoveryCodes,
  recoveryCodeIsValidFormat,
  recoveryCodeMatches,
  securityFingerprint,
} from "@/lib/auth/security-helpers";
import { getDatabase } from "@/lib/server/database";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import {
  authAccount,
  authSession,
  authTwoFactor,
  authUser,
  authVerification,
} from "@/lib/server/schema";

export function securityFailure(): Response {
  return Response.json(
    {
      message:
        "We couldn’t verify those details. Check them and try again, or wait a while if you’ve made several attempts.",
    },
    {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function securityRequestBudget(
  request: Request,
  purpose: "recovery" | "management",
  account: string,
): Promise<Response | null> {
  const { db } = getDatabase();
  const { secret } = await getAuth().$context;
  // Cloudflare sets this header at the trusted ingress. Avoid storing raw IPs or emails in rate limit keys.
  const cloudflareIP = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const forwardedIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ip = isIP(cloudflareIP) ? cloudflareIP : isIP(forwardedIP) ? forwardedIP : "unknown";
  const ipBudget = await consumeRateLimit(
    db,
    `security:${purpose}:ip:${securityFingerprint(secret, "ip", ip)}`,
    { max: 10, windowSeconds: 900 },
  );
  if (!ipBudget.allowed) return rateLimitedResponse(ipBudget.retryAfterSeconds);
  const accountBudget = await consumeRateLimit(
    db,
    `security:${purpose}:account:${securityFingerprint(secret, "account", account)}`,
    { max: 10, windowSeconds: 900 },
  );
  return accountBudget.allowed ? null : rateLimitedResponse(accountBudget.retryAfterSeconds);
}

export async function resetPasswordWithRecoveryCode(
  email: string,
  rawCode: string,
  password: string,
): Promise<boolean> {
  const code = normalizeRecoveryCode(rawCode);
  if (!recoveryCodeIsValidFormat(code)) return false;
  const { db } = getDatabase();
  const context = await getAuth().$context;
  return db.transaction(async (tx) => {
    // Consistent lock order for reset and MFA management. Re-check eligibility under the lock.
    const [user] = await tx.select().from(authUser).where(eq(authUser.email, email)).for("update");
    if (!user?.twoFactorEnabled) return false;
    const [factor] = await tx
      .select()
      .from(authTwoFactor)
      .where(eq(authTwoFactor.userId, user.id))
      .for("update");
    if (!factor?.verified) return false;
    const codes = await readRecoveryCodes(factor.backupCodes, context.secretConfig);
    if (!recoveryCodeMatches(codes, code)) return false;
    const [account] = await tx
      .select()
      .from(authAccount)
      .where(and(eq(authAccount.userId, user.id), eq(authAccount.providerId, "credential")))
      .for("update");
    if (!account?.password) return false;
    const hash = await context.password.hash(password);
    const remaining = await symmetricEncrypt({
      key: context.secretConfig,
      data: JSON.stringify(codes.filter((saved) => saved !== code)),
    });
    await tx
      .update(authTwoFactor)
      .set({ backupCodes: remaining, failedVerificationCount: 0, lockedUntil: null })
      .where(eq(authTwoFactor.id, factor.id));
    await tx
      .update(authAccount)
      .set({ password: hash, updatedAt: new Date() })
      .where(eq(authAccount.id, account.id));
    await tx
      .update(authUser)
      .set({
        updatedAt: sql`GREATEST(clock_timestamp(), ${authUser.updatedAt} + interval '1 millisecond')`,
      })
      .where(eq(authUser.id, user.id));
    await tx.delete(authSession).where(eq(authSession.userId, user.id));
    // Revoke pending sign-ins and trusted-device grants as well as reset tokens.
    await tx.delete(authVerification).where(eq(authVerification.value, user.id));
    return true;
  });
}

export async function manageMfa(
  userId: string,
  sessionToken: string,
  password: string,
  method: "totp" | "backup",
  rawCode: string,
  action: "disable" | "regenerate",
): Promise<{ ok: false } | { ok: true; backupCodes?: string[] }> {
  const { db } = getDatabase();
  const context = await getAuth().$context;
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(authUser).where(eq(authUser.id, userId)).for("update");
    if (!user?.twoFactorEnabled) return { ok: false };
    const [factor] = await tx
      .select()
      .from(authTwoFactor)
      .where(eq(authTwoFactor.userId, userId))
      .for("update");
    if (!factor?.verified || (factor.lockedUntil && factor.lockedUntil > new Date()))
      return { ok: false };
    // A concurrent reset or disable must invalidate this request before it can change security settings.
    const [session] = await tx
      .select({ id: authSession.id })
      .from(authSession)
      .where(
        and(
          eq(authSession.userId, userId),
          eq(authSession.token, sessionToken),
          sql`${authSession.expiresAt} > now()`,
        ),
      )
      .for("update");
    const [account] = await tx
      .select()
      .from(authAccount)
      .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, "credential")))
      .for("update");
    if (
      !session ||
      !account?.password ||
      !(await context.password.verify({ hash: account.password, password }))
    )
      return { ok: false };
    if (method === "totp") {
      if (
        (await consumeTotpCode(
          tx,
          userId,
          factor.secret,
          rawCode.trim(),
          context.secretConfig,
          context.secret,
        )) !== "valid"
      )
        return { ok: false };
    } else {
      const code = normalizeRecoveryCode(rawCode);
      if (
        !recoveryCodeIsValidFormat(code) ||
        !recoveryCodeMatches(
          await readRecoveryCodes(factor.backupCodes, context.secretConfig),
          code,
        )
      )
        return { ok: false };
    }
    if (action === "disable") {
      await tx
        .update(authUser)
        .set({
          twoFactorEnabled: false,
          updatedAt: sql`GREATEST(clock_timestamp(), ${authUser.updatedAt} + interval '1 millisecond')`,
        })
        .where(eq(authUser.id, userId));
      await tx.delete(authTwoFactor).where(eq(authTwoFactor.userId, userId));
      await tx.delete(authSession).where(eq(authSession.userId, userId));
      await tx.delete(authVerification).where(eq(authVerification.value, userId));
      return { ok: true };
    }
    const backupCodes = createRecoveryCodes();
    await tx
      .update(authUser)
      .set({
        updatedAt: sql`GREATEST(clock_timestamp(), ${authUser.updatedAt} + interval '1 millisecond')`,
      })
      .where(eq(authUser.id, userId));
    await tx
      .update(authTwoFactor)
      .set({
        backupCodes: await symmetricEncrypt({
          key: context.secretConfig,
          data: JSON.stringify(backupCodes),
        }),
      })
      .where(eq(authTwoFactor.id, factor.id));
    await tx
      .delete(authSession)
      .where(and(eq(authSession.userId, userId), ne(authSession.token, sessionToken)));
    await tx.delete(authVerification).where(eq(authVerification.value, userId));
    return { ok: true, backupCodes };
  });
}
