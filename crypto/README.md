# Untold Crypto

This folder contains Untold's first-party browser encryption package and the code used by the chat UI. It has no external cryptography dependency or hosted encryption service. It uses the browser's built-in Web Crypto API and IndexedDB.

## Current status

Protocol v1 encrypts new one-to-one text messages in the browser before they reach the Untold API. The API stores and returns ciphertext envelopes and public device keys. The implementation is early, custom, and has not had an independent security review. Do not treat it as production-secure or use it for high-risk conversations yet.

The older helper in [`../encryption/`](../encryption/README.md) is not used by chat. Historical messages sent before this integration remain plaintext in the database and are labeled as older, unencrypted messages.

## What protocol v1 does

- Creates a P-256 ECDH key pair and a separate P-256 ECDSA signing key pair for each browser profile and account.
- Stores non-extractable private `CryptoKey` objects in IndexedDB. Public SPKI keys are registered with the account's device directory.
- Encrypts each message with a fresh random AES-256-GCM content key and nonce. The content key is wrapped separately to each registered conversation device using ECDH P-256 and HKDF-SHA-256.
- Signs the canonical envelope with the sender device's ECDSA key. Recipients verify the signature and device trust before decrypting.
- Displays a SHA-256 safety code for each device. A new device is not trusted until the user compares the code with its owner over a separate trusted channel. Changed keys are blocked.
- Lets an account revoke another registered device. Revocation also expires other account sessions, removes that device from future message-key wrapping, and retains its public key so older signatures can still be checked. It cannot erase messages already downloaded or ciphertext already stored.

The API limits accounts to 8 devices and conversations to 32 devices. There is no group conversation support.

## Limits

- Protocol v1 has no forward secrecy or post-compromise security. A later compromise of a device's static agreement key may expose old messages addressed to it.
- First-contact safety depends on a real out-of-band code comparison. The app has no key-transparency service.
- Keys have no backup or recovery. Losing a browser profile can make old messages unreadable, and a new device cannot decrypt history sent before it was registered.
- Attachments are not implemented. Account, conversation, device, timing, size, IP, and delivery metadata remain visible to the server; Ably may see message IDs and realtime metadata. A revoked device can still fetch older messages until its session expires.
- The app's origin serves the encryption JavaScript. A malicious deployment or same-origin script compromise can access plaintext while the app is open.
- This code has not had independent cryptographic review or two-browser adversarial verification. See [`../docs/phase-6-e2ee-architecture.md`](../docs/phase-6-e2ee-architecture.md).

## Build

From the repository root:

```sh
npm run build:crypto
```

This compiles the package into ignored `crypto/dist/`. The Next.js app imports `crypto/src/protocol.ts` directly, so the crypto code is bundled into the normal site build. It does not need to be deployed as a separate server or API.

## References

- [W3C Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/)
- [W3C Indexed Database API](https://www.w3.org/TR/IndexedDB/)
- [IETF MLS, RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html), which describes forward secrecy and post-compromise security properties that Untold protocol v1 does not provide.
