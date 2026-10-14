import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptMessage,
  encryptMessage,
  generateSharedSecret,
} from "../dist/index.js";

const context = {
  conversationId: "conversation-123",
  messageId: "message-456",
};

describe("standalone Web Crypto message helper", () => {
  it("generates distinct 256-bit base64url secrets", () => {
    const first = generateSharedSecret();
    const second = generateSharedSecret();

    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.match(second, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first, second);
  });

  it("round-trips Unicode text with the same conversation and message context", async () => {
    const plaintext = "A private note 🌿 नमस्ते";
    const secret = generateSharedSecret();
    const envelope = await encryptMessage(plaintext, secret, context);

    assert.deepEqual(Array.from(envelope.slice(0, 5)), [0x55, 0x4e, 0x54, 0x4c, 1]);
    assert.equal(await decryptMessage(envelope, secret, context), plaintext);
  });

  it("rejects ciphertext tampering, a different key, and mismatched context", async () => {
    const secret = generateSharedSecret();
    const envelope = await encryptMessage("hello", secret, context);
    const tampered = new Uint8Array(envelope);
    tampered[tampered.length - 1] ^= 1;

    await assert.rejects(
      decryptMessage(tampered, secret, context),
      /Message authentication failed/,
    );
    await assert.rejects(
      decryptMessage(envelope, generateSharedSecret(), context),
      /Message authentication failed/,
    );
    await assert.rejects(
      decryptMessage(envelope, secret, { ...context, messageId: "another-message" }),
      /Message authentication failed/,
    );
  });

  it("rejects malformed envelopes, unsupported versions, and invalid secrets", async () => {
    const secret = generateSharedSecret();
    const envelope = await encryptMessage("hello", secret, context);
    const unsupportedVersion = new Uint8Array(envelope);
    unsupportedVersion[4] = 2;

    await assert.rejects(decryptMessage(new Uint8Array(1), secret, context), /invalid length/);
    await assert.rejects(decryptMessage(unsupportedVersion, secret, context), /not supported/);
    await assert.rejects(encryptMessage("hello", "not-a-secret", context), /256-bit/);
    await assert.rejects(encryptMessage("hello", secret, { conversationId: "", messageId: "m" }), /conversationId/);
  });

  it("accepts the 64 KiB envelope boundary and rejects a larger plaintext", async () => {
    const secret = generateSharedSecret();
    const maximumPlaintext = "a".repeat(65_503);
    const envelope = await encryptMessage(maximumPlaintext, secret, context);

    assert.equal(envelope.byteLength, 64 * 1024);
    await assert.rejects(
      encryptMessage(`${maximumPlaintext}a`, secret, context),
      /message limit/,
    );
    await assert.rejects(
      decryptMessage(new Uint8Array(64 * 1024 + 1), secret, context),
      /invalid length/,
    );
  });
});
