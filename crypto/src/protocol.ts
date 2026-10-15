import type { AccountIdentity, DeviceApproval } from "./account-types";

const protocolName = "untold-e2ee";
const protocolVersion = 1;
const maxDevicesPerConversation = 32;
const maxEnvelopeBytes = 64 * 1024;
const maxPlaintextBytes = 8 * 1024;
export const maxAttachmentBytes = 20 * 1024 * 1024;
export const attachmentCiphertextOverhead = 16;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export type PublicDevice = Readonly<{
  userId: string;
  userName: string;
  deviceId: string;
  deviceName: string;
  agreementKey: string;
  signingKey: string;
  revoked: boolean;
  accountIdentity?: AccountIdentity;
  approval?: DeviceApproval | null;
  approved?: boolean;
  linkHash?: string | null;
  linkExpiresAt?: string | null;
}>;

export type DeviceTrust = PublicDevice & Readonly<{ trust: "verified" | "new" | "changed" }>;

export type LocalDevice = Readonly<{
  accountId: string;
  deviceId: string;
  agreementPrivateKey: CryptoKey;
  signingPrivateKey: CryptoKey;
  agreementKey: string;
  signingKey: string;
}>;

export type MessageContext = Readonly<{
  conversationId: string;
  messageId: string;
  senderId: string;
}>;

type WrappedKey = {
  deviceId: string;
  salt: string;
  nonce: string;
  ciphertext: string;
};

type WireEnvelope = {
  protocol: typeof protocolName;
  version: typeof protocolVersion;
  conversationId: string;
  messageId: string;
  senderId: string;
  senderDeviceId: string;
  nonce: string;
  ciphertext: string;
  wrappedKeys: WrappedKey[];
  signature: string;
};

type StoredIdentity = {
  accountId: string;
  deviceId: string;
  agreementPrivateKey: CryptoKey;
  signingPrivateKey: CryptoKey;
  agreementKey: string;
  signingKey: string;
};

type StoredTrust = {
  id: string;
  accountId: string;
  userId: string;
  deviceId: string;
  agreementKey: string;
  signingKey: string;
};

const databaseName = "untold-cryptographic-state";
const databaseVersion = 2;
const identityStore = "identities";
const trustStore = "trusted-devices";

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("This browser does not provide secure Web Crypto. Open Untold over HTTPS.");
  }
  return globalThis.crypto;
}

function openKeyDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser cannot store device keys locally."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(identityStore)) {
        database.createObjectStore(identityStore, { keyPath: "accountId" });
      }
      if (!database.objectStoreNames.contains(trustStore)) {
        database.createObjectStore(trustStore, { keyPath: "id" });
      }
      for (const name of ["account-roots", "account-links", "verified-accounts"]) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath: "id" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Local cryptographic storage could not be opened."));
    request.onblocked = () =>
      reject(new Error("Close other Untold tabs to update local key storage."));
  });
}

export function readCryptoRecord<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return openKeyDatabase().then(
    (database) =>
      new Promise<T | undefined>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(new Error("Local cryptographic state could not be read."));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => database.close();
      }),
  );
}

export function writeCryptoRecord(storeName: string, value: object): Promise<void> {
  return openKeyDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(value);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(new Error("Local cryptographic state could not be saved."));
        };
        transaction.onabort = () => {
          database.close();
          reject(new Error("Local cryptographic state could not be saved."));
        };
      }),
  );
}

const readRecord = readCryptoRecord;
const writeRecord = writeCryptoRecord;

export function updateCryptoRecord<T extends object>(
  storeName: string,
  key: IDBValidKey,
  update: (current: T | undefined) => T,
): Promise<T> {
  return openKeyDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        let saved: T;
        let failure: unknown;
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            saved = update(request.result as T | undefined);
            store.put(saved);
          } catch (caught) {
            failure = caught;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(saved);
        };
        transaction.onabort = transaction.onerror = () => {
          database.close();
          reject(failure ?? new Error("Local cryptographic state could not be saved."));
        };
      }),
  );
}

function saveFirstIdentity(candidate: StoredIdentity): Promise<StoredIdentity> {
  return openKeyDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(identityStore, "readwrite");
        const store = transaction.objectStore(identityStore);
        let saved = candidate;
        const request = store.get(candidate.accountId);
        request.onsuccess = () => {
          if (request.result) saved = request.result as StoredIdentity;
          else store.add(candidate);
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(saved);
        };
        transaction.onabort = transaction.onerror = () => {
          database.close();
          reject(new Error("Local cryptographic state could not be saved."));
        };
      }),
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string, maxBytes = maxEnvelopeBytes): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil((maxBytes * 4) / 3)) {
    throw new Error("Encrypted message has an invalid encoding.");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  let binary: string;
  try {
    binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    throw new Error("Encrypted message has an invalid encoding.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.byteLength > maxBytes || bytesToBase64Url(bytes) !== value) {
    bytes.fill(0);
    throw new Error("Encrypted message has an invalid encoding.");
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("The device directory returned an invalid public key.");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function stableEnvelope(envelope: Omit<WireEnvelope, "signature">): Uint8Array<ArrayBuffer> {
  const ordered = {
    protocol: envelope.protocol,
    version: envelope.version,
    conversationId: envelope.conversationId,
    messageId: envelope.messageId,
    senderId: envelope.senderId,
    senderDeviceId: envelope.senderDeviceId,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    wrappedKeys: [...envelope.wrappedKeys]
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
      .map(({ deviceId, salt, nonce, ciphertext }) => ({ deviceId, salt, nonce, ciphertext })),
  };
  return textEncoder.encode(JSON.stringify(ordered));
}

function messageAdditionalData(context: MessageContext, deviceId: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(
    `${protocolName}\n${protocolVersion}\n${context.conversationId}\n${context.messageId}\n${context.senderId}\n${deviceId}`,
  );
}

function attachmentAdditionalData(
  context: MessageContext,
  senderDeviceId: string,
  attachmentId: string,
): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(
    `${protocolName}\n${protocolVersion}\nattachment\n${context.conversationId}\n${context.messageId}\n${context.senderId}\n${senderDeviceId}\n${attachmentId}`,
  );
}

function wrapAdditionalData(
  context: MessageContext,
  senderDeviceId: string,
  recipientDeviceId: string,
): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(
    `${protocolName}\n${protocolVersion}\nkey\n${context.conversationId}\n${context.messageId}\n${context.senderId}\n${senderDeviceId}\n${recipientDeviceId}`,
  );
}

function trustRecordId(accountId: string, userId: string, deviceId: string): string {
  return `${accountId}\u0000${userId}\u0000${deviceId}`;
}

export async function loadOrCreateLocalDevice(accountId: string): Promise<LocalDevice> {
  if (!accountId) throw new TypeError("Account ID is required for local device keys.");
  const existing = await readRecord<StoredIdentity>(identityStore, accountId);
  if (existing) return existing;

  const api = webCrypto();
  const [agreementPair, signingPair] = await Promise.all([
    api.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
    api.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]),
  ]);
  const candidate: StoredIdentity = {
    accountId,
    deviceId: api.randomUUID(),
    agreementPrivateKey: agreementPair.privateKey,
    signingPrivateKey: signingPair.privateKey,
    agreementKey: bytesToBase64Url(
      new Uint8Array(await api.subtle.exportKey("spki", agreementPair.publicKey)),
    ),
    signingKey: bytesToBase64Url(
      new Uint8Array(await api.subtle.exportKey("spki", signingPair.publicKey)),
    ),
  };

  // Serialize the final read/add in IndexedDB, including across tabs.
  return saveFirstIdentity(candidate);
}

export async function classifyDeviceTrust(
  accountId: string,
  devices: readonly PublicDevice[],
): Promise<DeviceTrust[]> {
  if (devices.some((device) => device.accountIdentity)) {
    const { classifyAccountDevices } = await import("./account-trust");
    return classifyAccountDevices(accountId, devices);
  }
  const local = await readRecord<StoredIdentity>(identityStore, accountId);
  return Promise.all(
    devices.map(async (device) => {
      const isLocal =
        device.userId === accountId &&
        local?.deviceId === device.deviceId &&
        local.agreementKey === device.agreementKey &&
        local.signingKey === device.signingKey;
      if (isLocal) return { ...device, trust: "verified" as const };

      if (device.userId === accountId && local?.deviceId === device.deviceId) {
        return { ...device, trust: "changed" as const };
      }

      const saved = await readRecord<StoredTrust>(
        trustStore,
        trustRecordId(accountId, device.userId, device.deviceId),
      );
      if (!saved) return { ...device, trust: "new" as const };
      if (saved.agreementKey !== device.agreementKey || saved.signingKey !== device.signingKey) {
        return { ...device, trust: "changed" as const };
      }
      return { ...device, trust: "verified" as const };
    }),
  );
}

export async function hasLegacyDeviceTrust(
  accountId: string,
  device: PublicDevice,
): Promise<boolean> {
  const saved = await readRecord<StoredTrust>(
    trustStore,
    trustRecordId(accountId, device.userId, device.deviceId),
  );
  return Boolean(
    saved && saved.agreementKey === device.agreementKey && saved.signingKey === device.signingKey,
  );
}

export async function deviceFingerprint(device: PublicDevice): Promise<string> {
  const api = webCrypto();
  const input = textEncoder.encode(`${device.agreementKey}\n${device.signingKey}`);
  const digest = new Uint8Array(await api.subtle.digest("SHA-256", input));
  const fingerprint = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return fingerprint.match(/.{1,4}/g)?.join(" ") ?? fingerprint;
}

export async function verifyDeviceFingerprint(
  accountId: string,
  device: PublicDevice,
): Promise<void> {
  const existing = await readRecord<StoredTrust>(
    trustStore,
    trustRecordId(accountId, device.userId, device.deviceId),
  );
  if (
    existing &&
    (existing.agreementKey !== device.agreementKey || existing.signingKey !== device.signingKey)
  ) {
    throw new Error("This device key changed. Stop and verify the account with its owner.");
  }
  await writeRecord(trustStore, {
    id: trustRecordId(accountId, device.userId, device.deviceId),
    accountId,
    userId: device.userId,
    deviceId: device.deviceId,
    agreementKey: device.agreementKey,
    signingKey: device.signingKey,
  } satisfies StoredTrust);
}

export async function encryptMessageForDevices(
  plaintext: string,
  context: MessageContext,
  localDevice: LocalDevice,
  recipients: readonly PublicDevice[],
): Promise<string> {
  if (
    typeof plaintext !== "string" ||
    textEncoder.encode(plaintext).byteLength > maxPlaintextBytes
  ) {
    throw new RangeError("Message exceeds the encrypted text limit.");
  }
  if (recipients.length === 0 || recipients.length > maxDevicesPerConversation) {
    throw new Error(
      `A conversation must have 1 to ${maxDevicesPerConversation} registered devices.`,
    );
  }
  if (
    !recipients.some(
      ({ userId, deviceId }) =>
        userId === localDevice.accountId && deviceId === localDevice.deviceId,
    )
  ) {
    throw new Error(
      "This browser is missing from the conversation device directory. Reload and try again.",
    );
  }
  if (recipients.some(({ revoked }) => revoked)) {
    throw new Error("Revoked devices cannot receive new message keys.");
  }

  const api = webCrypto();
  const cleartext = textEncoder.encode(plaintext);
  const messageKeyBytes = new Uint8Array(32);
  const messageNonce = new Uint8Array(12);
  api.getRandomValues(messageKeyBytes);
  api.getRandomValues(messageNonce);
  const messageKey = await api.subtle.importKey("raw", messageKeyBytes, "AES-GCM", false, [
    "encrypt",
  ]);
  const encryptedMessage = new Uint8Array(
    await api.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: messageNonce,
        additionalData: messageAdditionalData(context, localDevice.deviceId),
        tagLength: 128,
      },
      messageKey,
      cleartext,
    ),
  );

  try {
    const wrappedKeys: WrappedKey[] = [];
    const uniqueDevices = new Set<string>();
    for (const recipient of recipients) {
      if (uniqueDevices.has(recipient.deviceId))
        throw new Error("The device directory contains a duplicate device.");
      uniqueDevices.add(recipient.deviceId);
      const recipientPublicKey = await api.subtle.importKey(
        "spki",
        base64UrlToBytes(recipient.agreementKey, 256),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );
      const shared = new Uint8Array(
        await api.subtle.deriveBits(
          { name: "ECDH", public: recipientPublicKey },
          localDevice.agreementPrivateKey,
          256,
        ),
      );
      const salt = new Uint8Array(16);
      const nonce = new Uint8Array(12);
      api.getRandomValues(salt);
      api.getRandomValues(nonce);
      try {
        const hkdf = await api.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
        const wrappingKey = await api.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt,
            info: wrapAdditionalData(context, localDevice.deviceId, recipient.deviceId),
          },
          hkdf,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt"],
        );
        const wrapped = new Uint8Array(
          await api.subtle.encrypt(
            {
              name: "AES-GCM",
              iv: nonce,
              additionalData: wrapAdditionalData(context, localDevice.deviceId, recipient.deviceId),
              tagLength: 128,
            },
            wrappingKey,
            messageKeyBytes,
          ),
        );
        wrappedKeys.push({
          deviceId: recipient.deviceId,
          salt: bytesToBase64Url(salt),
          nonce: bytesToBase64Url(nonce),
          ciphertext: bytesToBase64Url(wrapped),
        });
        wrapped.fill(0);
      } finally {
        shared.fill(0);
        salt.fill(0);
        nonce.fill(0);
      }
    }

    const unsigned: Omit<WireEnvelope, "signature"> = {
      protocol: protocolName,
      version: protocolVersion,
      conversationId: context.conversationId,
      messageId: context.messageId,
      senderId: context.senderId,
      senderDeviceId: localDevice.deviceId,
      nonce: bytesToBase64Url(messageNonce),
      ciphertext: bytesToBase64Url(encryptedMessage),
      wrappedKeys,
    };
    const signature = new Uint8Array(
      await api.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        localDevice.signingPrivateKey,
        stableEnvelope(unsigned),
      ),
    );
    const wire = textEncoder.encode(
      JSON.stringify({ ...unsigned, signature: bytesToBase64Url(signature) }),
    );
    if (wire.byteLength > maxEnvelopeBytes)
      throw new RangeError("Encrypted message envelope is too large.");
    return bytesToBase64(wire);
  } finally {
    cleartext.fill(0);
    messageKeyBytes.fill(0);
    messageNonce.fill(0);
    encryptedMessage.fill(0);
  }
}

function parseWireEnvelope(encoded: string): WireEnvelope {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error("This message is not a valid encrypted envelope.");
  }
  if (binary.length === 0 || binary.length > maxEnvelopeBytes) {
    throw new Error("Encrypted message envelope has an invalid size.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let envelope: unknown;
  try {
    envelope = JSON.parse(textDecoder.decode(bytes));
  } catch {
    throw new Error("This message uses an unsupported encrypted format.");
  } finally {
    bytes.fill(0);
  }
  if (!envelope || typeof envelope !== "object")
    throw new Error("Encrypted message envelope is invalid.");
  const value = envelope as Partial<WireEnvelope>;
  if (
    value.protocol !== protocolName ||
    value.version !== protocolVersion ||
    typeof value.conversationId !== "string" ||
    typeof value.messageId !== "string" ||
    typeof value.senderId !== "string" ||
    typeof value.senderDeviceId !== "string" ||
    typeof value.nonce !== "string" ||
    typeof value.ciphertext !== "string" ||
    typeof value.signature !== "string" ||
    !Array.isArray(value.wrappedKeys) ||
    value.wrappedKeys.length === 0 ||
    value.wrappedKeys.length > maxDevicesPerConversation
  ) {
    throw new Error("Encrypted message envelope is invalid or unsupported.");
  }
  for (const wrapped of value.wrappedKeys) {
    if (
      !wrapped ||
      typeof wrapped.deviceId !== "string" ||
      typeof wrapped.salt !== "string" ||
      typeof wrapped.nonce !== "string" ||
      typeof wrapped.ciphertext !== "string"
    ) {
      throw new Error("Encrypted message key envelope is invalid.");
    }
  }
  return value as WireEnvelope;
}

export async function decryptMessageForDevice(
  encodedEnvelope: string,
  context: MessageContext,
  recipientDevice: LocalDevice,
  senderDevice: PublicDevice,
): Promise<string> {
  const envelope = parseWireEnvelope(encodedEnvelope);
  if (
    envelope.conversationId !== context.conversationId ||
    envelope.messageId !== context.messageId ||
    envelope.senderId !== context.senderId ||
    envelope.senderDeviceId !== senderDevice.deviceId ||
    senderDevice.userId !== context.senderId
  ) {
    throw new Error("Message identity does not match its authenticated conversation record.");
  }
  const api = webCrypto();
  const unsigned: Omit<WireEnvelope, "signature"> = {
    protocol: envelope.protocol,
    version: envelope.version,
    conversationId: envelope.conversationId,
    messageId: envelope.messageId,
    senderId: envelope.senderId,
    senderDeviceId: envelope.senderDeviceId,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    wrappedKeys: envelope.wrappedKeys,
  };
  const signingPublicKey = await api.subtle.importKey(
    "spki",
    base64UrlToBytes(senderDevice.signingKey, 256),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const signatureOk = await api.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    signingPublicKey,
    base64UrlToBytes(envelope.signature, 128),
    stableEnvelope(unsigned),
  );
  if (!signatureOk)
    throw new Error("Message signature is invalid. The message may have been changed.");

  const wrapped = envelope.wrappedKeys.find(
    ({ deviceId }) => deviceId === recipientDevice.deviceId,
  );
  if (!wrapped)
    throw new Error("This device was added after the message was sent and cannot open it.");
  const senderAgreementKey = await api.subtle.importKey(
    "spki",
    base64UrlToBytes(senderDevice.agreementKey, 256),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await api.subtle.deriveBits(
      { name: "ECDH", public: senderAgreementKey },
      recipientDevice.agreementPrivateKey,
      256,
    ),
  );
  const salt = base64UrlToBytes(wrapped.salt, 16);
  const wrapNonce = base64UrlToBytes(wrapped.nonce, 12);
  const wrappedBytes = base64UrlToBytes(wrapped.ciphertext, 64);
  let messageKeyBytes: Uint8Array<ArrayBuffer> | null = null;
  let cleartext: Uint8Array<ArrayBuffer> | null = null;
  try {
    const hkdf = await api.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const info = wrapAdditionalData(context, envelope.senderDeviceId, recipientDevice.deviceId);
    const wrappingKey = await api.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info },
      hkdf,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    messageKeyBytes = new Uint8Array(
      await api.subtle.decrypt(
        { name: "AES-GCM", iv: wrapNonce, additionalData: info, tagLength: 128 },
        wrappingKey,
        wrappedBytes,
      ),
    );
    const messageKey = await api.subtle.importKey("raw", messageKeyBytes, "AES-GCM", false, [
      "decrypt",
    ]);
    const messageNonce = base64UrlToBytes(envelope.nonce, 12);
    const ciphertext = base64UrlToBytes(envelope.ciphertext, maxPlaintextBytes + 16);
    try {
      cleartext = new Uint8Array(
        await api.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: messageNonce,
            additionalData: messageAdditionalData(context, envelope.senderDeviceId),
            tagLength: 128,
          },
          messageKey,
          ciphertext,
        ),
      );
      if (cleartext.byteLength > maxPlaintextBytes)
        throw new Error("Decrypted message exceeds the size limit.");
      return textDecoder.decode(cleartext);
    } finally {
      messageNonce.fill(0);
      ciphertext.fill(0);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Message ")) throw error;
    throw new Error("Message authentication failed. Check verified device keys and try again.");
  } finally {
    shared.fill(0);
    salt.fill(0);
    wrapNonce.fill(0);
    wrappedBytes.fill(0);
    messageKeyBytes?.fill(0);
    cleartext?.fill(0);
  }
}

export async function encryptAttachmentBytes(
  plaintext: Uint8Array<ArrayBuffer>,
  context: MessageContext,
  senderDevice: LocalDevice,
  attachmentId: string,
): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; key: string; nonce: string }> {
  if (plaintext.byteLength > maxAttachmentBytes) {
    throw new RangeError("Files must be 20 MiB or smaller.");
  }
  if (!attachmentId) throw new TypeError("Attachment ID is required.");

  const api = webCrypto();
  const keyBytes = new Uint8Array(32);
  const nonce = new Uint8Array(12);
  api.getRandomValues(keyBytes);
  api.getRandomValues(nonce);
  try {
    const key = await api.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(
      await api.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData: attachmentAdditionalData(context, senderDevice.deviceId, attachmentId),
          tagLength: 128,
        },
        key,
        plaintext,
      ),
    );
    return {
      ciphertext,
      key: bytesToBase64Url(keyBytes),
      nonce: bytesToBase64Url(nonce),
    };
  } finally {
    keyBytes.fill(0);
    nonce.fill(0);
  }
}

export async function decryptAttachmentBytes(
  ciphertext: Uint8Array<ArrayBuffer>,
  context: MessageContext,
  senderDeviceId: string,
  attachmentId: string,
  keyValue: string,
  nonceValue: string,
  expectedPlaintextBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    !Number.isSafeInteger(expectedPlaintextBytes) ||
    expectedPlaintextBytes < 0 ||
    expectedPlaintextBytes > maxAttachmentBytes ||
    ciphertext.byteLength !== expectedPlaintextBytes + attachmentCiphertextOverhead
  ) {
    throw new RangeError("Encrypted file size does not match its message details.");
  }

  const api = webCrypto();
  const keyBytes = base64UrlToBytes(keyValue, 32);
  const nonce = base64UrlToBytes(nonceValue, 12);
  if (keyBytes.byteLength !== 32 || nonce.byteLength !== 12) {
    keyBytes.fill(0);
    nonce.fill(0);
    throw new Error("File key material has an invalid size.");
  }
  try {
    const key = await api.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(
      await api.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData: attachmentAdditionalData(context, senderDeviceId, attachmentId),
          tagLength: 128,
        },
        key,
        ciphertext,
      ),
    );
  } catch {
    throw new Error("File authentication failed. Its encrypted bytes may have changed.");
  } finally {
    keyBytes.fill(0);
    nonce.fill(0);
  }
}

export function readEnvelopeSenderDeviceId(encodedEnvelope: string): string {
  return parseWireEnvelope(encodedEnvelope).senderDeviceId;
}

export function encodePublicKeyForStorage(bytes: Uint8Array): string {
  return bytesToBase64Url(bytes);
}

export function decodePublicKeyForStorage(value: string): Uint8Array<ArrayBuffer> {
  return base64UrlToBytes(value, 256);
}

export function encodeEnvelopeForApi(envelope: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(envelope);
}
