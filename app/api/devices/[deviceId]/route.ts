import { and, eq, isNull, ne, sql } from "drizzle-orm";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedSession,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { authSession, authUser, devices } from "@/lib/server/schema";
import { accountDeviceDirectory } from "@/lib/server/device-trust";
import { checkDeviceRemoval } from "@/crypto/src/account-trust";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ deviceId: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { deviceId } = await context.params;
    if (!uuidPattern.test(deviceId)) {
      return Response.json(
        { message: "We couldn’t find that device. Refresh the page and try again." },
        { status: 400 },
      );
    }
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const parsed = await readJsonBody(request, 4096);
    if (
      !parsed.ok ||
      !parsed.body ||
      typeof parsed.body !== "object" ||
      (parsed.body as { deviceId?: unknown }).deviceId !== deviceId
    )
      return Response.json(
        { message: "Approve this device before removing another device." },
        { status: 403 },
      );

    const { db } = getDatabase();
    const didRevoke = await db.transaction(async (tx) => {
      await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.id, session.user.id))
        .for("update");
      const [live] = await tx
        .select({ id: authSession.id })
        .from(authSession)
        .where(
          and(
            eq(authSession.id, session.session.id),
            eq(authSession.userId, session.user.id),
            sql`${authSession.expiresAt} > now()`,
          ),
        )
        .for("update");
      if (!live) return false;
      const directory = await accountDeviceDirectory([session.user.id], tx);
      if (!(await checkDeviceRemoval(parsed.body, directory))) return false;
      const revoked = await tx
        .update(devices)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(devices.id, deviceId),
            eq(devices.userId, session.user.id),
            isNull(devices.revokedAt),
          ),
        )
        .returning({ id: devices.id });
      if (revoked.length === 0) return false;

      await tx
        .delete(authSession)
        .where(
          and(eq(authSession.userId, session.user.id), ne(authSession.id, session.session.id)),
        );
      return true;
    });
    if (!didRevoke) {
      return Response.json({ message: "That device isn’t on your account." }, { status: 404 });
    }
    return Response.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
