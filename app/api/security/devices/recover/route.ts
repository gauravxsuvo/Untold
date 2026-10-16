import { and, eq, ne, sql } from "drizzle-orm";
import { symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@/lib/auth/server";
import {
  consumeTotpCode,
  normalizeRecoveryCode,
  readRecoveryCodes,
  recoveryCodeMatches,
} from "@/lib/auth/security-helpers";
import { securityFailure, securityRequestBudget } from "@/lib/server/account-security";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedSession,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import {
  accountIdentities,
  authAccount,
  authSession,
  authTwoFactor,
  authUser,
  authVerification,
  contactVerifications,
  devices,
} from "@/lib/server/schema";
import { revokeCallAccess } from "@/lib/server/group-calls";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const parsed = await readJsonBody(request, 4096);
    const body = parsed.ok ? (parsed.body as Record<string, unknown> | null) : null;
    if (
      !body ||
      typeof body.deviceId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(body.deviceId) ||
      typeof body.password !== "string" ||
      body.password.length > 128 ||
      typeof body.code !== "string" ||
      body.code.length > 64 ||
      (body.method !== "totp" && body.method !== "backup") ||
      body.confirm !== true
    )
      return securityFailure();
    const limited = await securityRequestBudget(request, "management", session.user.id);
    if (limited) return limited;
    const { db } = getDatabase();
    const context = await getAuth().$context;
    const identity = await db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(authUser)
        .where(eq(authUser.id, session.user.id))
        .for("update");
      if (!user) return null;
      const [live] = await tx
        .select()
        .from(authSession)
        .where(
          and(
            eq(authSession.id, session.session.id),
            eq(authSession.userId, user.id),
            sql`${authSession.expiresAt} > now()`,
          ),
        )
        .for("update");
      const [account] = await tx
        .select()
        .from(authAccount)
        .where(and(eq(authAccount.userId, user.id), eq(authAccount.providerId, "credential")))
        .for("update");
      if (
        !live ||
        !account?.password ||
        !(await context.password.verify({
          hash: account.password,
          password: body.password as string,
        }))
      )
        return null;
      const [device] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, body.deviceId as string), eq(devices.userId, user.id)))
        .for("update");
      const [previous] = await tx
        .select()
        .from(accountIdentities)
        .where(eq(accountIdentities.userId, user.id));
      if (!device || device.revokedAt || previous?.deviceId === device.id) return null;
      if (user.twoFactorEnabled) {
        const [factor] = await tx
          .select()
          .from(authTwoFactor)
          .where(eq(authTwoFactor.userId, user.id))
          .for("update");
        if (!factor?.verified || (factor.lockedUntil && factor.lockedUntil > new Date()))
          return null;
        if (body.method === "totp") {
          if (
            (await consumeTotpCode(
              tx,
              user.id,
              factor.secret,
              (body.code as string).trim(),
              context.secretConfig,
              context.secret,
            )) !== "valid"
          )
            return null;
        } else {
          const code = normalizeRecoveryCode(body.code as string);
          const codes = await readRecoveryCodes(factor.backupCodes, context.secretConfig);
          if (!recoveryCodeMatches(codes, code)) return null;
          await tx
            .update(authTwoFactor)
            .set({
              backupCodes: await symmetricEncrypt({
                key: context.secretConfig,
                data: JSON.stringify(codes.filter((saved) => saved !== code)),
              }),
            })
            .where(eq(authTwoFactor.id, factor.id));
        }
      }
      const root = {
        userId: user.id,
        deviceId: device.id,
        agreementKey: device.agreementKey,
        signingKey: device.signingKey,
      };
      await tx
        .update(devices)
        .set({ revokedAt: new Date() })
        .where(and(eq(devices.userId, user.id), ne(devices.id, device.id)));
      await revokeCallAccess(tx, user.id);
      await tx
        .update(devices)
        .set({ approval: null, approvalResponse: null, linkHash: null, linkExpiresAt: null })
        .where(eq(devices.id, device.id));
      await tx
        .insert(accountIdentities)
        .values(root)
        .onConflictDoUpdate({ target: accountIdentities.userId, set: root });
      await tx.delete(contactVerifications).where(eq(contactVerifications.ownerId, user.id));
      await tx
        .delete(authSession)
        .where(and(eq(authSession.userId, user.id), ne(authSession.id, live.id)));
      await tx.delete(authVerification).where(eq(authVerification.value, user.id));
      await tx
        .update(authUser)
        .set({
          updatedAt: sql`GREATEST(clock_timestamp(), ${authUser.updatedAt} + interval '1 millisecond')`,
        })
        .where(eq(authUser.id, user.id));
      return root;
    });
    return identity
      ? Response.json({ identity }, { headers: { "Cache-Control": "no-store" } })
      : securityFailure();
  } catch (error) {
    return backendErrorResponse(error);
  }
}
