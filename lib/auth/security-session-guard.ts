import "server-only";

import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie, expireCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import type { getDatabase } from "@/lib/server/database";
import { authSession, authUser, authVerification } from "@/lib/server/schema";

type Proof = { id: string; updatedAt: Date; twoFactorEnabled?: boolean };
const primaryProof = Symbol("untold-primary-proof");
type RequestState = { [primaryProof]?: Proof };

export function capturePrimaryProof(context: object, user: Proof) {
  // The auth dispatcher creates a separate context object for every request.
  (context as RequestState)[primaryProof] = {
    id: user.id,
    updatedAt: user.updatedAt,
    twoFactorEnabled: user.twoFactorEnabled === true,
  };
}

export function accountSecurityGuard(db: ReturnType<typeof getDatabase>["db"]): BetterAuthPlugin {
  return {
    id: "untold-session-security",
    hooks: {
      after: [
        {
          matcher: (ctx) =>
            [
              "/sign-in/email",
              "/two-factor/verify-totp",
              "/two-factor/verify-backup-code",
            ].includes(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            const proof =
              ctx.path === "/sign-in/email"
                ? (ctx.context as RequestState)[primaryProof]
                : created?.user;
            if (!proof) return;
            const stale = await db.transaction(async (tx) => {
              // Run after the MFA plugin has created its challenge/session. This lock
              // orders the final decision against custom recovery/management writes.
              const [current] = await tx
                .select()
                .from(authUser)
                .where(eq(authUser.id, proof.id))
                .for("share");
              if (
                current &&
                current.updatedAt.getTime() === proof.updatedAt.getTime() &&
                current.twoFactorEnabled === (proof.twoFactorEnabled === true)
              )
                return false;
              if (created)
                await tx.delete(authSession).where(eq(authSession.token, created.session.token));
              await tx.delete(authVerification).where(eq(authVerification.value, proof.id));
              return true;
            });
            if (!stale) return;
            deleteSessionCookie(ctx, true);
            expireCookie(ctx, ctx.context.createAuthCookie("two_factor"));
            ctx.context.setNewSession(null);
            throw new APIError("UNAUTHORIZED", {
              code: "SIGN_IN_RESTART_REQUIRED",
              message: "Your account changed while signing in. Please sign in again.",
            });
          }),
        },
      ],
    },
  };
}
