import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDatabase } from "@/lib/server/database";
import { conversationMembers, profilePhotos } from "@/lib/server/schema";
import {
  backendErrorResponse,
  getAuthenticatedUser,
  unauthorizedResponse,
} from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return Response.json(
    { message: "Photo not found." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    const { userId } = await context.params;
    if (!userId || userId.length > 128) return notFound();
    const { db } = getDatabase();
    if (userId !== user.id) {
      const viewer = alias(conversationMembers, "photo_viewer");
      const [shared] = await db
        .select({ id: conversationMembers.conversationId })
        .from(conversationMembers)
        .innerJoin(viewer, eq(viewer.conversationId, conversationMembers.conversationId))
        .where(and(eq(conversationMembers.userId, userId), eq(viewer.userId, user.id)))
        .limit(1);
      if (!shared) return notFound();
    }
    // Always authorize and check the current version before returning a cached photo.
    const [photo] = await db
      .select({ version: profilePhotos.version })
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, userId))
      .limit(1);
    if (!photo) return notFound();
    const etag = `"photo-${photo.version}"`;
    const headers = {
      "Cache-Control": "private, no-cache",
      "Content-Type": "image/webp",
      "Content-Disposition": 'inline; filename="profile.webp"',
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      Vary: "Cookie",
      ETag: etag,
    };
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    const [stored] = await db
      .select({ image: profilePhotos.image })
      .from(profilePhotos)
      .where(and(eq(profilePhotos.userId, userId), eq(profilePhotos.version, photo.version)))
      .limit(1);
    if (!stored) return notFound();
    return new Response(new Uint8Array(stored.image), { headers });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
