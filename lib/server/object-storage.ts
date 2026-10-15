import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type ObjectStorage = {
  bucket: string;
  prefix: string;
  publicClient: S3Client;
  dataClient: S3Client;
};

const globalForObjectStorage = globalThis as typeof globalThis & {
  untoldObjectStorage?: ObjectStorage | null;
};

function validEndpoint(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === "https:" || endpoint.protocol === "http:" ? endpoint.toString() : null;
  } catch {
    return null;
  }
}

function normalizePrefix(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  if (!trimmed) return "";
  if (!/^[A-Za-z0-9/_-]+$/.test(trimmed) || trimmed.split("/").some((part) => part === "..")) {
    return null;
  }
  return `${trimmed}/`;
}

export function getObjectStorage(): ObjectStorage | null {
  if (globalForObjectStorage.untoldObjectStorage !== undefined) {
    return globalForObjectStorage.untoldObjectStorage;
  }

  const publicEndpoint = validEndpoint(process.env.S3_ENDPOINT);
  const internalEndpoint = validEndpoint(process.env.S3_INTERNAL_ENDPOINT);
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const prefix = normalizePrefix(process.env.S3_PREFIX);
  if (!publicEndpoint || !bucket || !accessKeyId || !secretAccessKey || prefix === null) {
    globalForObjectStorage.untoldObjectStorage = null;
    return null;
  }

  const region = process.env.S3_REGION?.trim() || "auto";
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";
  const credentials = { accessKeyId, secretAccessKey };
  const common = {
    region,
    forcePathStyle,
    credentials,
    requestChecksumCalculation: "WHEN_REQUIRED" as const,
    responseChecksumValidation: "WHEN_REQUIRED" as const,
  };
  const publicClient = new S3Client({ ...common, endpoint: publicEndpoint });
  const dataClient = internalEndpoint && internalEndpoint !== publicEndpoint
    ? new S3Client({ ...common, endpoint: internalEndpoint })
    : publicClient;

  const storage = { bucket, prefix, publicClient, dataClient };
  globalForObjectStorage.untoldObjectStorage = storage;
  return storage;
}

export function createAttachmentObjectKey(storage: ObjectStorage): string {
  return `${storage.prefix}attachments/${crypto.randomUUID()}`;
}

export async function storeEncryptedAttachment(
  objectKey: string,
  ciphertext: Uint8Array,
): Promise<void> {
  const storage = getObjectStorage();
  if (!storage) throw new Error("Encrypted file storage is not configured.");
  await storage.dataClient.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
    Body: ciphertext,
    ContentLength: ciphertext.byteLength,
    ContentType: "application/octet-stream",
    ContentDisposition: "attachment",
    CacheControl: "private, no-store",
  }), { abortSignal: AbortSignal.timeout(30_000) });
}

export async function removeEncryptedAttachment(objectKey: string): Promise<void> {
  const storage = getObjectStorage();
  if (!storage) return;
  await storage.dataClient.send(new DeleteObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
  }), { abortSignal: AbortSignal.timeout(15_000) });
}

export async function createAttachmentDownloadUrl(objectKey: string): Promise<string> {
  const storage = getObjectStorage();
  if (!storage) throw new Error("Encrypted file storage is not configured.");
  return getSignedUrl(
    storage.publicClient,
    new GetObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      ResponseContentType: "application/octet-stream",
      ResponseContentDisposition: "attachment",
      ResponseCacheControl: "private, no-store",
    }),
    { expiresIn: 5 * 60 },
  );
}
