import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeMessageEnvelope, maxMessageEnvelopeBytes } from "../lib/server/message-envelope";

describe("opaque message envelope validation", () => {
  it("accepts a canonical base64 envelope without interpreting its contents", () => {
    const payload = Buffer.from([0, 1, 128, 255]);
    assert.deepEqual(decodeMessageEnvelope(payload.toString("base64")), { ok: true, bytes: payload });
  });

  it("rejects empty, non-canonical, and non-base64 payloads", () => {
    assert.deepEqual(decodeMessageEnvelope(""), { ok: false, error: "invalid" });
    assert.deepEqual(decodeMessageEnvelope("not base64"), { ok: false, error: "invalid" });
    assert.deepEqual(decodeMessageEnvelope("Zh=="), { ok: false, error: "invalid" });
  });

  it("enforces the 64 KiB envelope limit", () => {
    const overLimit = Buffer.alloc(maxMessageEnvelopeBytes + 1).toString("base64");
    assert.deepEqual(decodeMessageEnvelope(overLimit), { ok: false, error: "too-large" });
  });
});
