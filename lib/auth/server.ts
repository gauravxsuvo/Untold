import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { getDatabase, BackendConfigurationError } from "@/lib/server/database";
import { getAuthEnvironmentIssues } from "@/lib/server/portways-config";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
} from "@/lib/server/schema";

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
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
        rateLimit: authRateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 15,
      maxPasswordLength: 128,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
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
