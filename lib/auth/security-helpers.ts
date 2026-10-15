import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricDecrypt, type SecretConfig } from "better-auth/crypto";
import { and, eq, lte } from "drizzle-orm";
import type { getDatabase } from "@/lib/server/database";
import { authUsedTotp } from "@/lib/server/schema";

type Database = ReturnType<typeof getDatabase>["db"];
type Writer = Pick<Database, "insert" | "delete">;

export function createRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const value = randomBytes(16).toString("hex");
    return `${value.slice(0, 8)}-${value.slice(8, 16)}-${value.slice(16, 24)}-${value.slice(24)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase();
}

export function recoveryCodeIsValidFormat(code: string): boolean {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/.test(code);
}

export async function readRecoveryCodes(
  encrypted: string,
  key: string | SecretConfig,
): Promise<string[]> {
  const parsed: unknown = JSON.parse(await symmetricDecrypt({ key, data: encrypted }));
  if (
    !Array.isArray(parsed) ||
    parsed.length > 10 ||
    parsed.some((code) => typeof code !== "string" || !recoveryCodeIsValidFormat(code))
  ) {
    throw new Error("Invalid recovery data");
  }
  return parsed;
}

export function recoveryCodeMatches(codes: string[], code: string): boolean {
  // Compare fixed-size buffers, including when no codes remain.
  const candidate = Buffer.from(code.padEnd(35, " ").slice(0, 35));
  let matched = false;
  for (const value of codes.length ? codes : [" ".repeat(35)]) {
    matched = timingSafeEqual(Buffer.from(value), candidate) || matched;
  }
  return matched && codes.length > 0 && recoveryCodeIsValidFormat(code);
}

export function securityFingerprint(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`${purpose}\0${value}`).digest("hex");
}

export async function consumeTotpCode(
  db: Writer,
  userId: string,
  encryptedSecret: string,
  code: string,
  key: string | SecretConfig,
  fingerprintSecret: string,
): Promise<"invalid" | "used" | "valid"> {
  if (!/^\d{6}$/.test(code)) return "invalid";
  const secret = await symmetricDecrypt({ key, data: encryptedSecret });
  if (!(await createOTP(secret, { digits: 6, period: 30 }).verify(code))) return "invalid";
  const now = new Date();
  await db
    .delete(authUsedTotp)
    .where(and(eq(authUsedTotp.userId, userId), lte(authUsedTotp.expiresAt, now)));
  // A code is accepted for at most 90 seconds with the +/- one period window.
  const rows = await db
    .insert(authUsedTotp)
    .values({
      userId,
      fingerprint: securityFingerprint(
        fingerprintSecret,
        "totp",
        `${userId}:${encryptedSecret}:${code}`,
      ),
      expiresAt: new Date(now.getTime() + 120_000),
    })
    .onConflictDoNothing()
    .returning({ userId: authUsedTotp.userId });
  return rows.length ? "valid" : "used";
}
