import { and, eq, isNull } from "drizzle-orm";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedUser,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { devices } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicKeyPattern = /^[A-Za-z0-9_-]{80,256}$/;
const maxDevicesPerAccount = 8;

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();

    const parsed = await readJsonBody(request, 4 * 1024);
    if (!parsed.ok) return Response.json({ message: "We couldn’t set up this browser. Refresh the page and try again." }, { status: parsed.status });
    const input = parsed.body as {
      deviceId?: unknown;
      name?: unknown;
      agreementKey?: unknown;
      signingKey?: unknown;
    } | null;
    if (
      !input ||
      typeof input.deviceId !== "string" ||
      !uuidPattern.test(input.deviceId) ||
      typeof input.name !== "string" ||
      input.name.length < 1 ||
      input.name.length > 80 ||
      typeof input.agreementKey !== "string" ||
      !publicKeyPattern.test(input.agreementKey) ||
      typeof input.signingKey !== "string" ||
      !publicKeyPattern.test(input.signingKey)
    ) {
      return Response.json({ message: "We couldn’t set up this browser. Refresh the page and try again." }, { status: 400 });
    }

    const { db } = getDatabase();
    const accountDevices = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, user.id), isNull(devices.revokedAt)));
    if (
      accountDevices.length >= maxDevicesPerAccount &&
      !accountDevices.some(({ id }) => id === input.deviceId)
    ) {
      return Response.json(
        { message: `This account already has ${maxDevicesPerAccount} devices. Remove an old device in Settings first.` },
        { status: 409 },
      );
    }
    await db
      .insert(devices)
      .values({
        id: input.deviceId,
        userId: user.id,
        name: input.name.trim(),
        agreementKey: input.agreementKey,
        signingKey: input.signingKey,
      })
      .onConflictDoNothing({ target: devices.id });
    const [device] = await db
      .select({
        id: devices.id,
        userId: devices.userId,
        name: devices.name,
        agreementKey: devices.agreementKey,
        signingKey: devices.signingKey,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.id, input.deviceId))
      .limit(1);

    if (
      !device ||
      device.userId !== user.id ||
      device.revokedAt !== null ||
      device.agreementKey !== input.agreementKey ||
      device.signingKey !== input.signingKey
    ) {
      if (device?.userId === user.id && device.revokedAt !== null) {
        return Response.json(
          {
            code: "device_revoked",
            message:
              "This browser was removed from your account. Sign in from a new browser to continue. Older messages may not be readable there.",
          },
          { status: 409 },
        );
      }
      return Response.json(
        { message: "We couldn’t recognize this browser. Keep your browser data and try another browser to continue." },
        { status: 409 },
      );
    }

    return Response.json(
      { device },
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
    const { db } = getDatabase();
    const rows = await db
      .select({
        deviceId: devices.id,
        deviceName: devices.name,
        agreementKey: devices.agreementKey,
        signingKey: devices.signingKey,
        createdAt: devices.createdAt,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.userId, user.id));
    return Response.json({ devices: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
