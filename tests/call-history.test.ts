import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  callLabel,
  callOutcome,
  formatCallDuration,
  historyCursor,
  parseHistoryCursor,
  type CallHistoryEntry,
} from "../lib/messaging/call-history";
import {
  conversationActivityAt,
  conversationPreview,
  type ConversationSummary,
} from "../lib/messaging/people";

const entry: CallHistoryEntry = {
  id: "direct:11111111-1111-4111-8111-111111111111",
  source: "direct",
  sourceId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  initiatorId: "alice",
  name: "Bob",
  kind: "video",
  status: "ended",
  outcome: "unknown",
  createdAt: "2026-10-16T10:00:00.000Z",
  connectedAt: null,
  endedAt: null,
  durationSeconds: null,
  personalSeconds: null,
  missed: false,
  acknowledged: false,
  legacy: true,
  participants: [],
};
describe("call history presentation and cursors", () => {
  it("does not turn unknown legacy outcomes into missed or completed calls", () => {
    assert.equal(callOutcome(entry), "Ended");
    assert.equal(callLabel(entry, "alice"), "Outgoing video call");
    assert.equal(callLabel(entry, "bob"), "Incoming video call");
    assert.equal(
      callLabel({ ...entry, source: "group", kind: "voice" }, "bob"),
      "Group voice call",
    );
  });
  it("keeps missed, unanswered, failed and live call states distinct", () => {
    assert.equal(callOutcome({ ...entry, missed: true }), "Missed");
    assert.equal(callOutcome({ ...entry, outcome: "missed" }), "Unanswered");
    assert.equal(callOutcome({ ...entry, outcome: "failed" }), "Couldn’t connect");
    assert.equal(callOutcome({ ...entry, status: "live" }), "Calling…");
    assert.equal(
      callOutcome({ ...entry, status: "live", connectedAt: entry.createdAt }),
      "In progress",
    );
  });
  it("formats zero, hour-long and invalid negative durations consistently", () => {
    assert.equal(formatCallDuration(0), "0:00");
    assert.equal(formatCallDuration(272), "4:32");
    assert.equal(formatCallDuration(3661), "1:01:01");
    assert.equal(formatCallDuration(-10), "0:00");
  });
  it("round-trips mixed timeline cursors and rejects malformed input", () => {
    assert.deepEqual(parseHistoryCursor(historyCursor(entry.createdAt, entry.id)), {
      at: entry.createdAt,
      id: entry.id,
    });
    assert.ok(
      parseHistoryCursor(historyCursor(entry.createdAt, entry.id.replace("direct:", "message:"))),
    );
    const precise = "2026-10-16T10:00:00.123456Z";
    assert.equal(parseHistoryCursor(historyCursor(precise, entry.id))?.at, precise);
    for (const invalid of [
      "",
      `not-a-date|${entry.id}`,
      `${entry.createdAt}|other:id`,
      `${historyCursor(entry.createdAt, entry.id)}|extra`,
    ]) {
      if (invalid) assert.throws(() => parseHistoryCursor(invalid));
      else assert.equal(parseHistoryCursor(invalid), null);
    }
  });
});
describe("call activity in conversation lists", () => {
  const conversation: ConversationSummary = {
    id: "chat",
    createdAt: "2026-10-15T00:00:00.000Z",
    members: [],
    lastMessage: null,
    lastCall: { createdAt: entry.createdAt, kind: "video", status: "ended", outcome: "missed" },
  };
  it("orders and previews a call-only conversation", () => {
    assert.equal(conversationActivityAt(conversation), entry.createdAt);
    assert.equal(conversationPreview(conversation, "alice"), "Video call · Unanswered");
  });
  it("lets a newer encrypted message supersede the call preview", () => {
    const next = {
      ...conversation,
      lastMessage: { senderId: "alice", text: null, createdAt: "2026-10-16T11:00:00.000Z" },
    };
    assert.equal(conversationActivityAt(next), next.lastMessage.createdAt);
    assert.equal(conversationPreview(next, "alice"), "You: Encrypted message");
  });
});
