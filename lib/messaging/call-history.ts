import type { CallKind } from "./call-types";

export type CallHistoryEntry = {
  id: string;
  source: "direct" | "group";
  sourceId: string;
  conversationId: string;
  initiatorId: string;
  name: string;
  kind: CallKind;
  status: "live" | "ended";
  outcome: string;
  createdAt: string;
  connectedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  personalSeconds: number | null;
  missed: boolean;
  acknowledged: boolean;
  legacy: boolean;
  participants: { userId: string; name: string; status: string; seconds: number | null }[];
};
export type CallHistoryPage = {
  calls: CallHistoryEntry[];
  updates?: CallHistoryEntry[];
  nextCursor: string | null;
  missedCount: number;
};

export function parseLiveHistoryIds(value: string | null) {
  if (!value) return [];
  const ids = value.split(",");
  if (
    value.length > 4500 ||
    ids.length > 100 ||
    ids.some((id) => !/^(direct|group):[0-9a-f-]{36}$/i.test(id))
  )
    throw new Error("Invalid history IDs");
  return [...new Set(ids)];
}

export function callOutcome(entry: CallHistoryEntry) {
  if (entry.missed) return "Missed";
  if (entry.status === "live") return entry.connectedAt ? "In progress" : "Calling…";
  const labels: Record<string, string> = {
    completed: "Ended",
    cancelled: "Cancelled",
    declined: "Declined",
    missed: "Unanswered",
    failed: "Couldn’t connect",
    disconnected: "Disconnected",
    revoked: "Access changed",
    unknown: "Ended",
  };
  return labels[entry.outcome] ?? "Ended";
}
export function formatCallDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(value / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
    : `${minutes}:${String(value % 60).padStart(2, "0")}`;
}
export function callLabel(entry: CallHistoryEntry, viewerId: string) {
  const prefix =
    entry.source === "group"
      ? "Group "
      : entry.initiatorId === viewerId
        ? "Outgoing "
        : "Incoming ";
  return `${prefix}${entry.kind === "video" ? "video" : "voice"} call`;
}
export function historyCursor(createdAt: string, id: string) {
  return `${createdAt}|${id}`;
}
export function parseHistoryCursor(value: string | null): { at: string; id: string } | null {
  if (!value) return null;
  const [at, id, extra] = value.split("|");
  if (
    extra !== undefined ||
    !at ||
    !id ||
    value.length > 160 ||
    !Number.isFinite(Date.parse(at)) ||
    !/^(?:direct|group|message):[0-9a-f-]{36}$/i.test(id)
  )
    throw new Error("Invalid history cursor");
  // Keep PostgreSQL's sub-millisecond precision; Date.toISOString truncates it
  // and can skip rows when a page boundary falls inside one millisecond.
  return { at, id };
}
