import { and, eq, isNull, sql } from "drizzle-orm";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedSession,
  getAuthenticatedUser,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { accountIdentities, authSession, authUser, devices } from "@/lib/server/schema";
import { accountDeviceDirectory } from "@/lib/server/device-trust";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicKeyPattern = /^[A-Za-z0-9_-]{80,256}$/;

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const user = session.user;
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const parsed = await readJsonBody(request, 4096);
    const input = parsed.ok ? (parsed.body as Record<string, unknown> | null) : null;
    if (
      !input ||
      typeof input.deviceId !== "string" ||
      !uuidPattern.test(input.deviceId) ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 80 ||
      typeof input.agreementKey !== "string" ||
      !publicKeyPattern.test(input.agreementKey) ||
      typeof input.signingKey !== "string" ||
      !publicKeyPattern.test(input.signingKey) ||
      typeof input.linkHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.linkHash)
    )
      return Response.json(
        { message: "We couldn’t set up this device. Refresh and try again." },
        { status: 400 },
      );
    try {
      await crypto.subtle.importKey(
        "spki",
        new Uint8Array(Buffer.from(input.agreementKey, "base64url")),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );
      await crypto.subtle.importKey(
        "spki",
        new Uint8Array(Buffer.from(input.signingKey, "base64url")),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
    } catch {
      return Response.json(
        { message: "This device couldn’t be recognized. Try again." },
        { status: 400 },
      );
    }
    const { db } = getDatabase();
    const budget = await consumeRateLimit(db, `device-register:${user.id}`, {
      max: 120,
      windowSeconds: 3600,
    });
    if (!budget.allowed) return rateLimitedResponse(budget.retryAfterSeconds);
    const deviceId = input.deviceId,
      agreementKey = input.agreementKey,
      signingKey = input.signingKey,
      linkHash = input.linkHash,
      name = input.name.trim();
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.id, user.id))
        .for("update");
      const [live] = await tx
        .select({ id: authSession.id })
        .from(authSession)
        .where(
          and(
            eq(authSession.id, session.session.id),
            eq(authSession.userId, user.id),
            sql`${authSession.expiresAt} > now()`,
          ),
        )
        .for("update");
      if (!live) return "signed-out";
      const existing = await tx.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
      if (
        existing[0] &&
        (existing[0].userId !== user.id ||
          existing[0].revokedAt ||
          existing[0].agreementKey !== agreementKey ||
          existing[0].signingKey !== signingKey)
      )
        return "removed";
      if (existing[0]) await tx.update(devices).set({ name }).where(eq(devices.id, deviceId));
      const active = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.userId, user.id), isNull(devices.revokedAt)));
      if (active.length >= 8 && !active.some((d) => d.id === deviceId)) return "limit";
      await tx
        .insert(devices)
        .values({
          id: deviceId,
          userId: user.id,
          name,
          agreementKey,
          signingKey,
          linkHash,
          linkExpiresAt: new Date(Date.now() + 15 * 60_000),
        })
        .onConflictDoNothing({ target: devices.id });
      let [identity] = await tx
        .select()
        .from(accountIdentities)
        .where(eq(accountIdentities.userId, user.id));
      if (!identity) {
        const [first] = await tx
          .select()
          .from(devices)
          .where(and(eq(devices.userId, user.id), isNull(devices.revokedAt)))
          .orderBy(devices.createdAt, devices.id)
          .limit(1);
        if (!first) return "removed";
        await tx
          .insert(accountIdentities)
          .values({
            userId: user.id,
            deviceId: first.id,
            agreementKey: first.agreementKey,
            signingKey: first.signingKey,
          })
          .onConflictDoNothing();
        [identity] = await tx
          .select()
          .from(accountIdentities)
          .where(eq(accountIdentities.userId, user.id));
      }
      if (existing[0] && !existing[0].approval && identity.deviceId !== deviceId) {
        if (
          existing[0].linkHash !== linkHash ||
          !existing[0].linkExpiresAt ||
          existing[0].linkExpiresAt.getTime() <= Date.now()
        ) {
          await tx
            .update(devices)
            .set({ linkHash, linkExpiresAt: new Date(Date.now() + 15 * 60_000) })
            .where(eq(devices.id, deviceId));
        }
      }
      return "ok";
    });
    if (result === "signed-out") return unauthorizedResponse();
    if (result === "limit")
      return Response.json(
        { message: "Your account already has 8 devices. Remove an old device in Settings first." },
        { status: 409 },
      );
    if (result !== "ok")
      return Response.json(
        {
          code: "device_revoked",
          message: "This device was removed. Open Settings to recover access on a new device.",
        },
        { status: 409 },
      );
    return Response.json(
      { status: true },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    const directory = await accountDeviceDirectory([user.id]);
    const { db } = getDatabase();
    const dates = await db
      .select({ id: devices.id, createdAt: devices.createdAt, revokedAt: devices.revokedAt })
      .from(devices)
      .where(eq(devices.userId, user.id));
    return Response.json(
      {
        devices: directory.map((device) => {
          const date = dates.find((row) => row.id === device.deviceId);
          return {
            ...device,
            createdAt: date?.createdAt.toISOString(),
            revokedAt: date?.revokedAt?.toISOString() ?? null,
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
