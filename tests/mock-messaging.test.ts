import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendPreviewMessage,
  initialConversations,
  searchConversations,
} from "../lib/messaging/mock-data";

describe("mock conversation search", () => {
  it("returns every conversation for an empty or whitespace query", () => {
    assert.deepEqual(searchConversations(initialConversations, "   "), initialConversations);
  });

  it("matches contact names and message text without case sensitivity", () => {
    assert.deepEqual(
      searchConversations(initialConversations, "BOOKSHOP").map(({ id }) => id),
      ["june-park"],
    );
    assert.deepEqual(
      searchConversations(initialConversations, "rohan").map(({ id }) => id),
      ["rohan-malik"],
    );
  });

  it("returns no results when nothing matches", () => {
    assert.deepEqual(searchConversations(initialConversations, "not a conversation"), []);
  });
});

describe("preview message composition", () => {
  const conversation = initialConversations[0];

  it("adds trimmed text locally and marks it as preview only", () => {
    const updated = appendPreviewMessage(
      conversation,
      "  See you soon.  ",
      "2026-10-14T15:00:00.000Z",
    );
    const addedMessage = updated.messages.at(-1);

    assert.equal(updated.messages.length, conversation.messages.length + 1);
    assert.equal(addedMessage?.body, "See you soon.");
    assert.equal(addedMessage?.sender, "you");
    assert.equal(addedMessage?.previewOnly, true);
    assert.equal(updated.lastMessage, "See you soon.");
    assert.equal(updated.updatedAt, "2026-10-14T15:00:00.000Z");
    assert.equal(conversation.messages.length, 3);
  });

  it("does not add blank messages", () => {
    assert.equal(appendPreviewMessage(conversation, " \n "), conversation);
  });
});
