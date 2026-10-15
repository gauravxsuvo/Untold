import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { and, eq, ne } from "drizzle-orm";
import { consumeTotpCode, createRecoveryCodes } from "@/lib/auth/security-helpers";
import { accountSecurityGuard, capturePrimaryProof } from "@/lib/auth/security-session-guard";
import { getDatabase, BackendConfigurationError } from "@/lib/server/database";
import { getAuthEnvironmentIssues } from "@/lib/server/portways-config";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
  authTwoFactor,
} from "@/lib/server/schema";

const blockedAuthPaths = [
  "/request-password-reset",
  "/reset-password",
  "/change-password",
  "/set-password",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/two-factor/get-totp-uri",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
];

function createUntoldAuth() {
  const issues = getAuthEnvironmentIssues(process.env);
  if (issues.length > 0) throw new BackendConfigurationError(issues);

  const baseURL = process.env.BETTER_AUTH_URL?.trim();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!baseURL || !secret) {
    throw new BackendConfigurationError(["BETTER_AUTH_URL", "BETTER_AUTH_SECRET"]);
  }

  const { db } = getDatabase();
  return betterAuth({
    appName: "Untold",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    advanced: {
      ipAddress: {
        // Portways serves through Cloudflare and Traefik, so X-Forwarded-For carries several
        // hops and Better Auth rejects it. Cloudflare's single-value header is the client IP.
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      transaction: true,
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
        rateLimit: authRateLimit,
        twoFactor: authTwoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: { cookieCache: { enabled: false } },
    plugins: [
      twoFactor({
        issuer: "Untold",
        skipVerificationOnEnable: false,
        twoFactorCookieMaxAge: 300,
        backupCodeOptions: {
          storeBackupCodes: "encrypted",
          customBackupCodesGenerate: createRecoveryCodes,
        },
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
      }),
      // This must run after the two-factor plugin has finished creating any grant.
      accountSecurityGuard(db),
    ],
    // Sensitive management and recovery go through our password + second-factor routes.
    disabledPaths: blockedAuthPaths,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (blockedAuthPaths.includes(ctx.path) || ctx.path.startsWith("/reset-password/")) {
          throw new APIError("FORBIDDEN", {
            message: "Open account settings or password recovery to continue.",
          });
        }
        if (ctx.path.startsWith("/two-factor/")) {
          if (ctx.body?.trustDevice === true || ctx.body?.method === "otp") {
            throw new APIError("BAD_REQUEST", {
              message: "Use an authenticator app code to continue.",
            });
          }
        }
        if (ctx.path !== "/two-factor/verify-totp") return;
        const session = await getSessionFromCtx(ctx);
        let userId = session?.user.id;
        if (!userId) {
          const cookie = ctx.context.createAuthCookie("two_factor");
          const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
          if (!identifier) return;
          const challenge = await ctx.context.internalAdapter.findVerificationValue(identifier);
          if (!challenge || challenge.expiresAt <= new Date()) return;
          userId = challenge.value;
        }
        const [factor] = await db
          .select()
          .from(authTwoFactor)
          .where(eq(authTwoFactor.userId, userId))
          .limit(1);
        if (!factor || (factor.lockedUntil && factor.lockedUntil > new Date())) return;
        const result = await consumeTotpCode(
          db,
          userId,
          factor.secret,
          String(ctx.body?.code ?? ""),
          ctx.context.secretConfig,
          secret,
        );
        if (result === "used")
          throw new APIError("BAD_REQUEST", {
            message: "This code was already used. Wait for a new code and try again.",
            code: "CODE_ALREADY_USED",
          });
      }),
      after: createAuthMiddleware(async (ctx) => {
        const created = ctx.context.newSession;
        if (ctx.path === "/sign-in/email" && created)
          capturePrimaryProof(ctx.context, created.user);
        if (
          ctx.path !== "/two-factor/verify-totp" ||
          !created?.user.twoFactorEnabled ||
          !ctx.context.session ||
          ctx.context.session?.user.twoFactorEnabled
        )
          return;
        // Enrollment rotates this session. Other browsers must sign in with MFA.
        await db
          .delete(authSession)
          .where(
            and(
              eq(authSession.userId, created.user.id),
              ne(authSession.token, created.session.token),
            ),
          );
        await db.delete(authVerification).where(eq(authVerification.value, created.user.id));
      }),
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/two-factor/enable": { window: 60, max: 5 },
      },
    },
  });
}

type UntoldAuth = ReturnType<typeof createUntoldAuth>;
const globalForAuth = globalThis as typeof globalThis & { untoldAuth?: UntoldAuth };

export function getAuth(): UntoldAuth {
  if (globalForAuth.untoldAuth) return globalForAuth.untoldAuth;

  const auth = createUntoldAuth();
  globalForAuth.untoldAuth = auth;
  return auth;
}
