import { eq } from "drizzle-orm";
import {
  backendErrorResponse,
  getAuthenticatedUser,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { isConversationMember } from "@/lib/server/conversations";
import { authUser, conversationMembers, devices } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ conversationId: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { conversationId } = await context.params;
    if (!uuidPattern.test(conversationId)) {
      return Response.json({ message: "We couldn’t find that conversation. Refresh the page and try again." }, { status: 400 });
    }
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id))) {
      return Response.json({ message: "Conversation not found." }, { status: 404 });
    }
    const rows = await db
      .select({
        userId: authUser.id,
        userName: authUser.name,
        deviceId: devices.id,
        deviceName: devices.name,
        agreementKey: devices.agreementKey,
        signingKey: devices.signingKey,
        revokedAt: devices.revokedAt,
      })
      .from(conversationMembers)
      .innerJoin(authUser, eq(authUser.id, conversationMembers.userId))
      .innerJoin(devices, eq(devices.userId, conversationMembers.userId))
      .where(eq(conversationMembers.conversationId, conversationId))
      .orderBy(authUser.name, devices.createdAt);

    return Response.json(
      { devices: rows.map(({ revokedAt, ...device }) => ({ ...device, revoked: revokedAt !== null })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}

