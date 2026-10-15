// Keep the independent processing limit at or below crypto's 20 MiB wire limit.
export const maxProcessedAttachmentBytes = 20 * 1024 * 1024;
export const maxImagePixels = 24_000_000;
export const maxMediaEdge = 8192;

const dangerousExtension =
  /\.(?:exe|dll|com|scr|msi|msp|bat|cmd|ps1|psm1|vbs|vbe|js|mjs|cjs|jse|wsf|wsh|hta|lnk|url|webloc|scf|reg|inf|chm|desktop|app|dmg|pkg|deb|rpm|appx|msix|appxbundle|msixbundle|sh|bash|zsh|py|pyw|rb|pl|pm|php|phtml|phar|cgi|lua|jar|class|wasm|apk|aab|ipa|docm|xlsm|pptm)$/i;

export function assertSafeAttachmentName(name: string): void {
  if (dangerousExtension.test(name.replace(/[.\s]+$/g, ""))) {
    throw new Error(
      "Executable files, scripts, shortcuts, and macro-enabled documents cannot be shared.",
    );
  }
}

function matches(bytes: Uint8Array, offset: number, values: number[]): boolean {
  return values.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function sniffAttachmentType(bytes: Uint8Array, claimed = ""): string | null {
  if (matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (matches(bytes, 0, [255, 216, 255])) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "audio/wav";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "M4A ", "dash"].includes(brand)) {
      return claimed === "audio/mp4" || brand === "M4A " ? "audio/mp4" : "video/mp4";
    }
  }
  if (matches(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return claimed === "audio/webm" ? "audio/webm" : "video/webm";
  }
  if (ascii(bytes, 0, 4) === "OggS") return claimed === "video/ogg" ? "video/ogg" : "audio/ogg";
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "audio/aac";
  if (
    ascii(bytes, 0, 3) === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) !== 0)
  )
    return "audio/mpeg";
  return null;
}

export type ImageDimensions = { width: number; height: number; animated?: boolean };

// Inspect dimensions before invoking a native image decoder or allocating a canvas.
export function readImageDimensions(bytes: Uint8Array, type: string): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png" && bytes.length >= 24 && ascii(bytes, 12, 4) === "IHDR") {
    if (view.getUint32(8) !== 13) return null;
    let offset = 8;
    let animated = false;
    while (offset + 12 <= bytes.length) {
      const chunk = ascii(bytes, offset + 4, 4);
      if (chunk === "acTL") animated = true;
      if (chunk === "IDAT") break;
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) break;
      offset += length + 12;
    }
    return { width: view.getUint32(16), height: view.getUint32(20), animated };
  }
  if (type === "image/gif" && bytes.length >= 10) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true), animated: true };
  }
  if (type === "image/webp" && bytes.length >= 30) {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X") {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
        animated: (bytes[20] & 2) !== 0,
      };
    }
    if (chunk === "VP8 " && matches(bytes, 23, [0x9d, 0x01, 0x2a])) {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
    }
  }
  if (type === "image/jpeg") {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 8) return null;
        return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
      }
      offset += length;
    }
  }
  return null;
}

export function assertSafeDimensions({ width, height }: ImageDimensions): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > maxMediaEdge ||
    height > maxMediaEdge ||
    width * height > maxImagePixels
  ) {
    throw new Error(
      "This image or video is too large to process safely. Use a smaller resolution.",
    );
  }
}

export function inspectAttachmentBytes(
  bytes: Uint8Array,
  name: string,
  claimedType: string,
): string {
  if (bytes.byteLength > maxProcessedAttachmentBytes)
    throw new Error("Files must be 20 MiB or smaller.");
  assertSafeAttachmentName(name);
  if (
    ascii(bytes, 0, 2) === "MZ" ||
    matches(bytes, 0, [0x7f, 0x45, 0x4c, 0x46]) ||
    ascii(bytes, 0, 2) === "#!" ||
    [
      [0xfe, 0xed, 0xfa, 0xce],
      [0xfe, 0xed, 0xfa, 0xcf],
      [0xce, 0xfa, 0xed, 0xfe],
      [0xcf, 0xfa, 0xed, 0xfe],
      [0xca, 0xfe, 0xba, 0xbe],
      [0xbe, 0xba, 0xfe, 0xca],
      [0xca, 0xfe, 0xba, 0xbf],
      [0xbf, 0xba, 0xfe, 0xca],
    ].some((signature) => matches(bytes, 0, signature))
  ) {
    throw new Error("Executable files and scripts cannot be shared.");
  }
  const detected = sniffAttachmentType(bytes, claimedType);
  if (
    /^(?:image|video|audio)\//.test(claimedType) &&
    [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
      "video/mp4",
      "video/webm",
      "video/ogg",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
      "audio/webm",
      "audio/ogg",
      "audio/aac",
    ].includes(claimedType) &&
    detected !== claimedType
  ) {
    throw new Error("The file contents do not match its media type.");
  }
  const type = detected ?? claimedType;
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type)) {
    const dimensions = readImageDimensions(bytes, type);
    if (!dimensions) throw new Error("The image header is invalid or unsupported.");
    assertSafeDimensions(dimensions);
  }
  return type;
}
