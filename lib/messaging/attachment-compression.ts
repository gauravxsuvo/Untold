import { inspectAttachmentBytes, maxProcessedAttachmentBytes } from "./attachment-policy";
import { readBoundedStream } from "./bounded-stream";
import type { AttachmentManifest } from "./attachments";

export function compressionSavesSpace(originalBytes: number, compressedBytes: number): boolean {
  return compressedBytes + Math.max(128, Math.ceil(originalBytes * 0.03)) < originalBytes;
}

export async function compressAttachmentBytes(
  bytes: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; compression?: AttachmentManifest["compression"] }> {
  signal?.throwIfAborted();
  if (bytes.byteLength > maxProcessedAttachmentBytes)
    throw new RangeError("Files must be 20 MiB or smaller.");
  if (bytes.byteLength < 1024 || typeof CompressionStream === "undefined") return { bytes };
  let compressed: Uint8Array<ArrayBuffer> | undefined;
  try {
    compressed = await readBoundedStream(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
      { maxBytes: bytes.byteLength, signal },
    );
    if (compressionSavesSpace(bytes.byteLength, compressed.byteLength)) {
      return {
        bytes: compressed,
        compression: { algorithm: "gzip", originalSize: bytes.byteLength },
      };
    }
  } catch (error) {
    signal?.throwIfAborted();
    // Incompressible files can exceed the input-sized output budget. Keep the original.
    if (!(error instanceof RangeError)) throw error;
  }
  compressed?.fill(0);
  return { bytes };
}

export async function decodeAttachmentBytes(
  bytes: Uint8Array<ArrayBuffer>,
  manifest: AttachmentManifest,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  let decoded = bytes;
  try {
    signal?.throwIfAborted();
    if (bytes.byteLength !== manifest.size || bytes.byteLength > maxProcessedAttachmentBytes) {
      throw new Error("File size does not match its message details.");
    }
    if (manifest.version === 2) {
      const compression = manifest.compression;
      if (
        compression?.algorithm !== "gzip" ||
        !Number.isSafeInteger(compression.originalSize) ||
        compression.originalSize <= manifest.size ||
        compression.originalSize > maxProcessedAttachmentBytes
      )
        throw new Error("Invalid file compression details.");
      if (typeof DecompressionStream === "undefined") {
        throw new Error("Update your browser to open this compressed file.");
      }
      // Authenticate/decrypt first. Expand once, with a strict byte budget and deadline.
      // Archives inside the file are never extracted by Untold.
      decoded = await readBoundedStream(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
        { maxBytes: compression.originalSize, expectedBytes: compression.originalSize, signal },
      );
      bytes.fill(0);
    } else if (manifest.version !== 1 || manifest.compression !== undefined) {
      throw new Error("Unsupported file format. Update Untold and try again.");
    }
    inspectAttachmentBytes(decoded, manifest.name, manifest.contentType);
    return decoded;
  } catch (error) {
    decoded.fill(0);
    bytes.fill(0);
    throw error;
  }
}
