import { and, eq, isNull, ne } from "drizzle-orm";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedSession,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { authSession, devices } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ deviceId: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { deviceId } = await context.params;
    if (!uuidPattern.test(deviceId)) {
      return Response.json({ message: "We couldn’t find that device. Refresh the page and try again." }, { status: 400 });
    }
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();

    const { db } = getDatabase();
    const didRevoke = await db.transaction(async (tx) => {
      const revoked = await tx
        .update(devices)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(devices.id, deviceId),
          eq(devices.userId, session.user.id),
          isNull(devices.revokedAt),
        ))
        .returning({ id: devices.id });
      if (revoked.length === 0) return false;

      await tx
        .delete(authSession)
        .where(and(eq(authSession.userId, session.user.id), ne(authSession.id, session.session.id)));
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
