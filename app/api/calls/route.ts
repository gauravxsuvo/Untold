import { and, desc, eq, gt, inArray, lt, ne, or, isNull } from "drizzle-orm";
import {
  getAuthenticatedUser,
  getAuthenticatedSession,
  unauthorizedResponse,
  backendErrorResponse,
  trustedBrowserOrigin,
  forbiddenOriginResponse,
  readJsonBody,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import {
  authUser,
  calls,
  conversationMembers,
  conversations,
  memberships,
  authSession,
} from "@/lib/server/schema";
import { accountDeviceDirectory } from "@/lib/server/device-trust";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import {
  isCallId,
  validCallDescription,
  verifyCallDescription,
} from "@/lib/messaging/call-signatures";
import { callingEnabled } from "@/lib/server/call-config";
import { maxCallDurationMs } from "@/lib/messaging/call-policy";
import { after } from "next/server";
import { notifyIncomingCall } from "@/lib/server/call-push";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const fail = (message: string, status = 400) =>
  Response.json({ message }, { status, headers: noStore });
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!callingEnabled())
      return Response.json({ call: null, enabled: false }, { headers: noStore });
    const { db } = getDatabase();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const deviceId = url.searchParams.get("deviceId");
    if ((id && !isCallId(id)) || !isCallId(deviceId)) return fail("Refresh Untold to check calls.");
    const limit = await consumeRateLimit(db, `call-poll:${user.id}`, {
      max: 300,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    const device = (await accountDeviceDirectory([user.id])).find(
      (d) => d.deviceId === deviceId && d.approved && !d.revoked,
    );
    if (!device) return fail("Approve this device in Settings before calling.", 403);
    const [call] = await db
      .select()
      .from(calls)
      .where(
        and(
          or(eq(calls.callerId, user.id), eq(calls.calleeId, user.id)),
          id ? eq(calls.id, id) : and(ne(calls.status, "ended"), gt(calls.expiresAt, new Date())),
        ),
      )
      .orderBy(desc(calls.createdAt))
      .limit(1);
    if (!call)
      return Response.json({ call: null, enabled: callingEnabled() }, { headers: noStore });
    // Other tabs/devices may ring, but never receive an established call's SDP.
    const mine = call.callerId === user.id ? call.callerDeviceId : call.calleeDeviceId;
    if (mine && mine !== deviceId)
      return Response.json({ call: null, enabled: callingEnabled() }, { headers: noStore });
    const [peer] = await db
      .select({ name: authUser.name })
      .from(authUser)
      .where(eq(authUser.id, call.callerId === user.id ? call.calleeId : call.callerId))
      .limit(1);
    const peerSeen = call.callerId === user.id ? call.calleeSeenAt : call.callerSeenAt;
    const ended =
      call.expiresAt <= new Date() ||
      call.status === "ended" ||
      (call.status === "active" && (!peerSeen || peerSeen.getTime() < Date.now() - 60_000));
    if (ended && call.status !== "ended")
      await db
        .update(calls)
        .set({ status: "ended", offer: null, answer: null })
        .where(eq(calls.id, call.id));
    return Response.json(
      {
        call: {
          ...call,
          status: ended ? "ended" : call.status,
          offer: ended ? null : call.offer,
          answer: ended ? null : call.answer,
          peerName: peer?.name ?? "Your contact",
        },
        enabled: callingEnabled(),
      },
      { headers: noStore },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const user = session.user;
    const parsed = await readJsonBody(request, 60_000);
    if (!parsed.ok) return fail("Call setup couldn’t be completed.", parsed.status);
    const body = parsed.body as {
      action?: unknown;
      id?: unknown;
      deviceId?: unknown;
      description?: unknown;
    } | null;
    if (
      !body ||
      !isCallId(body.id) ||
      !isCallId(body.deviceId) ||
      !["start", "answer", "end", "heartbeat"].includes(String(body.action))
    )
      return fail("Call setup couldn’t be completed.");
    const id = body.id,
      deviceId = body.deviceId,
      action = String(body.action);
    const description = body.description;
    const { db } = getDatabase();
    const limit = await consumeRateLimit(
      db,
      `${action === "start" ? "call-start" : "call-action"}:${user.id}`,
      action === "start" ? { max: 20, windowSeconds: 3600 } : { max: 120, windowSeconds: 60 },
    );
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    if (
      (action === "start" || action === "answer") &&
      (!callingEnabled() ||
        !validCallDescription(description) ||
        description.callId !== id ||
        description.deviceId !== deviceId ||
        description.senderId !== user.id ||
        description.type !== (action === "start" ? "offer" : "answer"))
    )
      return fail("Calls aren’t available right now. Please try again later.", 409);
    const known =
      action !== "start"
        ? (
            await db
              .select()
              .from(calls)
              .where(
                and(eq(calls.id, id), or(eq(calls.callerId, user.id), eq(calls.calleeId, user.id))),
              )
              .limit(1)
          )[0]
        : null;
    if (action !== "start" && !known) return fail("This call is no longer available.", 404);
    let participants: string[];
    if (action === "start" && validCallDescription(description)) {
      const members = await db
        .select({ id: conversationMembers.userId })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .where(
          and(
            eq(conversationMembers.conversationId, description.conversationId),
            isNull(conversationMembers.leftAt),
            isNull(conversations.groupName),
          ),
        );
      if (members.length !== 2 || !members.some((m) => m.id === user.id))
        return fail("Open a conversation before calling.", 403);
      participants = members.map((m) => m.id).sort();
    } else if (known) {
      participants = [known.callerId, known.calleeId].sort();
    } else return fail("This call is no longer available.", 404);
    const response = await db.transaction(async (tx) => {
      // Shared user locks serialize simultaneous calls, device removal and admin decisions.
      await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(inArray(authUser.id, participants))
        .orderBy(authUser.id)
        .for("no key update");
      const [live] = await tx
        .select({ id: authSession.id })
        .from(authSession)
        .where(
          and(
            eq(authSession.id, session.session.id),
            eq(authSession.userId, user.id),
            gt(authSession.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!live) return unauthorizedResponse();
      const allowed = await tx
        .select()
        .from(memberships)
        .where(and(inArray(memberships.userId, participants), eq(memberships.status, "approved")));
      // A pinned bootstrap admin is materialized as approved by accountAccess.
      if (allowed.length !== 2) return fail("This contact isn’t available for calls.", 403);
      const directory = await accountDeviceDirectory(participants, tx);
      const local = directory.find(
        (d) => d.userId === user.id && d.deviceId === deviceId && d.approved && !d.revoked,
      );
      if (!local) return fail("Approve this device in Settings before calling.", 403);
      if (
        (action === "start" || action === "answer") &&
        (!validCallDescription(description) || !(await verifyCallDescription(description, local)))
      )
        return fail("Call setup couldn’t be verified. Refresh and try again.", 403);
      const now = new Date();
      // Erase expired connection descriptions. Media is never stored here.
      await tx
        .update(calls)
        .set({ status: "ended", offer: null, answer: null })
        .where(
          and(
            or(inArray(calls.callerId, participants), inArray(calls.calleeId, participants)),
            lt(calls.expiresAt, now),
            ne(calls.status, "ended"),
          ),
        );
      if (action === "start" && validCallDescription(description)) {
        const [busy] = await tx
          .select({ id: calls.id })
          .from(calls)
          .where(
            and(
              or(inArray(calls.callerId, participants), inArray(calls.calleeId, participants)),
              ne(calls.status, "ended"),
              gt(calls.expiresAt, now),
            ),
          )
          .limit(1);
        if (busy)
          return fail("You or your contact is already in a call. Try again in a moment.", 409);
        if (!directory.some((d) => d.userId !== user.id && d.approved && !d.revoked))
          return fail("Your contact needs to approve a device first.", 409);
        const calleeId = participants.find((p) => p !== user.id);
        if (!calleeId) return fail("Choose a contact to call.");
        await tx.insert(calls).values({
          id,
          conversationId: description.conversationId,
          callerId: user.id,
          calleeId,
          callerDeviceId: deviceId,
          kind: description.kind,
          offer: description,
          expiresAt: new Date(Date.now() + 75_000),
        });
        return Response.json({ ok: true }, { headers: noStore });
      }
      const [call] = await tx.select().from(calls).where(eq(calls.id, id)).limit(1);
      if (!call || call.status === "ended" || call.expiresAt <= now)
        return fail("This call has ended.", 409);
      if (
        !directory.some((d) => d.deviceId === call.callerDeviceId && d.approved && !d.revoked) ||
        (call.calleeDeviceId &&
          !directory.some((d) => d.deviceId === call.calleeDeviceId && d.approved && !d.revoked))
      ) {
        await tx
          .update(calls)
          .set({ status: "ended", offer: null, answer: null })
          .where(eq(calls.id, id));
        return fail("A device is no longer approved. This call has ended.", 409);
      }
      const mine = call.callerId === user.id ? call.callerDeviceId : call.calleeDeviceId;
      if (mine && mine !== deviceId) return fail("This call is open on another device.", 409);
      if (action === "answer" && validCallDescription(description)) {
        if (
          call.calleeId !== user.id ||
          call.status !== "ringing" ||
          description.conversationId !== call.conversationId ||
          description.kind !== call.kind
        )
          return fail("This call was already answered or ended.", 409);
        await tx
          .update(calls)
          .set({
            status: "active",
            calleeDeviceId: deviceId,
            answer: description,
            calleeSeenAt: now,
            expiresAt: new Date(Date.now() + 60_000),
          })
          .where(eq(calls.id, id));
      } else if (action === "end") {
        await tx
          .update(calls)
          .set({ status: "ended", offer: null, answer: null, expiresAt: now })
          .where(eq(calls.id, id));
      } else if (action === "heartbeat") {
        const caller = call.callerId === user.id;
        const seen = caller ? { callerSeenAt: now } : { calleeSeenAt: now };
        if (call.status === "ringing") {
          if (caller) await tx.update(calls).set(seen).where(eq(calls.id, id));
          return Response.json({ ok: true }, { headers: noStore });
        }
        const peerSeen = caller ? call.calleeSeenAt : call.callerSeenAt;
        if (!peerSeen || peerSeen.getTime() < Date.now() - 60_000) {
          await tx
            .update(calls)
            .set({ status: "ended", offer: null, answer: null })
            .where(eq(calls.id, id));
          return fail("The connection was lost. Please call again.", 409);
        }
        const hardExpiry = call.createdAt.getTime() + maxCallDurationMs;
        await tx
          .update(calls)
          .set({ ...seen, expiresAt: new Date(Math.min(peerSeen.getTime() + 60_000, hardExpiry)) })
          .where(eq(calls.id, id));
      }
      return Response.json({ ok: true }, { headers: noStore });
    });
    if (action === "start" && response.ok)
      after(async () => {
        try {
          await notifyIncomingCall(id);
        } catch {
          /* Foreground polling remains available. */
        }
      });
    return response;
  } catch (error) {
    return backendErrorResponse(error);
  }
}
