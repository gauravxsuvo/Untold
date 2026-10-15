import "server-only";

import sharp from "sharp";
import { sniffAttachmentType, readImageDimensions } from "@/lib/messaging/attachment-policy";
import {
  maxStoredProfilePhotoBytes,
  profilePhotoSize,
  ProfilePhotoError,
} from "@/lib/profile/photos";

// Keep native decoding bounded even when clients skip the browser's resize step.
let processing = 0;
export function acquirePhotoProcessing(): (() => void) | null {
  if (processing >= 2) return null;
  processing++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      processing--;
    }
  };
}

export async function encodeProfilePhoto(bytes: Uint8Array): Promise<Buffer> {
  const type = sniffAttachmentType(bytes);
  if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type)) {
    throw new ProfilePhotoError("Choose a JPG, PNG, or WebP photo.");
  }
  const dimensions = readImageDimensions(bytes, type);
  if (
    !dimensions ||
    dimensions.animated ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > 4096 ||
    dimensions.height > 4096 ||
    dimensions.width * dimensions.height > 4_000_000
  ) {
    throw new ProfilePhotoError("This photo can’t be used. Try a smaller, still photo.");
  }
  try {
    // Sharp strips EXIF, GPS, and other source metadata by default. No originals are stored.
    const image = await sharp(bytes, {
      limitInputPixels: 4_000_000,
      failOn: "warning",
      sequentialRead: true,
      ignoreIcc: true,
    })
      .timeout({ seconds: 5 })
      .rotate()
      .resize(profilePhotoSize, profilePhotoSize, { fit: "cover", position: "centre" })
      .webp({ quality: 75, effort: 3 })
      .toBuffer();
    if (image.byteLength > maxStoredProfilePhotoBytes)
      throw new Error("Photo output exceeds limit.");
    return image;
  } catch {
    throw new ProfilePhotoError("We couldn’t prepare that photo. Try another photo.");
  }
}
