import {
  assertSafeAttachmentName,
  assertSafeDimensions,
  inspectAttachmentBytes,
  maxProcessedAttachmentBytes,
  readImageDimensions,
} from "./attachment-policy";
import {
  normalizeAttachmentContentType,
  sanitizeAttachmentName,
  type AttachmentManifest,
} from "./attachments";
import { compressAttachmentBytes, compressionSavesSpace } from "./attachment-compression";
import { readBoundedStream } from "./bounded-stream";

type PreparationOptions = { signal?: AbortSignal; onProgress?: (progress: number) => void };
export type PreparedAttachment = {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  contentType: string;
  compression?: AttachmentManifest["compression"];
};

async function withDeadline<T>(
  task: Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const stopped = new Promise<never>((_, reject) => {
    abort = () =>
      reject(signal?.reason ?? new DOMException("File processing cancelled.", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => reject(new Error("Media processing timed out.")), timeoutMs);
  });
  try {
    return await Promise.race([task, stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function waitForMedia(
  video: HTMLVideoElement,
  event: "loadedmetadata" | "loadeddata",
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("This video could not be decoded safely."));
    };
    const aborted = () => {
      cleanup();
      reject(signal?.reason);
    };
    const timer = setTimeout(failed, 10_000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

function replaceExtension(name: string, extension: string): string {
  const stem = name.replace(/\.[^.]*$/, "").slice(0, 170) || "File";
  return `${stem}.${extension}`;
}

async function optimizeImage(blob: Blob, signal?: AbortSignal): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  let expired = false;
  const bitmapTask = createImageBitmap(blob).then((bitmap) => {
    if (expired || signal?.aborted) {
      bitmap.close();
      throw new Error("Image processing cancelled.");
    }
    return bitmap;
  });
  let bitmap: ImageBitmap | undefined;
  const canvas = document.createElement("canvas");
  try {
    bitmap = await withDeadline(bitmapTask, signal);
    assertSafeDimensions(bitmap);
    const scale = Math.min(1, 1920 / bitmap.width, 1920 / bitmap.height);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const output = await withDeadline(
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84)),
      signal,
    );
    return output?.type === "image/webp" && compressionSavesSpace(blob.size, output.size)
      ? output
      : null;
  } finally {
    expired = true;
    bitmap?.close();
    canvas.width = canvas.height = 0;
  }
}

// Browser codecs only: no uploaded command, server-side decoder, or archive is executed.
// Re-encoding happens in real time and is bounded to clips of at most two minutes.
async function optimizeVideo(
  blob: Blob,
  { signal, onProgress }: PreparationOptions,
): Promise<Blob | null> {
  const video = document.createElement("video") as HTMLVideoElement & {
    captureStream?: () => MediaStream;
  };
  const canvas = document.createElement("canvas");
  if (
    !video.captureStream ||
    !canvas.captureStream ||
    typeof MediaRecorder === "undefined" ||
    document.hidden
  )
    return null;
  const mimeType = "video/webm;codecs=vp8,opus";
  if (!MediaRecorder.isTypeSupported(mimeType)) return null;

  const url = URL.createObjectURL(blob);
  const streams: MediaStream[] = [];
  let recorder: MediaRecorder | undefined;
  let frame = 0;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const metadata = waitForMedia(video, "loadedmetadata", signal);
    video.src = url;
    await metadata;
    assertSafeDimensions({ width: video.videoWidth, height: video.videoHeight });
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 120)
      return null;
    const sourceBitrate = (blob.size * 8) / video.duration;
    if (sourceBitrate < 350_000) return null;
    const scale = Math.min(
      1,
      1280 / Math.max(video.videoWidth, video.videoHeight),
      720 / Math.min(video.videoWidth, video.videoHeight),
    );
    canvas.width = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
    canvas.height = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
    const context = canvas.getContext("2d");
    if (!context) return null;

    // Metadata selects the source tracks. Wait for the first decoded frame before
    // recording so capture starts at time zero without seeking an unindexed video.
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
      await waitForMedia(video, "loadeddata", signal);
    const source = video.captureStream();
    streams.push(source);
    if (source.getVideoTracks().length === 0) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const outputStream = new MediaStream([
      ...canvas.captureStream(24).getVideoTracks(),
      ...source.getAudioTracks(),
    ]);
    streams.push(outputStream);
    recorder = new MediaRecorder(outputStream, {
      mimeType,
      videoBitsPerSecond: Math.min(1_200_000, Math.round(sourceBitrate * 0.6)),
      audioBitsPerSecond: 96_000,
    });
    const activeRecorder = recorder;
    return await new Promise<Blob | null>((resolve, reject) => {
      const chunks: Blob[] = [];
      let bytes = 0;
      let completed = false;
      const finish = (value: Blob | null) => {
        cleanup();
        resolve(value);
      };
      const fail = () => finish(null);
      const aborted = () => {
        cleanup();
        reject(signal?.reason);
      };
      const hidden = () => {
        if (document.hidden) fail();
      };
      const timer = setTimeout(fail, (video.duration + 15) * 1000);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        document.removeEventListener("visibilitychange", hidden);
        video.onended = video.onerror = null;
        activeRecorder.ondataavailable = activeRecorder.onstop = activeRecorder.onerror = null;
      };
      video.onended = () => {
        completed = true;
        if (activeRecorder.state !== "inactive") activeRecorder.stop();
      };
      video.onerror = fail;
      activeRecorder.onerror = fail;
      activeRecorder.ondataavailable = (event) => {
        bytes += event.data.size;
        if (bytes >= blob.size || bytes > maxProcessedAttachmentBytes) {
          fail();
          return;
        }
        chunks.push(event.data);
      };
      activeRecorder.onstop = () => {
        if (!completed) {
          fail();
          return;
        }
        finish(
          bytes > 0 && compressionSavesSpace(blob.size, bytes)
            ? new Blob(chunks, { type: "video/webm" })
            : null,
        );
      };
      signal?.addEventListener("abort", aborted, { once: true });
      document.addEventListener("visibilitychange", hidden);
      const draw = () => {
        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          onProgress?.(Math.min(99, Math.round((video.currentTime / video.duration) * 100)));
          frame = requestAnimationFrame(draw);
        } catch {
          fail();
        }
      };
      if (signal?.aborted) {
        aborted();
        return;
      }
      try {
        activeRecorder.start(500);
        void video.play().then(draw, fail);
      } catch {
        fail();
      }
    });
  } catch (error) {
    signal?.throwIfAborted();
    // Never send a partial recording or drop an unsupported track: retain the original.
    if (error instanceof Error && error.message.includes("too large to process")) throw error;
    return null;
  } finally {
    cancelAnimationFrame(frame);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    video.pause();
    for (const stream of streams) for (const track of stream.getTracks()) track.stop();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}

export async function prepareAttachment(
  file: File,
  options: PreparationOptions = {},
): Promise<PreparedAttachment> {
  const { signal } = options;
  signal?.throwIfAborted();
  assertSafeAttachmentName(file.name);
  if (file.size > maxProcessedAttachmentBytes)
    throw new RangeError("Files must be 20 MiB or smaller.");
  let bytes = await readBoundedStream(file.stream(), {
    maxBytes: maxProcessedAttachmentBytes,
    expectedBytes: file.size,
    signal,
  });
  let name = sanitizeAttachmentName(file.name);
  let contentType = normalizeAttachmentContentType(file.type);
  try {
    contentType = inspectAttachmentBytes(bytes, name, contentType);
    const dimensions = readImageDimensions(bytes, contentType);
    let optimized: Blob | null = null;
    if (
      dimensions &&
      !dimensions.animated &&
      file.size >= 128 * 1024 &&
      ["image/jpeg", "image/png", "image/webp"].includes(contentType)
    ) {
      optimized = await optimizeImage(new Blob([bytes], { type: contentType }), signal);
      if (optimized) {
        contentType = "image/webp";
        name = replaceExtension(name, "webp");
      }
    } else if (["video/mp4", "video/webm"].includes(contentType)) {
      optimized = await optimizeVideo(new Blob([bytes], { type: contentType }), options);
      if (optimized) {
        contentType = "video/webm";
        name = replaceExtension(name, "webm");
      }
    }
    if (optimized) {
      bytes.fill(0);
      bytes = await readBoundedStream(optimized.stream(), {
        maxBytes: maxProcessedAttachmentBytes,
        signal,
      });
      inspectAttachmentBytes(bytes, name, contentType);
    }
    const compressed = await compressAttachmentBytes(bytes, signal);
    if (compressed.bytes !== bytes) bytes.fill(0);
    return { ...compressed, name, contentType };
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

export async function validateAttachmentPreview(
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
  signal?: AbortSignal,
): Promise<void> {
  const dimensions = readImageDimensions(bytes, type);
  if (type.startsWith("image/")) {
    if (!dimensions || dimensions.animated)
      throw new Error("This image is available as a download only.");
    assertSafeDimensions(dimensions);
  } else if (type.startsWith("video/")) {
    const video = document.createElement("video");
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    try {
      const metadata = waitForMedia(video, "loadedmetadata", signal);
      video.src = url;
      await metadata;
      assertSafeDimensions({ width: video.videoWidth, height: video.videoHeight });
    } finally {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }
}
