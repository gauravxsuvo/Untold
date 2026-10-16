import { sql } from "drizzle-orm";
import {
  getAuthenticatedUser,
  unauthorizedResponse,
  backendErrorResponse,
  trustedBrowserOrigin,
  forbiddenOriginResponse,
  readJsonBody,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import { accountDeviceDirectory } from "@/lib/server/device-trust";
import { isCallId } from "@/lib/messaging/call-signatures";
import { parseHistoryCursor, parseLiveHistoryIds } from "@/lib/messaging/call-history";
import {
  historyAudience,
  historyEntries,
  listCallHistory,
  reconcileCallHistory,
} from "@/lib/server/call-history";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
async function authorize(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorizedResponse();
  const deviceId = new URL(request.url).searchParams.get("deviceId");
  if (
    !isCallId(deviceId) ||
    !(await accountDeviceDirectory([user.id])).some(
      (d) => d.deviceId === deviceId && d.approved && !d.revoked,
    )
  )
    return Response.json(
      { message: "Approve this device in Settings to view calls." },
      { status: 403, headers },
    );
  const { db } = getDatabase();
  const limit = await consumeRateLimit(db, `call-history:${user.id}`, {
    max: 120,
    windowSeconds: 60,
  });
  return limit.allowed ? { user, db } : rateLimitedResponse(limit.retryAfterSeconds);
}
export async function GET(request: Request) {
  try {
    const access = await authorize(request);
    if (access instanceof Response) return access;
    const query = new URL(request.url).searchParams;
    const cursor = query.get("before");
    let liveIds: string[];
    try {
      parseHistoryCursor(cursor);
      liveIds = parseLiveHistoryIds(query.get("live"));
    } catch {
      return Response.json(
        { message: "Refresh call history and try again." },
        { status: 400, headers },
      );
    }
    await reconcileCallHistory(access.db, access.user.id);
    const page = await listCallHistory(access.db, access.user.id, {
      cursor,
      missed: query.get("filter") === "missed",
      countOnly: query.get("count") === "true",
    });
    const updates = liveIds.length
      ? await historyEntries(
          access.db,
          access.user.id,
          sql`h.id IN (${sql.join(
            liveIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          100,
        )
      : [];
    return Response.json({ ...page, updates }, { headers });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const access = await authorize(request);
    if (access instanceof Response) return access;
    const parsed = await readJsonBody(request, 6000);
    const ids = parsed.ok ? (parsed.body as { ids?: unknown } | null)?.ids : null;
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      ids.some((id) => typeof id !== "string" || !/^(direct|group):[0-9a-f-]{36}$/i.test(id))
    )
      return Response.json(
        { message: "Refresh call history and try again." },
        { status: 400, headers },
      );
    if (ids.length)
      await access.db.execute(sql`UPDATE untold_app.call_history_audience a SET acknowledged_at = now()
      FROM untold_app.call_history h WHERE h.id = a.history_id AND a.user_id = ${access.user.id}
      AND h.id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}) AND ${historyAudience(access.user.id)}`);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
