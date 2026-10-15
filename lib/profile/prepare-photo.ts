import { inspectAttachmentBytes } from "@/lib/messaging/attachment-policy";
import { readBoundedStream } from "@/lib/messaging/bounded-stream";
import {
  maxProfilePhotoSourceBytes,
  maxProfilePhotoUploadBytes,
  ProfilePhotoError,
} from "@/lib/profile/photos";

export async function openProfilePhoto(file: File, signal: AbortSignal): Promise<ImageBitmap> {
  if (!file.size || file.size > maxProfilePhotoSourceBytes) {
    throw new ProfilePhotoError("Choose a photo that’s 8 MB or smaller.");
  }
  const bytes = await readBoundedStream(file.stream(), {
    maxBytes: maxProfilePhotoSourceBytes,
    expectedBytes: file.size,
    signal,
  });
  let bitmap: ImageBitmap;
  try {
    const type = inspectAttachmentBytes(bytes, file.name, file.type);
    if (!["image/jpeg", "image/png", "image/webp"].includes(type))
      throw new ProfilePhotoError("Choose a JPG, PNG, or WebP photo.");
    // The inspected header is bounded before a native decoder is invoked.
    bitmap = await createImageBitmap(new Blob([bytes.buffer], { type }));
  } catch (error) {
    if (error instanceof ProfilePhotoError) throw error;
    throw new ProfilePhotoError(
      "We couldn’t open that photo. Try a smaller JPG, PNG, or WebP photo.",
    );
  } finally {
    bytes.fill(0);
  }
  if (signal.aborted) {
    bitmap.close();
    throw signal.reason;
  }
  return bitmap;
}

export async function compressProfilePhoto(canvas: HTMLCanvasElement): Promise<Blob> {
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
  let blob = await encode("image/webp");
  if (blob?.type !== "image/webp") blob = await encode("image/jpeg");
  if (!blob || blob.size > maxProfilePhotoUploadBytes)
    throw new ProfilePhotoError("We couldn’t prepare that photo. Try another photo.");
  return blob;
}
