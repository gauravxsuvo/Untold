import "server-only";
import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { getDatabase } from "./database";
import {
  authUser,
  callLinks,
  callParticipants,
  callRooms,
  calls,
  conversationMembers,
  memberships,
} from "./schema";
import { accountDeviceDirectory } from "./device-trust";
import type { GroupCallSnapshot } from "@/lib/messaging/group-call-types";
import { maxCallDurationMs } from "@/lib/messaging/call-policy";
import type { PublicDevice } from "@/crypto/src/protocol";
export type CallTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["db"]["transaction"]>[0]
>[0];

export async function hasGroupCall(
  db: Pick<CallTransaction, "select">,
  userIds: string[],
  excludingRoom?: string,
) {
  const [busy] = await db
    .select({ id: callRooms.id })
    .from(callParticipants)
    .innerJoin(callRooms, eq(callRooms.id, callParticipants.roomId))
    .where(
      and(
        inArray(callParticipants.userId, userIds),
        eq(callParticipants.status, "joined"),
        gt(callParticipants.seenAt, new Date(Date.now() - 60_000)),
        eq(callRooms.status, "active"),
        gt(callRooms.expiresAt, new Date()),
        excludingRoom ? ne(callRooms.id, excludingRoom) : undefined,
      ),
    )
    .limit(1);
  return Boolean(busy);
}
export async function hasDirectCall(db: CallTransaction, userId: string) {
  const [busy] = await db
    .select({ id: calls.id })
    .from(calls)
    .where(
      and(
        or(eq(calls.callerId, userId), eq(calls.calleeId, userId)),
        ne(calls.status, "ended"),
        gt(calls.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(busy);
}

export async function removeRoomParticipant(
  db: CallTransaction,
  roomId: string,
  userId: string,
  status = "left",
) {
  await db
    .update(callParticipants)
    .set({ status, sharing: false, muted: false, cameraOff: false, connectedAt: null })
    .where(and(eq(callParticipants.roomId, roomId), eq(callParticipants.userId, userId)));
  await db
    .delete(callLinks)
    .where(
      and(
        eq(callLinks.roomId, roomId),
        or(eq(callLinks.lowerUserId, userId), eq(callLinks.upperUserId, userId)),
      ),
    );
}
export async function revokeCallAccess(db: CallTransaction, userId: string, deviceId?: string) {
  await db
    .update(calls)
    .set({ status: "ended", offer: null, answer: null, endReason: "revoked", endedAt: new Date() })
    .where(
      and(
        ne(calls.status, "ended"),
        or(
          and(
            eq(calls.callerId, userId),
            deviceId ? eq(calls.callerDeviceId, deviceId) : undefined,
          ),
          and(
            eq(calls.calleeId, userId),
            deviceId ? eq(calls.calleeDeviceId, deviceId) : undefined,
          ),
        ),
      ),
    );
  const affected = await db
    .select({ roomId: callParticipants.roomId })
    .from(callParticipants)
    .where(
      and(
        eq(callParticipants.userId, userId),
        deviceId ? eq(callParticipants.deviceId, deviceId) : undefined,
        or(eq(callParticipants.status, "joined"), eq(callParticipants.status, "invited")),
      ),
    );
  for (const p of affected) await removeRoomParticipant(db, p.roomId, userId);
}
export async function closeRoom(db: CallTransaction, roomId: string) {
  await db
    .update(callRooms)
    .set({ status: "ended", expiresAt: sql`least(${callRooms.expiresAt}, now())` })
    .where(eq(callRooms.id, roomId));
  await db
    .update(callParticipants)
    .set({ status: "left", sharing: false })
    .where(and(eq(callParticipants.roomId, roomId), eq(callParticipants.status, "joined")));
  await db.delete(callLinks).where(eq(callLinks.roomId, roomId));
}

// Called with the conversation, room and account locks held. Every read/action
// drops removed people, revoked devices and silent participants before SDP is returned.
export async function pruneRoom(
  db: CallTransaction,
  room: typeof callRooms.$inferSelect,
  access?: { memberIds: string[]; directory: PublicDevice[] },
) {
  if (
    room.status === "ended" ||
    room.expiresAt.getTime() <= Date.now() ||
    room.createdAt.getTime() + maxCallDurationMs <= Date.now()
  ) {
    await closeRoom(db, room.id);
    return false;
  }
  const participants = await db
    .select()
    .from(callParticipants)
    .where(eq(callParticipants.roomId, room.id));
  const members = access
    ? access.memberIds.map((id) => ({ id }))
    : await db
        .select({ id: conversationMembers.userId })
        .from(conversationMembers)
        .innerJoin(memberships, eq(memberships.userId, conversationMembers.userId))
        .where(
          and(
            eq(conversationMembers.conversationId, room.conversationId),
            isNull(conversationMembers.leftAt),
            eq(memberships.status, "approved"),
          ),
        );
  const allowed = new Set(members.map((m) => m.id));
  const directory = access
    ? access.directory
    : members.length
      ? await accountDeviceDirectory(
          members.map((m) => m.id),
          db,
        )
      : [];
  let joined = 0;
  for (const p of participants) {
    const invalid =
      !allowed.has(p.userId) ||
      (p.status === "joined" &&
        (!p.seenAt ||
          p.seenAt.getTime() < Date.now() - 60_000 ||
          !directory.some(
            (d) => d.userId === p.userId && d.deviceId === p.deviceId && d.approved && !d.revoked,
          )));
    if (invalid && (p.status === "joined" || p.status === "invited"))
      await removeRoomParticipant(db, room.id, p.userId);
    else if (p.status === "joined") joined++;
  }
  if (!joined) {
    await closeRoom(db, room.id);
    return false;
  }
  return true;
}

export async function roomSnapshot(
  db: CallTransaction,
  roomId: string,
  viewerId: string,
  deviceId: string,
  instanceId?: string,
): Promise<GroupCallSnapshot> {
  const [room] = await db.select().from(callRooms).where(eq(callRooms.id, roomId));
  const participants = await db
    .select({
      userId: callParticipants.userId,
      name: authUser.name,
      deviceId: callParticipants.deviceId,
      instanceId: callParticipants.instanceId,
      status: callParticipants.status,
      sharing: callParticipants.sharing,
      muted: callParticipants.muted,
      cameraOff: callParticipants.cameraOff,
    })
    .from(callParticipants)
    .innerJoin(authUser, eq(authUser.id, callParticipants.userId))
    .where(eq(callParticipants.roomId, roomId));
  const own = participants.find((p) => p.userId === viewerId);
  const links =
    own?.status === "joined" && own.deviceId === deviceId && own.instanceId === instanceId
      ? await db
          .select()
          .from(callLinks)
          .where(
            and(
              eq(callLinks.roomId, roomId),
              or(eq(callLinks.lowerUserId, viewerId), eq(callLinks.upperUserId, viewerId)),
            ),
          )
      : [];
  return {
    id: room.id,
    conversationId: room.conversationId,
    name: "Group call",
    kind: room.kind as "voice" | "video",
    status: room.status as "active" | "ended",
    createdAt: room.createdAt.toISOString(),
    ringUntil: room.ringUntil.toISOString(),
    expiresAt: room.expiresAt.toISOString(),
    participants: participants as GroupCallSnapshot["participants"],
    links,
  };
}
