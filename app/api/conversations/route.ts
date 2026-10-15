import {
  getAuthenticatedUser,
  backendErrorResponse,
  forbiddenOriginResponse,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import {
  findUserByEmail,
  listConversationsForUser,
  startDirectConversation,
} from "@/lib/server/conversations";
import { consumeRateLimit, rateLimitedResponse, rateLimitRules } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const { db } = getDatabase();
    const conversations = await listConversationsForUser(db, user.id);
    return Response.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();

    const parsed = await readJsonBody(request, 4 * 1024);
    if (!parsed.ok) {
      return Response.json({ message: "We couldn’t complete that action. Refresh the page and try again." }, { status: parsed.status });
    }

    const email = (parsed.body as { email?: unknown } | null)?.email;
    if (typeof email !== "string" || email.length > 254 || !emailPattern.test(email.trim())) {
      return Response.json({ message: "Enter a valid email address." }, { status: 400 });
    }

    const { db } = getDatabase();
    const limit = await consumeRateLimit(
      db,
      `start-conversation:${user.id}`,
      rateLimitRules.startConversation,
    );
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

    const otherUser = await findUserByEmail(db, email);
    if (!otherUser) {
      return Response.json(
        { message: "This person isn’t available on Untold yet. Check their email or ask them to request access." },
        { status: 404 },
      );
    }
    if (otherUser.id === user.id) {
      return Response.json(
        { message: "That's your own email. Enter the email of the person you want to talk to." },
        { status: 400 },
      );
    }

    const conversationId = await startDirectConversation(db, user.id, otherUser.id);
    const [conversation] = await listConversationsForUser(db, user.id, [conversationId]);
    return Response.json(
      { conversation },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
