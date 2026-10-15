import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  assertSafeAttachmentName,
  inspectAttachmentBytes,
  readImageDimensions,
  maxProcessedAttachmentBytes,
} from "../lib/messaging/attachment-policy";
import {
  attachmentPreviewKind,
  encodeAttachmentMessage,
  openMessageContent,
  sanitizeAttachmentName,
  type AttachmentManifest,
} from "../lib/messaging/attachments";
import {
  compressAttachmentBytes,
  decodeAttachmentBytes,
} from "../lib/messaging/attachment-compression";
import { prepareAttachment } from "../lib/messaging/prepare-attachment";
import { readBoundedStream } from "../lib/messaging/bounded-stream";
import { acquireAttachmentUpload, readAttachmentUpload } from "../lib/server/attachment-upload";

const id = "827d2284-e37b-4909-b391-2cc5cded1fc2";
function manifest(overrides: Partial<AttachmentManifest> = {}): AttachmentManifest {
  return {
    kind: "untold-attachment",
    version: 1,
    id,
    name: "Notes.txt",
    contentType: "text/plain",
    size: 5,
    key: "a".repeat(43),
    nonce: "a".repeat(16),
    ...overrides,
  };
}
function png(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("attachment input and preview boundaries", () => {
  it("removes path, Windows stream, control, and bidirectional filename tricks", () => {
    assert.equal(sanitizeAttachmentName("../a\\b:bad\u202Egnp.exe\u0000. "), ".._a_b_bad_gnp.exe_");
    assert.equal(sanitizeAttachmentName("CON.txt"), "_CON.txt");
    assert.equal(sanitizeAttachmentName("..."), "File");
    assert.ok(sanitizeAttachmentName("x".repeat(500)).length <= 180);
  });
  it("rejects executable/script/macro names including trailing-dot tricks", () => {
    for (const name of [
      "photo.jpg.exe",
      "invoice.PS1",
      "report.docm",
      "safe.url.",
      "run.sh ",
      "run.py",
      "settings.reg",
      "app.apk",
    ]) {
      assert.throws(() => assertSafeAttachmentName(name));
    }
    for (const name of ["notes.txt", "slides.pdf", "backup.zip", "photo.jpg"])
      assertSafeAttachmentName(name);
  });
  it("rejects executable signatures even with an innocent name and MIME type", () => {
    for (const signature of [
      [77, 90],
      [127, 69, 76, 70],
      [35, 33],
      [0xcf, 0xfa, 0xed, 0xfe],
      [0xca, 0xfe, 0xba, 0xbe],
    ]) {
      assert.throws(() =>
        inspectAttachmentBytes(new Uint8Array(signature), "notes.txt", "text/plain"),
      );
    }
  });
  it("rejects MIME spoofing before decoding a claimed image", () => {
    assert.throws(() =>
      inspectAttachmentBytes(
        new TextEncoder().encode("<svg onload='alert(1)'/>"),
        "photo.png",
        "image/png",
      ),
    );
    assert.equal(inspectAttachmentBytes(png(640, 480), "photo.png", "image/png"), "image/png");
  });
  it("rejects image dimension bombs and corrupt headers before native decoding", () => {
    assert.throws(() =>
      inspectAttachmentBytes(png(0xffffffff, 0xffffffff), "bomb.png", "image/png"),
    );
    assert.throws(() => inspectAttachmentBytes(png(8192, 8192), "bomb.png", "image/png"));
    assert.throws(() => inspectAttachmentBytes(png(0, 1), "zero.png", "image/png"));
    const corrupt = png(100, 100);
    corrupt[11] = 0;
    assert.throws(() => inspectAttachmentBytes(corrupt, "corrupt.png", "image/png"));
  });
  it("recognizes animated PNGs without flattening or embedding their animations", () => {
    const animated = new Uint8Array(53);
    animated.set(png(120, 80));
    new DataView(animated.buffer).setUint32(33, 8);
    animated.set(new TextEncoder().encode("acTL"), 37);
    assert.equal(readImageDimensions(animated, "image/png")?.animated, true);
  });
  it("never embeds active documents or complex image formats", () => {
    for (const type of [
      "text/html",
      "image/svg+xml",
      "image/avif",
      "image/gif",
      "application/octet-stream",
    ]) {
      assert.equal(attachmentPreviewKind(type), null);
    }
  });

  it("previews PDFs only through the sandboxed canvas renderer", () => {
    assert.equal(attachmentPreviewKind("application/pdf"), "pdf");
  });
});

describe("attachment message compatibility", () => {
  it("continues accepting previously sent uncompressed files", () => {
    assert.equal(openMessageContent(encodeAttachmentMessage(manifest()), id).kind, "attachment");
  });
  it("accepts version 2 compressed files and strips unrecognized properties", () => {
    const value = {
      ...manifest({
        version: 2,
        size: 100,
        compression: { algorithm: "gzip", originalSize: 1000 },
      }),
      unexpected: "ignore",
    };
    const result = openMessageContent(encodeAttachmentMessage(value), id);
    assert.equal(result.kind, "attachment");
    if (result.kind === "attachment") assert.equal("unexpected" in result.attachment, false);
  });
  it("rejects unknown compression, excessive expansion, missing sizes, and downgrade tricks", () => {
    const values = [
      { version: 2 },
      { version: 2, compression: { algorithm: "zip", originalSize: 1000 } },
      {
        version: 2,
        compression: { algorithm: "gzip", originalSize: maxProcessedAttachmentBytes + 1 },
      },
      { version: 2, compression: { algorithm: "gzip", originalSize: 50 } },
      { version: 1, compression: { algorithm: "gzip", originalSize: 1000 } },
    ];
    for (const value of values) {
      const encoded = `untold-attachment:v1\n${JSON.stringify({ ...manifest({ size: 100 }), ...value })}`;
      assert.equal(openMessageContent(encoded, id).kind, "invalid-attachment");
    }
  });
});

describe("bounded compression and restoration", () => {
  it("saves space on text and restores the original bytes and name exactly", async () => {
    const original = new TextEncoder().encode("Private notes, नमस्ते.\n".repeat(3000));
    const prepared = await prepareAttachment(
      new File([original], "Notes.txt", { type: "text/plain" }),
    );
    assert.ok(prepared.bytes.length < original.length / 5);
    assert.equal(prepared.name, "Notes.txt");
    const restored = await decodeAttachmentBytes(
      prepared.bytes,
      manifest({
        version: 2,
        size: prepared.bytes.length,
        compression: prepared.compression,
      }),
    );
    assert.deepEqual(restored, original);
  });
  it("keeps incompressible and small files byte-for-byte unchanged", async () => {
    const random = new Uint8Array(randomBytes(128 * 1024));
    const result = await compressAttachmentBytes(random);
    assert.equal(result.compression, undefined);
    assert.deepEqual(result.bytes, random);
    const tiny = new TextEncoder().encode("hello");
    assert.equal((await compressAttachmentBytes(tiny)).bytes, tiny);
  });
  it("rejects a gzip bomb as soon as output exceeds its authenticated size budget", async () => {
    const result = await compressAttachmentBytes(new Uint8Array(2 * 1024 * 1024));
    await assert.rejects(
      decodeAttachmentBytes(
        result.bytes,
        manifest({
          version: 2,
          size: result.bytes.length,
          compression: { algorithm: "gzip", originalSize: 8192 },
        }),
      ),
      /exceeds/,
    );
  });
  it("rejects truncated gzip streams and exact-size mismatches", async () => {
    const result = await compressAttachmentBytes(new TextEncoder().encode("test\n".repeat(3000)));
    const damaged = result.bytes.slice(0, -5);
    await assert.rejects(
      decodeAttachmentBytes(
        damaged,
        manifest({ version: 2, size: damaged.length, compression: result.compression }),
      ),
    );
    await assert.rejects(
      decodeAttachmentBytes(
        result.bytes,
        manifest({
          version: 2,
          size: result.bytes.length,
          compression: { algorithm: "gzip", originalSize: 15001 },
        }),
      ),
    );
  });
  it("does not unpack an archive embedded in a file", async () => {
    const archive = new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0]);
    const restored = await decodeAttachmentBytes(
      archive.slice(),
      manifest({ name: "Archive.zip", contentType: "application/zip", size: archive.length }),
    );
    assert.deepEqual(restored, archive);
  });
  it("also applies executable rejection to files received from a modified sender", async () => {
    await assert.rejects(
      decodeAttachmentBytes(new Uint8Array([77, 90]), manifest({ name: "notes.txt", size: 2 })),
    );
  });
  it("honors cancellation during preparation", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      prepareAttachment(new File(["test"], "Notes.txt"), { signal: controller.signal }),
      { name: "AbortError" },
    );
  });
});

describe("upload and streaming resource guards", () => {
  it("rejects lying content lengths and oversized bodies without trusting headers", async () => {
    await assert.rejects(
      readAttachmentUpload(
        new Request("https://example.test", {
          method: "PUT",
          headers: { "content-length": "16" },
          body: new Uint8Array(32),
        }),
      ),
    );
    await assert.rejects(
      readAttachmentUpload(
        new Request("https://example.test", {
          method: "PUT",
          headers: { "content-length": String(maxProcessedAttachmentBytes + 17) },
          body: new Uint8Array(16),
        }),
      ),
      RangeError,
    );
    await assert.rejects(
      readAttachmentUpload(
        new Request("https://example.test", {
          method: "PUT",
          headers: { "content-length": "16.0" },
          body: new Uint8Array(16),
        }),
      ),
      TypeError,
    );
  });
  it("rejects transport compression and truncated ciphertext", async () => {
    await assert.rejects(
      readAttachmentUpload(
        new Request("https://example.test", {
          method: "PUT",
          headers: { "content-encoding": "gzip" },
          body: new Uint8Array(16),
        }),
      ),
    );
    await assert.rejects(
      readAttachmentUpload(
        new Request("https://example.test", { method: "PUT", body: new Uint8Array(15) }),
      ),
    );
    assert.equal(
      (
        await readAttachmentUpload(
          new Request("https://example.test", { method: "PUT", body: new Uint8Array(20) }),
        )
      ).length,
      20,
    );
  });
  it("cancels a stalled stream on deadline and frees its lock", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(readBoundedStream(stream, { maxBytes: 100, timeoutMs: 20 }), /timed out/);
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  });
  it("cancels a stream when the user aborts", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>();
    const pending = readBoundedStream(stream, { maxBytes: 100, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(stream.locked, false);
  });
  it("does not wait for an unresponsive source cancellation hook", async () => {
    const stream = new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => {}) });
    await assert.rejects(readBoundedStream(stream, { maxBytes: 100, timeoutMs: 20 }), /timed out/);
    assert.equal(stream.locked, false);
  });
  it("handles fragmented bodies without retaining a growing array of chunk buffers", async () => {
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === 20_000) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array([offset++ % 256]));
      },
    });
    const bytes = await readBoundedStream(stream, { maxBytes: 20_000 });
    assert.equal(bytes.length, 20_000);
    assert.ok(bytes.every((byte, index) => byte === index % 256));
  });
  it("limits concurrent upload buffers and releases slots idempotently", () => {
    const first = acquireAttachmentUpload("A");
    const second = acquireAttachmentUpload("A");
    assert.ok(first);
    assert.ok(second);
    assert.equal(acquireAttachmentUpload("A"), null);
    const third = acquireAttachmentUpload("B");
    const fourth = acquireAttachmentUpload("C");
    assert.ok(third);
    assert.ok(fourth);
    assert.equal(acquireAttachmentUpload("D"), null);
    first();
    first();
    second();
    third();
    fourth();
    const available = acquireAttachmentUpload("D");
    assert.ok(available);
    available();
  });
});
