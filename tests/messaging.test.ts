import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeTextEnvelope,
  encodeTextEnvelope,
  maxMessageLength,
  normalizeMessageText,
} from "../lib/messaging/text-envelope";
import {
  conversationTitle,
  initialsFor,
  mergeMessages,
  searchConversations,
  sortByActivity,
  toneFor,
  type ConversationMessage,
  type ConversationSummary,
} from "../lib/messaging/people";
import { decodeMessageEnvelope } from "../lib/server/message-envelope";

const ana = { id: "user-ana", name: "Ana Ruiz", email: "ana@example.com" };
const ben = { id: "user-ben", name: "Ben Okafor", email: "ben@example.com" };
const cy = { id: "user-cy", name: "Cy", email: "cy@example.com" };

function conversation(
  id: string,
  members: ConversationSummary["members"],
  lastMessage: ConversationSummary["lastMessage"],
  createdAt = "2026-10-01T10:00:00.000Z",
): ConversationSummary {
  return { id, createdAt, members, lastMessage };
}

function message(id: string, createdAt: string): ConversationMessage {
  return { id, senderId: ana.id, clientMessageId: `client-${id}`, text: id, createdAt };
}

describe("text message envelope", () => {
  it("round-trips Unicode text through the server's envelope validation", () => {
    const encoded = encodeTextEnvelope("  Hello, नमस्ते 👋\nsee you soon  ");
    const validated = decodeMessageEnvelope(encoded);
    assert.equal(validated.ok, true);
    assert.equal(decodeTextEnvelope(encoded), "Hello, नमस्ते 👋\nsee you soon");
    if (validated.ok) {
      assert.equal(decodeTextEnvelope(new Uint8Array(validated.bytes)), "Hello, नमस्ते 👋\nsee you soon");
    }
  });

  it("rejects blank, oversized, and malformed messages", () => {
    assert.equal(normalizeMessageText("   "), null);
    assert.equal(normalizeMessageText("x".repeat(maxMessageLength + 1)), null);
    assert.throws(() => encodeTextEnvelope(""));
    assert.equal(decodeTextEnvelope(btoa("not json")), null);
    assert.equal(decodeTextEnvelope(btoa(JSON.stringify({ v: 2, type: "text", text: "hi" }))), null);
    assert.equal(decodeTextEnvelope(btoa(JSON.stringify({ v: 1, type: "text", text: "  padded " }))), null);
  });
});

describe("conversation helpers", () => {
  it("names a conversation after the other people in it", () => {
    assert.equal(conversationTitle(conversation("c1", [ana, ben], null), ana.id), "Ben Okafor");
    assert.equal(conversationTitle(conversation("c2", [ana, ben, cy], null), ana.id), "Ben Okafor, Cy");
  });

  it("derives stable initials and avatar tones", () => {
    assert.equal(initialsFor("Ana Ruiz"), "AR");
    assert.equal(initialsFor("  "), "U");
    assert.equal(toneFor("user-ana"), toneFor("user-ana"));
  });

  it("sorts by latest activity, falling back to creation time", () => {
    const quiet = conversation("quiet", [ana, ben], null, "2026-10-05T00:00:00.000Z");
    const active = conversation("active", [ana, cy], {
      text: "hi",
      senderId: cy.id,
      createdAt: "2026-10-06T00:00:00.000Z",
    });
    assert.deepEqual(
      sortByActivity([quiet, active]).map(({ id }) => id),
      ["active", "quiet"],
    );
  });

  it("searches names, emails, and the latest message without matching the viewer", () => {
    const withBen = conversation("c1", [ana, ben], {
      text: "Bookshop on Sunday?",
      senderId: ben.id,
      createdAt: "2026-10-06T00:00:00.000Z",
    });
    const withCy = conversation("c2", [ana, cy], null);
    assert.deepEqual(searchConversations([withBen, withCy], "bookshop", ana.id), [withBen]);
    assert.deepEqual(searchConversations([withBen, withCy], "CY@EXAMPLE", ana.id), [withCy]);
    assert.deepEqual(searchConversations([withBen, withCy], "ana", ana.id), []);
  });

  it("merges fetched messages by ID in chronological order", () => {
    const merged = mergeMessages(
      [message("b", "2026-10-06T00:00:02.000Z"), message("a", "2026-10-06T00:00:01.000Z")],
      [message("c", "2026-10-06T00:00:03.000Z"), message("b", "2026-10-06T00:00:02.000Z")],
    );
    assert.deepEqual(
      merged.map(({ id }) => id),
      ["a", "b", "c"],
    );
  });
});
