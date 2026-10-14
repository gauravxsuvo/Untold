# Untold Crypto

This folder is the future integration boundary for Untold's browser-side messaging cryptography. The standalone dependency-free AES-GCM helper now lives in [`../encryption/`](../encryption/README.md); this folder remains the place to connect an approved messaging protocol to the app and its transport.

## Status

No messaging protocol or chat integration is implemented here. The package is marked private so it cannot be published accidentally.

## Intended responsibilities

- Adapt a selected, maintained MLS implementation to Untold's browser application and message API.
- Keep plaintext, private device keys, and MLS state on the user's device.
- Send and receive opaque ciphertext through Untold's authenticated backend.
- Define a narrow boundary for device setup, encrypt/decrypt, membership changes, and local state lifecycle after the library is selected.

The backend remains an Untold service. It stores public credentials and authorized opaque ciphertext, checks account and conversation membership, and sends message-ID notifications. It must not receive plaintext or private keys. This package will not host messages or depend on Matrix or Wire's hosted service.

## Current decision

OpenMLS 0.9.1 is the preferred protocol-engine candidate: it is MIT-licensed and has an external SRLabs review. The OpenMLS core tests run on the WASM target in upstream CI, but the separate `openmls-wasm` wrapper is explicitly experimental and unpublished; upstream's WASM job does not test that wrapper as a browser JavaScript API. Its current API is incomplete for Untold's browser state lifecycle and has panic/unimplemented paths. No Rust toolchain is available in this workspace, so that route cannot currently be built or validated here. The browser-native TypeScript MLS candidate is not selected because its published package points to a restrictive Big Time license and no independent audit of its MLS core was found.

The standalone helper in `../encryption/` uses no external package, but does not solve these protocol and device-management requirements. Phase 6 still stops before connecting real messages. Keep the chat UI in mock mode and make no E2EE claims.

## Adoption gates

Before adding an implementation, resolve the candidate's license, supported browser API, independent security review, local key storage and recovery behavior, update policy, and compatibility with Untold's custom transport. See [`../docs/phase-6-e2ee-architecture.md`](../docs/phase-6-e2ee-architecture.md) for the current review.

Do not invent key agreement, ratchets, or attachment encryption. Do not describe the product as end-to-end encrypted until the messaging protocol and integration have passed the documented security gates.

## Next work

1. Get a supported, tested browser API for the selected engine, or have an Untold-owned WASM wrapper and persistence layer independently reviewed.
2. Design and review device identity, verification, local state storage, lock/unlock, and loss/recovery.
3. Add the backend device/key-package directory and ordered, paginated MLS message history.
4. Pin the engine and dependencies, establish a reproducible WASM build, and record the exact versions here.
5. Add adversarial integration tests and a two-device security review before connecting real messages.
