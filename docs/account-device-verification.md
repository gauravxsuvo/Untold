# Account safety codes and device approval

## Using the app

Compare the shared account safety code in conversation Details once per contact, from each account. Both people see the same code. Approved phones and computers inherit that account’s verified contacts. Adding or removing an approved device keeps the account code unchanged.

On a new device, sign in and open Settings > Your devices. An existing approved device scans the new device’s QR code, or enters its linking code, then confirms approval. Requests expire after 15 minutes and can be renewed. Only transfer the code through a trusted channel. The new device automatically notices approval. Signing in alone does not authorize it to send or receive newly encrypted messages.

Device names identify the platform and browser, or the installed app. A separate “This device” marker identifies the current device. Previously generic names update when that device next opens the updated app. Names are helpful labels, not proof of hardware identity.

Approval carries over contact verification, not old message keys. Old messages remain readable on the devices that originally received them. Nothing uploads or exports private message keys.

If every approved device is unavailable, the explicit recovery form requires the account password and MFA when enabled. It removes other devices and sessions and replaces the account identity. The person and their contacts must compare the new account code. It cannot recover old history. Removed devices cannot simply register their old keys again; use a fresh browser profile or new device for recovery.

## Implementation and limits

- Migration 014 adds a stable public account identity, signed device approvals, sealed approval responses, expiring request commitments, and signed contact-verification records. Existing accounts are anchored to their oldest remaining device; open that device to approve others, or use explicit recovery if it is unavailable.
- Each device retains its own non-extractable P-256 keys. Approved devices sign enrollment certificates bound to the account identity, target public keys, issuer, and request commitment. Clients and server validate the certificate chain and reject cycles or malformed data.
- The new device generates a 128-bit linking secret. Only its SHA-256 commitment reaches the server during registration. The approving device checks the secret against the exact target keys, signs approval, and seals the trusted account identity with AES-GCM under the secret. The new device decrypts that response to pin the identity. The server does not receive the secret or private signing keys.
- Contact comparisons produce signed account attestations. Approved devices verify and import these records. Local pins reject older conflicting records. A deliberate new comparison on an approved device can carry a changed identity to the person’s other approved devices. Manual comparisons on the older app migrate when they match the account’s anchor keys; the old approved browser must open the updated app to publish them.
- Pending devices are excluded from new message-key wraps and cannot interrupt an existing conversation. The API validates the exact approved recipient set again while holding account locks before inserting a message. New approvals, removals, registration, and recovery serialize against those account locks. Removed issuers cannot publish new approvals or contact attestations; historical signatures and pinned removed-device keys can still authenticate old messages.
- Sensitive writes require an authenticated session, same-origin requests, bounded bodies, rate limits, and cryptographic proof where applicable. Recovery rechecks the live session and password under locks, enforces existing MFA, and consumes a recovery code if used.
- This remains a custom early protocol without forward secrecy, post-compromise security, key transparency, or an independent cryptographic review. It does not prevent a malicious origin from serving malicious JavaScript, and it does not guarantee server freshness. These changes are not a production security certification.

## Release checks still required

Local production webpack compilation, TypeScript, lint, and crypto compilation passed. Static sample-data layout review covered phone, tablet, desktop, and large text. No automated tests or live account/device flows were run for this change.

1. Include every new file, especially migration 014. Deploy using the default `npm run build` on Portways, then `npm start` so migrations complete before serving traffic. The webpack command is the local Windows fallback only.
2. On staging, upgrade two accounts with existing verified chats. Open their original approved devices and confirm matching legacy trust migrates without extra comparisons.
3. Sign in on a new iPhone or Android device. Confirm the device name, pending state, code wrapping, QR scanning/manual linking, and automatic approval update. Verify a wrong, expired, reused, or other-account code fails.
4. Keep an unapproved device open and exchange messages between the existing devices. Then approve it and send both text and a file from it. Confirm the other account sees no new comparison prompt and the approved devices receive new messages.
5. Confirm contacts sync between approved devices, including a deliberate new comparison after identity recovery. Check concurrent tabs, reload, network interruption, and signing in again without deleting browser data.
6. Remove a device and confirm it cannot send or re-register; ensure older authentic messages remain readable on devices that hold their original keys.
7. Exercise recovery with wrong password, missing MFA, wrong/reused TOTP, and used recovery codes; verify valid recovery revokes old devices/sessions and produces an actual code-change warning for contacts.
8. Keep the remaining checks and independent review requirements in release-checklist.md.
