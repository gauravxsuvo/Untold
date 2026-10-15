import { eq } from "drizzle-orm";
import {
  backendErrorResponse,
  getAuthenticatedUser,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { isConversationMember } from "@/lib/server/conversations";
import { conversationMembers } from "@/lib/server/schema";
import { accountDeviceDirectory } from "@/lib/server/device-trust";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ conversationId: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    if (!uuidPattern.test(conversationId))
      return Response.json({ message: "Conversation not found." }, { status: 400 });
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    const { db } = getDatabase();
    if (!(await isConversationMember(db, conversationId, user.id)))
      return Response.json({ message: "Conversation not found." }, { status: 404 });
    const members = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId));
    const directory = await accountDeviceDirectory(members.map((member) => member.userId));
    return Response.json(
      {
        devices: directory.map(({ linkHash: _hash, linkExpiresAt: _expires, ...device }) => device),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
