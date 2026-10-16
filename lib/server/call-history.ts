import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { getDatabase } from "./database";
import type { CallHistoryEntry } from "@/lib/messaging/call-history";
import { historyCursor, parseHistoryCursor } from "@/lib/messaging/call-history";

type Database = ReturnType<typeof getDatabase>["db"];
// Both current membership and the invitation-time audience are required.
export function historyAudience(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM untold_app.call_history_audience a WHERE a.history_id = h.id AND a.user_id = ${userId})
    AND EXISTS (SELECT 1 FROM untold_app.conversation_member m WHERE m.conversation_id = h.conversation_id AND m.user_id = ${userId} AND m.left_at IS NULL)`;
}
export function missedHistory(userId: string): SQL {
  return sql`NOT h.legacy AND h.initiator_id <> ${userId} AND
    (h.outcome = 'missed' OR (h.source = 'group' AND h.ring_until <= now())) AND
    EXISTS (SELECT 1 FROM untold_app.call_history_audience a WHERE a.history_id = h.id AND a.user_id = ${userId} AND a.status = 'invited')`;
}

// Bounded reconciliation; correctness does not depend on a final browser request.
// Row locks serialize this with ongoing call actions. Never touch unrelated users.
export async function reconcileCallHistory(db: Database, userId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`WITH stale AS (
      SELECT c.id FROM untold_app.call c WHERE (c.caller_id = ${userId} OR c.callee_id = ${userId})
        AND c.status <> 'ended' AND c.expires_at <= now() ORDER BY c.expires_at LIMIT 50 FOR UPDATE SKIP LOCKED
    ) UPDATE untold_app.call c SET status = 'ended', offer = NULL, answer = NULL, ended_at = c.expires_at,
      end_reason = CASE WHEN c.answered_at IS NULL THEN 'missed' ELSE 'disconnected' END FROM stale s WHERE c.id = s.id`);
    const ended = await tx.execute<{ id: string }>(sql`WITH stale AS (
      SELECT r.id FROM untold_app.call_room r WHERE r.status = 'active' AND r.expires_at <= now()
        AND EXISTS (SELECT 1 FROM untold_app.call_participant p WHERE p.room_id = r.id AND p.user_id = ${userId})
        ORDER BY r.expires_at LIMIT 50 FOR UPDATE SKIP LOCKED
    ) UPDATE untold_app.call_room r SET status = 'ended' FROM stale s WHERE r.id = s.id RETURNING r.id`);
    for (const { id } of ended.rows) {
      await tx.execute(
        sql`UPDATE untold_app.call_participant SET status = 'left', sharing = false, connected_at = NULL WHERE room_id = ${id}::uuid AND status = 'joined'`,
      );
      await tx.execute(sql`DELETE FROM untold_app.call_link WHERE room_id = ${id}::uuid`);
    }
  });
}

export async function historyEntries(
  db: Database,
  userId: string,
  condition: SQL,
  limit = 51,
): Promise<CallHistoryEntry[]> {
  const result = await db.execute<{ entry: CallHistoryEntry }>(sql`
    SELECT json_build_object(
      'id', h.id, 'source', h.source, 'sourceId', h.source_id, 'conversationId', h.conversation_id,
      'initiatorId', h.initiator_id, 'kind', h.kind, 'status', h.status, 'outcome', h.outcome,
      'createdAt', h.created_at, 'connectedAt', h.connected_at, 'endedAt', h.ended_at, 'legacy', h.legacy,
      'name', coalesce(c.group_name, (SELECT u.name FROM untold_app.call_history_audience a JOIN untold_auth."user" u ON u.id = a.user_id WHERE a.history_id = h.id AND a.user_id <> ${userId} LIMIT 1), 'Your contact'),
      'durationSeconds', CASE WHEN h.connected_at IS NOT NULL THEN greatest(0, floor(extract(epoch FROM (coalesce(h.ended_at, now()) - h.connected_at)))) END,
      'personalSeconds', (SELECT floor(sum(greatest(0, extract(epoch FROM (coalesce(t.left_at, h.ended_at, now()) - t.connected_at))))) FROM untold_app.call_attendance t WHERE t.history_id = h.id AND t.user_id = ${userId} AND t.connected_at IS NOT NULL),
      'missed', (${missedHistory(userId)}),
      'acknowledged', EXISTS (SELECT 1 FROM untold_app.call_history_audience a WHERE a.history_id = h.id AND a.user_id = ${userId} AND a.acknowledged_at IS NOT NULL),
      'participants', (SELECT coalesce(json_agg(json_build_object('userId', a.user_id, 'name', u.name, 'status', a.status,
        'seconds', (SELECT floor(sum(greatest(0, extract(epoch FROM (coalesce(t.left_at, h.ended_at, now()) - t.connected_at))))) FROM untold_app.call_attendance t WHERE t.history_id = h.id AND t.user_id = a.user_id AND t.connected_at IS NOT NULL)) ORDER BY u.name), '[]'::json)
        FROM untold_app.call_history_audience a JOIN untold_auth."user" u ON u.id = a.user_id WHERE a.history_id = h.id)
    ) AS entry FROM untold_app.call_history h JOIN untold_app.conversation c ON c.id = h.conversation_id
    WHERE ${historyAudience(userId)} AND ${condition} ORDER BY h.created_at DESC, h.id DESC LIMIT ${limit}`);
  return result.rows.map(({ entry }) => entry);
}

export async function listCallHistory(
  db: Database,
  userId: string,
  options: {
    cursor?: string | null;
    missed?: boolean;
    conversationId?: string | null;
    countOnly?: boolean;
  } = {},
) {
  const cursor = parseHistoryCursor(options.cursor ?? null);
  const condition = sql`true ${cursor ? sql`AND (h.created_at, h.id) < (${cursor.at}::timestamptz, ${cursor.id})` : sql``}
    ${options.missed ? sql`AND (${missedHistory(userId)})` : sql``}
    ${options.conversationId ? sql`AND h.conversation_id = ${options.conversationId}::uuid` : sql``}`;
  const calls = options.countOnly ? [] : await historyEntries(db, userId, condition);
  const hasMore = calls.length > 50;
  if (hasMore) calls.pop();
  const count = await db.execute<{
    count: number;
  }>(sql`SELECT count(*)::int AS count FROM untold_app.call_history h WHERE ${historyAudience(userId)} AND (${missedHistory(userId)})
    AND EXISTS (SELECT 1 FROM untold_app.call_history_audience a WHERE a.history_id = h.id AND a.user_id = ${userId} AND a.acknowledged_at IS NULL)`);
  const last = calls.at(-1);
  return {
    calls,
    nextCursor: hasMore && last ? historyCursor(last.createdAt, last.id) : null,
    missedCount: count.rows[0]?.count ?? 0,
  };
}

export async function conversationTimelineKeys(
  db: Database,
  userId: string,
  conversationId: string,
  before: string | null,
) {
  const cursor = parseHistoryCursor(before);
  const result = await db.execute<{
    id: string;
    item_id: string;
    created_at: Date | string;
    cursor_at: string;
    type: string;
  }>(sql`
    SELECT *, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM (
      SELECT 'message:' || m.id AS id, m.id::text AS item_id, m.created_at, 'message' AS type
      FROM untold_app.message_envelope m WHERE m.conversation_id = ${conversationId}::uuid
        AND (m.sender_id = ${userId} OR EXISTS (SELECT 1 FROM untold_app.message_recipient r WHERE r.message_id = m.id AND r.user_id = ${userId}))
      UNION ALL
      SELECT h.id, h.id AS item_id, h.created_at, 'call' AS type FROM untold_app.call_history h
      WHERE h.conversation_id = ${conversationId}::uuid AND ${historyAudience(userId)}
    ) timeline WHERE ${cursor ? sql`(created_at, id) < (${cursor.at}::timestamptz, ${cursor.id})` : sql`true`}
    ORDER BY created_at DESC, id DESC LIMIT 101`);
  const hasMore = result.rows.length > 100;
  const keys = result.rows.slice(0, 100);
  const last = keys.at(-1);
  return { keys, nextCursor: hasMore && last ? historyCursor(last.cursor_at, last.id) : null };
}
