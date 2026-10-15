# Legacy AES-GCM Helper

This standalone helper predates chat integration and is **not used by the messaging UI**. New chat sends use the first-party device protocol in [`../crypto/`](../crypto/README.md). This package remains only for its isolated boundary examples; it does not provide chat key exchange or the current device lifecycle.

This standalone folder contains a browser-side encryption module with no external runtime or cryptography package. It uses the browser's built-in Web Crypto API and AES-256-GCM.

## Current status

This is an experimental symmetric-encryption building block, not a complete end-to-end messaging protocol. It is not connected to Untold's chat UI or backend. Keep real messages in mock mode until key sharing, device identity, storage, membership changes, and the complete message flow have been designed and reviewed.

## API

- `generateSharedSecret()` creates a random 256-bit secret as an unpadded base64url string.
- `encryptMessage(text, secret, context)` returns a binary ciphertext envelope.
- `decryptMessage(envelope, secret, context)` authenticates and decrypts that envelope.

Use a different random secret for each conversation. Share it with the intended participants through a separately verified channel. Never send it to the Untold API, Portways, Ably, or a message in the conversation it protects.

The envelope is `UNTL` + format version + a fresh 12-byte nonce + the Web Crypto AES-GCM ciphertext and 16-byte authentication tag. The conversation ID and stable client message ID are authenticated as additional data. They remain outside the ciphertext, so the caller and backend already know those identifiers.

Example:

```ts
import {
  decryptMessage,
  encryptMessage,
  generateSharedSecret,
} from "./src/index";

const secret = generateSharedSecret();
const context = { conversationId: "conversation-123", messageId: "message-456" };
const envelope = await encryptMessage("Hello", secret, context);
const plaintext = await decryptMessage(envelope, secret, context);
```

The browser must provide Web Crypto in a secure context, such as HTTPS or localhost. The envelope is capped at 64 KiB to match the current message API limit.

Build this package with `npm install` followed by `npm run build`. The build emits browser JavaScript and TypeScript declarations into `dist/`; it has no runtime dependencies.

## Security limits

This module does not provide key exchange, sender identity, device verification, replay prevention, forward secrecy, key rotation, group membership updates, encrypted local storage, or account/device recovery. Every participant who knows the shared secret can decrypt messages and create messages that authenticate under that secret. Random nonces reduce collision risk but do not provide a durable per-key counter. JavaScript memory wiping is best-effort; the shared-secret string may remain in memory until garbage collection.

This folder is intended to be bundled into the browser application. It does not need a hosted encryption server, and no secret key should be placed in server environment variables. The package can be built and deployed separately to distribute public code, but doing so does not create a trusted key service; the chat must still verify the delivered code and manage keys on user devices.

## No external crypto dependency

The implementation uses the platform Web Crypto API. It does not implement AES, random-number generation, key agreement, or a novel cryptographic protocol itself. Reusing browser-provided standard primitives avoids shipping a third-party cryptography package while keeping the cryptographic primitives maintained by the browser.
