import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { after } from "next/server";
import {
  getAuthenticatedSession,
  unauthorizedResponse,
  backendErrorResponse,
  forbiddenOriginResponse,
  trustedBrowserOrigin,
  readJsonBody,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import {
  authSession,
  authUser,
  callLinks,
  callParticipants,
  callRooms,
  conversations,
  conversationMembers,
  memberships,
} from "@/lib/server/schema";
import { accountDeviceDirectory } from "@/lib/server/device-trust";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { callingEnabled } from "@/lib/server/call-config";
import {
  closeRoom,
  hasDirectCall,
  hasGroupCall,
  pruneRoom,
  removeRoomParticipant,
  roomSnapshot,
} from "@/lib/server/group-calls";
import { isCallId } from "@/lib/messaging/call-signatures";
import {
  validGroupCallDescription,
  verifyGroupCallDescription,
} from "@/lib/messaging/group-call-signatures";
import { maxCallDurationMs } from "@/lib/messaging/call-policy";
import { maxGroupMembers } from "@/lib/messaging/groups";
import { notifyGroupIncomingCall } from "@/lib/server/call-push";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const fail = (message: string, status = 409) => Response.json({ message }, { status, headers });
type Input = {
  action?: unknown;
  id?: unknown;
  conversationId?: unknown;
  deviceId?: unknown;
  instanceId?: unknown;
  kind?: unknown;
  description?: unknown;
  sharing?: unknown;
  muted?: unknown;
  cameraOff?: unknown;
};

async function handle(request: Request, input: Input, write: boolean) {
  const session = await getAuthenticatedSession(request);
  if (!session) return unauthorizedResponse();
  if (!isCallId(input.deviceId))
    return fail("Approve this device in Settings before calling.", 403);
  const deviceId = input.deviceId;
  const userId = session.user.id;
  const { db } = getDatabase();
  const action = write ? String(input.action) : "read";
  if (
    write &&
    !["start", "join", "leave", "decline", "heartbeat", "signal", "end"].includes(action)
  )
    return fail("Choose a call action.", 400);
  if (write && action !== "decline" && !isCallId(input.instanceId))
    return fail("Rejoin the call to continue.", 400);
  const limit = await consumeRateLimit(
    db,
    `group-call-${action === "read" ? "poll" : action === "start" ? "start" : "action"}:${userId}`,
    action === "read"
      ? { max: 300, windowSeconds: 60 }
      : action === "start"
        ? { max: 20, windowSeconds: 3600 }
        : { max: 180, windowSeconds: 60 },
  );
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  if (!callingEnabled())
    return write
      ? fail("Calls aren’t available right now.", 503)
      : Response.json({ room: null, enabled: false }, { headers });
  if (
    (input.id != null && !isCallId(input.id)) ||
    (input.conversationId != null && !isCallId(input.conversationId))
  )
    return fail("This call isn’t available.", 400);
  let id = input.id as string | undefined;
  let conversationId = input.conversationId as string | undefined;
  if (id) {
    const [known] = await db
      .select({ conversationId: callRooms.conversationId })
      .from(callRooms)
      .innerJoin(callParticipants, eq(callParticipants.roomId, callRooms.id))
      .where(and(eq(callRooms.id, id), eq(callParticipants.userId, userId)))
      .limit(1);
    if (!known) return fail("This call isn’t available.", 404);
    conversationId = known.conversationId;
  } else if (!conversationId && action === "read") {
    const [found] = await db
      .select({ id: callRooms.id, conversationId: callRooms.conversationId })
      .from(callRooms)
      .innerJoin(callParticipants, eq(callParticipants.roomId, callRooms.id))
      .where(
        and(
          eq(callParticipants.userId, userId),
          eq(callRooms.status, "active"),
          gt(callRooms.expiresAt, new Date()),
          or(
            eq(callParticipants.status, "joined"),
            and(eq(callParticipants.status, "invited"), gt(callRooms.ringUntil, new Date())),
          ),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${callParticipants.status} = 'joined' THEN 0 ELSE 1 END`,
        desc(callRooms.createdAt),
      )
      .limit(1);
    if (!found) return Response.json({ room: null, enabled: true }, { headers });
    id = found.id;
    conversationId = found.conversationId;
  }
  if (!conversationId) return fail("Open a group before calling.", 400);
  const groupId = conversationId;
  let createdRoomId: string | null = null;
  const response = await db.transaction(async (tx) => {
    // The same order as group edits and message sends: conversation, then
    // sorted account locks. Room state is serialized by the conversation lock.
    const [group] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, groupId))
      .for("update");
    const members = await tx
      .select({ id: conversationMembers.userId })
      .from(conversationMembers)
      .where(
        and(eq(conversationMembers.conversationId, groupId), isNull(conversationMembers.leftAt)),
      );
    if (!group?.groupName || !members.some((m) => m.id === userId))
      return fail("This group call isn’t available.", 404);
    if (members.length > maxGroupMembers) return fail("This group has too many people for a call.");
    const [existing] = await tx
      .select()
      .from(callRooms)
      .where(
        and(
          eq(callRooms.conversationId, groupId),
          id ? eq(callRooms.id, id) : eq(callRooms.status, "active"),
        ),
      )
      .for("update");
    const previous = existing
      ? await tx
          .select({ id: callParticipants.userId })
          .from(callParticipants)
          .where(eq(callParticipants.roomId, existing.id))
      : [];
    const lockIds = [...new Set([...members, ...previous].map((m) => m.id))].sort();
    await tx
      .select({ id: authUser.id })
      .from(authUser)
      .where(inArray(authUser.id, lockIds))
      .orderBy(authUser.id)
      .for("no key update");
    const [live] = await tx
      .select({ id: authSession.id })
      .from(authSession)
      .where(
        and(
          eq(authSession.id, session.session.id),
          eq(authSession.userId, userId),
          gt(authSession.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const approved = await tx
      .select({ id: memberships.userId })
      .from(memberships)
      .where(
        and(
          inArray(
            memberships.userId,
            members.map((m) => m.id),
          ),
          eq(memberships.status, "approved"),
        ),
      );
    if (!live || !approved.some((m) => m.id === userId))
      return fail("Your call access changed. Sign in again to continue.", 403);
    const directory = await accountDeviceDirectory(
      approved.map((m) => m.id),
      tx,
    );
    const local = directory.find(
      (d) => d.userId === userId && d.deviceId === deviceId && d.approved && !d.revoked,
    );
    if (!local) return fail("Approve this device in Settings before calling.", 403);
    const access = { memberIds: approved.map((m) => m.id), directory };
    let room = existing && (await pruneRoom(tx, existing, access)) ? existing : null;
    if (!room && action !== "start")
      return Response.json({ room: null, enabled: true }, { headers });
    if (!room) {
      if (input.kind !== "voice" && input.kind !== "video")
        return fail("Choose a voice or video call.", 400);
      if ((await hasDirectCall(tx, userId)) || (await hasGroupCall(tx, [userId])))
        return fail("You’re already in a call on another device.");
      if (!directory.some((d) => d.userId !== userId && d.approved && !d.revoked))
        return fail("A group member needs to approve a device first.");
      const now = new Date();
      const roomId = crypto.randomUUID();
      const [created] = await tx
        .insert(callRooms)
        .values({
          id: roomId,
          conversationId: groupId,
          createdBy: userId,
          kind: input.kind,
          ringUntil: new Date(now.getTime() + 75_000),
          expiresAt: new Date(now.getTime() + 75_000),
        })
        .returning();
      await tx.insert(callParticipants).values(
        approved.map((m) => ({
          roomId,
          userId: m.id,
          status: m.id === userId ? "joined" : "invited",
          deviceId: m.id === userId ? deviceId : null,
          instanceId: m.id === userId ? (input.instanceId as string) : null,
          seenAt: m.id === userId ? now : null,
        })),
      );
      createdRoomId = roomId;
      room = created;
    } else {
      const [own] = await tx
        .select()
        .from(callParticipants)
        .where(and(eq(callParticipants.roomId, room.id), eq(callParticipants.userId, userId)));
      if (!own)
        return fail("Join the next group call. This call started before you were added.", 403);
      if (write && own.status === "joined" && own.deviceId !== deviceId)
        return fail("This call is open on another device.");
      if (
        write &&
        !["join", "start"].includes(action) &&
        own.status === "joined" &&
        own.instanceId !== input.instanceId
      )
        return fail("This call is open in another window.");
      if (action === "join" || action === "start") {
        if (action === "start" && input.kind !== room.kind)
          return fail(
            `A ${room.kind === "voice" ? "voice" : "video"} group call is already open. Open the call again to join.`,
          );
        if ((await hasDirectCall(tx, userId)) || (await hasGroupCall(tx, [userId], room.id)))
          return fail("You’re already in a call on another device.");
        // Rejoining creates fresh pair IDs, so old offers cannot be replayed.
        await removeRoomParticipant(tx, room.id, userId);
        await tx
          .update(callParticipants)
          .set({
            status: "joined",
            deviceId,
            instanceId: input.instanceId as string,
            seenAt: new Date(),
          })
          .where(and(eq(callParticipants.roomId, room.id), eq(callParticipants.userId, userId)));
        const others = await tx
          .select()
          .from(callParticipants)
          .where(and(eq(callParticipants.roomId, room.id), eq(callParticipants.status, "joined")));
        for (const p of others.filter((p) => p.userId !== userId)) {
          const [lowerUserId, upperUserId] = [userId, p.userId].sort();
          await tx
            .insert(callLinks)
            .values({ id: crypto.randomUUID(), roomId: room.id, lowerUserId, upperUserId })
            .onConflictDoNothing();
        }
        if (others.length >= 2)
          await tx
            .update(callRooms)
            .set({
              startedAt: room.startedAt ?? new Date(),
              expiresAt: new Date(
                Math.min(Date.now() + 60_000, room.createdAt.getTime() + maxCallDurationMs),
              ),
            })
            .where(eq(callRooms.id, room.id));
      } else if (action === "leave" || action === "decline") {
        if (action === "decline" && own.status === "joined")
          return fail("Leave the call to disconnect.");
        await removeRoomParticipant(
          tx,
          room.id,
          userId,
          action === "decline" ? "declined" : "left",
        );
      } else if (action === "end") {
        if (room.createdBy !== userId || own.status !== "joined")
          return fail("Only the person who started this call can end it for everyone.", 403);
        await closeRoom(tx, room.id);
      } else if (action === "heartbeat") {
        if (own.status !== "joined" || own.deviceId !== deviceId)
          return fail("This call is no longer open here.");
        if (
          [input.sharing, input.muted, input.cameraOff].some(
            (v) => v !== undefined && typeof v !== "boolean",
          )
        )
          return fail("Refresh the call and try again.", 400);
        await tx
          .update(callParticipants)
          .set({
            seenAt: new Date(),
            sharing: room.kind === "video" && input.sharing === true,
            muted: input.muted === true,
            cameraOff: input.cameraOff === true,
          })
          .where(and(eq(callParticipants.roomId, room.id), eq(callParticipants.userId, userId)));
        if (room.startedAt)
          await tx
            .update(callRooms)
            .set({
              expiresAt: new Date(
                Math.min(Date.now() + 60_000, room.createdAt.getTime() + maxCallDurationMs),
              ),
            })
            .where(eq(callRooms.id, room.id));
      } else if (action === "signal") {
        const d = input.description;
        if (
          own.status !== "joined" ||
          own.deviceId !== deviceId ||
          !validGroupCallDescription(d) ||
          d.roomId !== room.id ||
          d.conversationId !== groupId ||
          d.kind !== room.kind ||
          d.senderId !== userId ||
          d.deviceId !== deviceId ||
          !(await verifyGroupCallDescription(d, local))
        )
          return fail("The call connection couldn’t be verified.", 403);
        const [link] = await tx
          .select()
          .from(callLinks)
          .where(and(eq(callLinks.id, d.linkId), eq(callLinks.roomId, room.id)));
        const [target] = await tx
          .select()
          .from(callParticipants)
          .where(
            and(
              eq(callParticipants.roomId, room.id),
              eq(callParticipants.userId, d.targetUserId),
              eq(callParticipants.status, "joined"),
              eq(callParticipants.deviceId, d.targetDeviceId),
            ),
          );
        if (
          !link ||
          !target ||
          (d.type === "offer"
            ? link.lowerUserId !== userId || link.upperUserId !== d.targetUserId
            : link.upperUserId !== userId || link.lowerUserId !== d.targetUserId || !link.offer)
        )
          return fail("This call connection changed. Rejoin the call.");
        const previousDescription = d.type === "offer" ? link.offer : link.answer;
        if (previousDescription && previousDescription.signature !== d.signature)
          return fail("This call connection changed. Rejoin the call.");
        await tx
          .update(callLinks)
          .set(d.type === "offer" ? { offer: d } : { answer: d })
          .where(eq(callLinks.id, link.id));
      }
    }
    const [fresh] = await tx.select().from(callRooms).where(eq(callRooms.id, room.id));
    await pruneRoom(tx, fresh, access);
    const snapshot = await roomSnapshot(
      tx,
      room.id,
      userId,
      deviceId,
      typeof input.instanceId === "string" ? input.instanceId : undefined,
    );
    snapshot.name = group.groupName;
    return Response.json({ room: snapshot, enabled: true }, { headers });
  });
  if (createdRoomId && response.ok) {
    const roomId = createdRoomId;
    after(async () => {
      try {
        await notifyGroupIncomingCall(roomId);
      } catch {
        /* Foreground polling remains available. */
      }
    });
  }
  return response;
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return await handle(
      request,
      {
        id: url.searchParams.get("id") ?? undefined,
        conversationId: url.searchParams.get("conversationId") ?? undefined,
        deviceId: url.searchParams.get("deviceId") ?? undefined,
        instanceId: url.searchParams.get("instanceId") ?? undefined,
      },
      false,
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const parsed = await readJsonBody(request, 60_000);
    if (!parsed.ok) return fail("Call setup couldn’t be completed.", parsed.status);
    if (!parsed.body || typeof parsed.body !== "object") return fail("Choose a call action.", 400);
    return await handle(request, parsed.body as Input, true);
  } catch (error) {
    return backendErrorResponse(error);
  }
}
