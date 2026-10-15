import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import {
  getAuthenticatedSession,
  unauthorizedResponse,
  backendErrorResponse,
  trustedBrowserOrigin,
  forbiddenOriginResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import {
  authSession,
  authUser,
  memberships,
  conversations,
  conversationMembers,
  groupPhotos,
} from "@/lib/server/schema";
import { acquirePhotoProcessing, encodeProfilePhoto } from "@/lib/server/profile-photos";
import { maxProfilePhotoUploadBytes, ProfilePhotoError } from "@/lib/profile/photos";
import { readBoundedStream } from "@/lib/messaging/bounded-stream";
import { groupPhotoUrl } from "@/lib/messaging/groups";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { isCallId } from "@/lib/messaging/call-signatures";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ conversationId: string }> };
const fail = () => Response.json({ message: "Group photo isn’t available." }, { status: 404 });
export async function GET(request: Request, context: Context) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const { conversationId } = await context.params;
    if (!isCallId(conversationId)) return fail();
    const { db } = getDatabase();
    const [photo] = await db
      .select({ image: groupPhotos.image, version: groupPhotos.version })
      .from(groupPhotos)
      .innerJoin(conversations, eq(conversations.id, groupPhotos.conversationId))
      .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.id, conversationId),
          isNotNull(conversations.groupName),
          eq(conversationMembers.userId, session.user.id),
          isNull(conversationMembers.leftAt),
        ),
      )
      .limit(1);
    if (!photo || new URL(request.url).searchParams.get("v") !== photo.version) return fail();
    return new Response(new Uint8Array(photo.image), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
async function changePhoto(request: Request, context: Context, remove: boolean) {
  let release: (() => void) | null = null;
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  let image: Buffer | undefined;
  try {
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const { conversationId } = await context.params;
    if (!isCallId(conversationId)) return fail();
    const { db } = getDatabase();
    const [owner] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.groupOwnerId, session.user.id),
          eq(conversationMembers.userId, session.user.id),
          isNull(conversationMembers.leftAt),
        ),
      )
      .limit(1);
    if (!owner) return fail();
    const limit = await consumeRateLimit(db, `group-photo:${session.user.id}`, {
      max: 20,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    if (!remove) {
      const type = request.headers.get("content-type")?.split(";")[0].toLowerCase().trim();
      if (
        !type ||
        !["image/jpeg", "image/png", "image/webp"].includes(type) ||
        request.headers.has("content-encoding") ||
        !request.body
      )
        return Response.json({ message: "Choose a JPG, PNG, or WebP photo." }, { status: 415 });
      const length = request.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxProfilePhotoUploadBytes))
        return Response.json({ message: "Choose a smaller photo." }, { status: 413 });
      release = acquirePhotoProcessing();
      if (!release) return rateLimitedResponse(3);
      bytes = await readBoundedStream(request.body, {
        maxBytes: maxProfilePhotoUploadBytes,
        timeoutMs: 10_000,
        signal: request.signal,
      });
      image = await encodeProfilePhoto(bytes);
    }
    const stored = image;
    const version = crypto.randomUUID();
    const saved = await db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update");
      if (!group?.groupName || group.groupOwnerId !== session.user.id) return false;
      await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.id, session.user.id))
        .for("no key update");
      const [active] = await tx
        .select()
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, session.user.id),
            isNull(conversationMembers.leftAt),
          ),
        );
      const [access] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, session.user.id), eq(memberships.status, "approved")));
      const [live] = await tx
        .select()
        .from(authSession)
        .where(and(eq(authSession.id, session.session.id), gt(authSession.expiresAt, new Date())));
      if (!active || !access || !live) return false;
      if (remove)
        await tx.delete(groupPhotos).where(eq(groupPhotos.conversationId, conversationId));
      else if (stored)
        await tx
          .insert(groupPhotos)
          .values({ conversationId, version, image: stored })
          .onConflictDoUpdate({
            target: groupPhotos.conversationId,
            set: { version, image: stored, updatedAt: new Date() },
          });
      return true;
    });
    if (!saved) return fail();
    return Response.json(
      { image: remove ? null : groupPhotoUrl(conversationId, version) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ProfilePhotoError || error instanceof RangeError)
      return Response.json(
        { message: error instanceof ProfilePhotoError ? error.message : "Choose a smaller photo." },
        { status: 400 },
      );
    return backendErrorResponse(error);
  } finally {
    release?.();
    bytes?.fill(0);
    image?.fill(0);
  }
}
export const PUT = (request: Request, context: Context) => changePhoto(request, context, false);
export const DELETE = (request: Request, context: Context) => changePhoto(request, context, true);
