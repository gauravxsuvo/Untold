import { and, eq } from "drizzle-orm";
import {
  backendErrorResponse,
  getAuthenticatedUser,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { isConversationMember, messageAudience } from "@/lib/server/conversations";
import { conversationMembers, messageEnvelopes } from "@/lib/server/schema";
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
      .select({ userId: conversationMembers.userId, leftAt: conversationMembers.leftAt })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId));
    const visibleSenders = await db
      .selectDistinct({ userId: messageEnvelopes.senderId })
      .from(messageEnvelopes)
      .where(
        and(eq(messageEnvelopes.conversationId, conversationId), messageAudience(db, user.id)),
      );
    const visibleIds = new Set(visibleSenders.map((sender) => sender.userId));
    const directory = await accountDeviceDirectory(
      members
        .filter((member) => member.leftAt === null || visibleIds.has(member.userId))
        .map((member) => member.userId),
    );
    return Response.json(
      {
        devices: directory.map(({ linkHash: _hash, linkExpiresAt: _expires, ...device }) => ({
          ...device,
          conversationMember: members.some(
            (member) => member.userId === device.userId && member.leftAt === null,
          ),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
