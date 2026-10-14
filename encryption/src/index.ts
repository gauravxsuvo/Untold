const ENVELOPE_MAGIC = new Uint8Array([0x55, 0x4e, 0x54, 0x4c]); // UNTL
const ENVELOPE_VERSION = 1;
const HEADER_LENGTH = ENVELOPE_MAGIC.byteLength + 1;
const KEY_LENGTH_BYTES = 32;
const NONCE_LENGTH_BYTES = 12;
const TAG_LENGTH_BITS = 128;
const TAG_LENGTH_BYTES = TAG_LENGTH_BITS / 8;
const MAX_ENVELOPE_BYTES = 64 * 1024;
const MAX_CONTEXT_FIELD_BYTES = 512;
const MAX_PLAINTEXT_BYTES =
  MAX_ENVELOPE_BYTES - HEADER_LENGTH - NONCE_LENGTH_BYTES - TAG_LENGTH_BYTES;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export type MessageContext = Readonly<{
  conversationId: string;
  messageId: string;
}>;

/**
 * Create a random 256-bit symmetric secret, encoded as unpadded base64url.
 * Share it with the intended recipient through a separately verified channel.
 */
export function generateSharedSecret(): string {
  const random = requireWebCrypto().getRandomValues(
    new Uint8Array(KEY_LENGTH_BYTES),
  );

  try {
    return encodeBase64Url(random);
  } finally {
    random.fill(0);
  }
}

/**
 * Encrypt UTF-8 text into a versioned binary envelope using AES-256-GCM.
 * The context is authenticated as additional data and is not stored in the envelope.
 */
export async function encryptMessage(
  plaintext: string,
  sharedSecret: string,
  context: MessageContext,
): Promise<Uint8Array> {
  if (typeof plaintext !== "string") {
    throw new TypeError("Plaintext must be a string.");
  }

  const api = requireWebCrypto();
  const plaintextBytes = utf8Encoder.encode(plaintext);

  if (plaintextBytes.byteLength > MAX_PLAINTEXT_BYTES) {
    plaintextBytes.fill(0);
    throw new RangeError(
      `Plaintext exceeds the ${MAX_PLAINTEXT_BYTES}-byte message limit.`,
    );
  }

  const nonce = new Uint8Array(NONCE_LENGTH_BYTES);

  try {
    api.getRandomValues(nonce);
    const key = await importSharedSecret(sharedSecret, "encrypt");
    const additionalData = createAdditionalData(context);
    const ciphertext = new Uint8Array(
      await api.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData,
          tagLength: TAG_LENGTH_BITS,
        },
        key,
        plaintextBytes,
      ),
    );
    const envelope = new Uint8Array(
      HEADER_LENGTH + NONCE_LENGTH_BYTES + ciphertext.byteLength,
    );

    envelope.set(ENVELOPE_MAGIC, 0);
    envelope[ENVELOPE_MAGIC.byteLength] = ENVELOPE_VERSION;
    envelope.set(nonce, HEADER_LENGTH);
    envelope.set(ciphertext, HEADER_LENGTH + NONCE_LENGTH_BYTES);
    ciphertext.fill(0);

    return envelope;
  } finally {
    plaintextBytes.fill(0);
    nonce.fill(0);
  }
}

/**
 * Authenticate and decrypt a message envelope created by `encryptMessage`.
 * The same conversation and message identifiers used during encryption are required.
 */
export async function decryptMessage(
  envelope: Uint8Array,
  sharedSecret: string,
  context: MessageContext,
): Promise<string> {
  if (!(envelope instanceof Uint8Array)) {
    throw new TypeError("Envelope must be a Uint8Array.");
  }

  if (
    envelope.byteLength < HEADER_LENGTH + NONCE_LENGTH_BYTES + TAG_LENGTH_BYTES ||
    envelope.byteLength > MAX_ENVELOPE_BYTES
  ) {
    throw new RangeError("Envelope has an invalid length.");
  }

  // Copy the input so a caller cannot mutate bytes while Web Crypto is using them.
  const envelopeBytes = new Uint8Array(envelope.byteLength);
  envelopeBytes.set(envelope);

  try {
    for (let i = 0; i < ENVELOPE_MAGIC.byteLength; i += 1) {
      if (envelopeBytes[i] !== ENVELOPE_MAGIC[i]) {
        throw new Error("Envelope has an unknown format.");
      }
    }

    if (envelopeBytes[ENVELOPE_MAGIC.byteLength] !== ENVELOPE_VERSION) {
      throw new Error("Envelope version is not supported.");
    }

    const api = requireWebCrypto();
    const nonce = envelopeBytes.slice(HEADER_LENGTH, HEADER_LENGTH + NONCE_LENGTH_BYTES);
    const ciphertext = envelopeBytes.slice(HEADER_LENGTH + NONCE_LENGTH_BYTES);

    try {
      const key = await importSharedSecret(sharedSecret, "decrypt");
      const additionalData = createAdditionalData(context);
      let cleartext: ArrayBuffer;

      try {
        cleartext = await api.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: nonce,
            additionalData,
            tagLength: TAG_LENGTH_BITS,
          },
          key,
          ciphertext,
        );
      } catch {
        throw new Error(
          "Message authentication failed. Check the shared secret and message context, or request a fresh envelope.",
        );
      }

      const cleartextBytes = new Uint8Array(cleartext);

      try {
        return utf8Decoder.decode(cleartextBytes);
      } catch {
        throw new Error("Decrypted message is not valid UTF-8 text.");
      } finally {
        cleartextBytes.fill(0);
      }
    } finally {
      nonce.fill(0);
      ciphertext.fill(0);
    }
  } finally {
    envelopeBytes.fill(0);
  }
}

async function importSharedSecret(
  sharedSecret: string,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const rawKey = decodeSharedSecret(sharedSecret);

  try {
    return await requireWebCrypto().subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM", length: 256 },
      false,
      [usage],
    );
  } finally {
    rawKey.fill(0);
  }
}

function decodeSharedSecret(secret: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new TypeError("Shared secret must be a generated 256-bit base64url value.");
  }

  let binary: string;

  try {
    const base64 = `${secret.replace(/-/g, "+").replace(/_/g, "/")}=`;
    binary = atob(base64);
  } catch {
    throw new TypeError("Shared secret is not valid base64url.");
  }

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  if (
    bytes.byteLength !== KEY_LENGTH_BYTES ||
    encodeBase64Url(bytes) !== secret
  ) {
    bytes.fill(0);
    throw new TypeError("Shared secret must encode exactly 32 bytes.");
  }

  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createAdditionalData(
  context: MessageContext,
): Uint8Array<ArrayBuffer> {
  if (!context || typeof context !== "object") {
    throw new TypeError("Message context is required.");
  }

  const conversationId = encodeContextField(
    context.conversationId,
    "conversationId",
  );
  const messageId = encodeContextField(context.messageId, "messageId");
  const additionalData = new Uint8Array(
    HEADER_LENGTH + 2 + conversationId.byteLength + 2 + messageId.byteLength,
  );

  additionalData.set(ENVELOPE_MAGIC, 0);
  additionalData[ENVELOPE_MAGIC.byteLength] = ENVELOPE_VERSION;

  const view = new DataView(additionalData.buffer);
  let offset = HEADER_LENGTH;
  view.setUint16(offset, conversationId.byteLength, false);
  offset += 2;
  additionalData.set(conversationId, offset);
  offset += conversationId.byteLength;
  view.setUint16(offset, messageId.byteLength, false);
  offset += 2;
  additionalData.set(messageId, offset);

  return additionalData;
}

function encodeContextField(
  value: string,
  name: string,
): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }

  const bytes = utf8Encoder.encode(value);

  if (bytes.byteLength > MAX_CONTEXT_FIELD_BYTES) {
    throw new RangeError(`${name} exceeds the ${MAX_CONTEXT_FIELD_BYTES}-byte limit.`);
  }

  return bytes;
}

function requireWebCrypto(): Crypto {
  const api = globalThis.crypto;

  if (!api?.subtle || typeof api.getRandomValues !== "function") {
    throw new Error("Web Crypto is unavailable. Use a modern browser over HTTPS.");
  }

  return api;
}
