# Untold release checklist

**Status: deployment is not yet verified after the first-party encryption and attachment integration.** Migration 006 will permanently remove pre-encryption and unsupported message rows at app startup, but it has not been applied to Portways from this workspace. Migration 007 adds attachment records and message links. Message text, attachment metadata, and attachment bytes are encrypted in the browser; live Portways object storage and the full attachment flow are not configured or verified here. Protocol v1 has no forward secrecy and no independent security review. Do not describe Untold as production-secure.

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
- No email verification or password reset, so there is no way to recover a forgotten password.
- One-to-one conversations only. Attachments are limited to 20 MiB each; there are no group chats, calls, push notifications, editing, or deletion.
- Starting a conversation reveals whether an email has an account (rate limited to 20 attempts per hour per user).
- Only the most recent 100 messages of a conversation are shown.
