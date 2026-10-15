import { eq } from "drizzle-orm";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedUser,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { authUser, profilePhotos } from "@/lib/server/schema";
import { consumeRateLimit, rateLimitedResponse, rateLimitRules } from "@/lib/server/rate-limit";
import { readBoundedStream } from "@/lib/messaging/bounded-stream";
import { acquirePhotoProcessing, encodeProfilePhoto } from "@/lib/server/profile-photos";
import {
  maxProfilePhotoUploadBytes,
  profilePhotoUrl,
  ProfilePhotoError,
} from "@/lib/profile/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  let release: (() => void) | null = null;
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  let image: Buffer | undefined;
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (
      !type ||
      !["image/jpeg", "image/png", "image/webp"].includes(type) ||
      request.headers.has("content-encoding") ||
      !request.body
    ) {
      return Response.json({ message: "Choose a JPG, PNG, or WebP photo." }, { status: 415 });
    }
    const declaredSize = request.headers.get("content-length");
    if (
      declaredSize !== null &&
      (!/^\d+$/.test(declaredSize) || Number(declaredSize) > maxProfilePhotoUploadBytes)
    ) {
      return Response.json(
        { message: "That photo is too large. Choose a smaller one." },
        { status: 413 },
      );
    }
    const { db } = getDatabase();
    const limit = await consumeRateLimit(
      db,
      `profile-photo:${user.id}`,
      rateLimitRules.profilePhoto,
    );
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    release = acquirePhotoProcessing();
    if (!release) return rateLimitedResponse(3);
    bytes = await readBoundedStream(request.body, {
      maxBytes: maxProfilePhotoUploadBytes,
      timeoutMs: 10_000,
      signal: request.signal,
    });
    image = await encodeProfilePhoto(bytes);
    const version = crypto.randomUUID();
    const url = profilePhotoUrl(user.id, version);
    const storedImage = image;
    await db.transaction(async (tx) => {
      await tx
        .insert(profilePhotos)
        .values({ userId: user.id, version, image: storedImage })
        .onConflictDoUpdate({
          target: profilePhotos.userId,
          set: { version, image: storedImage, updatedAt: new Date() },
        });
      await tx
        .update(authUser)
        .set({ image: url, updatedAt: new Date() })
        .where(eq(authUser.id, user.id));
    });
    return Response.json({ image: url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProfilePhotoError || error instanceof RangeError) {
      return Response.json(
        {
          message:
            error instanceof ProfilePhotoError
              ? error.message
              : "That photo is too large. Choose a smaller one.",
        },
        { status: 400 },
      );
    }
    if (request.signal.aborted)
      return Response.json({ message: "Photo upload was cancelled." }, { status: 400 });
    return backendErrorResponse(error);
  } finally {
    bytes?.fill(0);
    image?.fill(0);
    release?.();
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const { db } = getDatabase();
    const limit = await consumeRateLimit(
      db,
      `profile-photo:${user.id}`,
      rateLimitRules.profilePhoto,
    );
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    await db.transaction(async (tx) => {
      await tx.delete(profilePhotos).where(eq(profilePhotos.userId, user.id));
      await tx
        .update(authUser)
        .set({ image: null, updatedAt: new Date() })
        .where(eq(authUser.id, user.id));
    });
    return Response.json({ image: null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
