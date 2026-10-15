# Untold release checklist

**Status: deployment is not yet verified after the first-party encryption and attachment integration.** Migration 006 will permanently remove pre-encryption and unsupported message rows at app startup, but it has not been applied to Portways from this workspace. Migration 007 adds attachment records and message links. Message text, attachment metadata, and attachment bytes are encrypted in the browser; live Portways object storage and the full attachment flow are not configured or verified here. Protocol v1 has no forward secrecy and no independent security review. Do not describe Untold as production-secure.

## Current local review (2026-10-15)

Account verification follow-up: account safety codes now persist across signed, approved devices. Migration 014 and the device-linking, recovery, revocation, and migration checks in [account-device-verification.md](account-device-verification.md) are required for this release. File changes compile locally; real multi-device behavior and migration 014 have not been exercised here. Commit-ready does not mean live deployment has been verified.

- [ ] Complete the staging checks in account-device-verification.md before a live rollout, including an existing verified PC chat followed by a newly approved iPhone, expired/wrong linking codes, device removal, recovery, and contact-verification sync.

Empty-chat follow-up: migration 013 adds per-member explicit-start tracking. Empty chats stay in the starter’s list; automatic recipients see them only after a message is committed. Either member can explicitly start the same existing chat without creating a duplicate. Existing message history is preserved. Inbox, Chats, and Contacts share the server visibility filter. Foreground delivery triggers a list refresh for first messages in previously hidden chats.

- [ ] Deploy with migration 013 before serving the updated queries. With two accounts, enter the recipient’s email without sending anything: their Inbox, Chats, and Contacts must stay unchanged. Send the first text or file-only message and confirm the chat appears. Repeat with both people independently starting the same chat and confirm they reuse its ID. Check an older empty chat and confirm only its original starter retains it until explicitly opened by the other person or a message is sent.
- [ ] On an actual iPhone Home Screen install, enable notifications in Settings and send from the other account while the app is backgrounded. Confirm the alert opens the correct chat. iOS implementation is present, but physical-device delivery has not been verified here.

Full-screen chats on screens up to 1000px wide, Settings-only sign out with confirmation, and verification-aware privacy banners are implemented. The complete privacy note remains accessible in Details. A new device requires its owner’s approval, and an account identity reset requires a new contact comparison. A member with only revoked or pending devices cannot satisfy the send checks.

- [x] Production webpack build (including TypeScript) and lint pass. The production dependency audit (`npm audit --omit=dev`) reports zero known vulnerabilities.
- [x] Review static sample-data chat layouts with 100 messages at phone, tablet, landscape, and desktop sizes, including extra-large text at 120% interface zoom and a simulated reduced keyboard viewport. Review Details, list navigation, and Settings placement. These previews do not verify live event handlers, real keyboards, authentication, or delivery.
- [ ] On actual Android and iPhone installs, open a conversation, use the back button, rotate the screen, open the keyboard, and confirm the composer remains visible. Confirm navigation returns on leaving the chat.
- [ ] Verify the account code from each account: the banner should disappear while the note remains in Details. Approve an additional device and confirm no extra contact comparison appears. Recover an account identity and confirm a change warning appears.
- [ ] Confirm Settings sign out can be cancelled, a failed request keeps the session usable with a retry message, and a successful request removes access to authenticated pages.
- [ ] Verify migrations through 012 against the deployment database, including MFA enrollment, sign-in challenges, password recovery, push subscription persistence, notifications, and Received/Read receipts on real devices. Keep earlier encryption, authorization, storage, and security review gates below.

Ready to commit the local implementation after reviewing the complete working-tree diff. Production release still requires the outstanding live checks; no deployment or database migration was performed in this pass.

## Previously verified before the encryption integration (2026-10-15)

- [x] `npm run lint`, `npx tsc --noEmit`, and `npm test` (19 tests) pass; `npm run build` succeeds.
- [x] The production build starts with dev dependencies pruned, binds to `PORT`, and serves pages with the CSP nonce and security headers.
- [x] `npm start` migrates an empty database before serving; two processes starting at once apply each migration exactly once; re-runs are no-ops; a missing `DATABASE_URL` skips migration without crashing.
- [x] Against a local PostgreSQL-compatible server and the production build: migrations apply and re-run cleanly; sign-up, sign-in, wrong-password rejection, and sign-out work; signed-out visitors are redirected away from `/app`; a conversation is found or created by email from either side; both people send and read messages; retried sends are de-duplicated; outsiders get 404 and signed-out callers 401; cross-origin writes get 403; invalid and over-long messages get 400; start-conversation is rate limited (429).
- [x] Sign-in rate limits are tracked per visitor via `cf-connecting-ip`, so one visitor hitting the limit does not block another.
- [x] In a browser: sign-up through the form, starting a conversation, sending with Enter, and receiving the other person's reply without reloading. No console errors.
- [x] After connecting first-party encryption: `npm run build:all`, `npm run lint`, and `git diff --check` pass locally (2026-10-15).
- [ ] Verify migration 006 removes pre-encryption/plaintext rows and preserves valid protocol-v1 envelopes.
- [ ] Re-run the account and two-browser messaging flow with migrations 004–006 and the encrypted envelope format.
- [ ] Verify safety-code exchange, message signature checks, device revocation and other-session expiry, stale device-list rejection, and unreadable history on a newly registered device.
- [ ] Link a private Portways Object Storage add-on and confirm the server receives all `S3_*` variables without exposing its credentials to browser code.
- [ ] Verify migration 007 on Portways and from a second startup. Confirm attachment object keys remain private and files contain ciphertext only.
- [ ] In two browser profiles, share a raster image, video/audio clip, PDF, and arbitrary file; verify lazy preview or playback, decryption/download, progress, retry, discard, and the 20 MiB limit.
- [ ] Confirm a signed-out user, conversation outsider, and unlinked attachment ID cannot obtain a download URL.
- [ ] Arrange an independent review of protocol v1 before relying on it for sensitive conversations.
- [ ] Inspect CSP, HTTPS/HSTS, and security headers on the deployed Portways origin.
- [ ] Run `npm audit` against the exact lockfile.

## Deploying on Portways

1. Create a Postgres add-on. Migrations 004–007 add device management, remove old plaintext/malformed messages, and create attachment records; migrations run automatically when the app starts. Migration 006 deletes legacy chat history from the live database. Backups made before that migration may still contain plaintext.
2. Create a private Portways **Object Storage (S3)** add-on and link it to the same app project. Keep public reads/CDN disabled. Portways injects the scoped `S3_*` settings.
3. Create one Portways project from the repository root and link the Postgres and Object Storage add-ons.
4. Set `BETTER_AUTH_SECRET` (32+ random characters) and `BETTER_AUTH_URL` (the exact public HTTPS origin). Optionally set `ABLY_API_KEY` for instant delivery.
5. Deploy, start with one replica, and confirm the Postgres connection limit and object storage quota/backup retention before scaling.

## Live checks after the first deploy

- Sign up two accounts on different devices, start a conversation, and exchange messages.
- Confirm the session cookie is `Secure` on the public origin and that sign-in works from both devices.
- With Ably configured, confirm messages arrive instantly and the browser console shows no CSP errors.
- Verify encrypted file sharing on the public origin using two separate browser profiles. Confirm downloads use short-lived presigned URLs and the object bucket stays private.
- Review logs to confirm they contain no request bodies, message text, or credentials.
- Confirm Portways' database-backup retention and when any pre-migration snapshots containing plaintext will expire.

## Known limitations

- Protocol v1 has no forward secrecy or post-compromise security and has not been independently reviewed. Lost browser keys cannot be recovered; device removal cannot erase content already downloaded. See [the Phase 6 design and limits](phase-6-e2ee-architecture.md).
- Email addresses are not verified. Password resets require MFA to have been enabled and an unused recovery code. There is no email reset flow. See [MFA and password recovery](mfa-and-password-recovery.md).
- One-to-one conversations only. Attachments are limited to 20 MiB each; there are no group chats, calls, editing, or deletion. Opt-in push notifications and cross-conversation Received receipts are implemented locally and still need real-device verification. See [readability, delivery, and notifications](readability-delivery-and-notifications.md).
- Starting a conversation reveals whether an email has an account (rate limited to 20 attempts per hour per user).
- Only the most recent 100 messages of a conversation are shown.
# Membership, attachments, and calls release gate

For group chats and desktop typing, include migration 016 after 015 and follow [the group rollout notes](groups-and-desktop-typing.md). Refresh the app on all participants' devices after deployment. Group membership changes, file access, original-recipient receipts, and desktop typing still need live account/device checks.

Follow [private membership and calls](private-membership-and-calls.md) before deploying migration 015. Configure the admin owner and Node.js 22.13+. Portways managed calls use server-only `TURN_API_URL`/`TURN_TOKEN` through authenticated `/api/ice`. Confirm relay-only connectivity, restore the chosen production policy, check quota/outage fallback, and verify no bearer token reaches the browser. The guide includes pending live-device checks; compilation alone does not complete them.
