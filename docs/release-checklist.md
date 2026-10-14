# Untold release checklist

**Status: ready for an early-access deployment on Portways.** Accounts and one-to-one messaging work end to end. Messages are **not end-to-end encrypted**: they are protected by HTTPS in transit and stored readable in PostgreSQL. Do not describe Untold as encrypted or secure messaging.

## Verified in this workspace (2026-10-15)

- [x] `npm run lint`, `npx tsc --noEmit`, and `npm test` (19 tests) pass; `npm run build` succeeds.
- [x] The production build starts with dev dependencies pruned, binds to `PORT`, and serves pages with the CSP nonce and security headers.
- [x] Against a local PostgreSQL-compatible server and the production build: migrations apply and re-run cleanly; sign-up, sign-in, wrong-password rejection, and sign-out work; signed-out visitors are redirected away from `/app`; a conversation is found or created by email from either side; both people send and read messages; retried sends are de-duplicated; outsiders get 404 and signed-out callers 401; cross-origin writes get 403; invalid and over-long messages get 400; start-conversation is rate limited (429).
- [x] Sign-in rate limits are tracked per visitor via `cf-connecting-ip`, so one visitor hitting the limit does not block another.
- [x] In a browser: sign-up through the form, starting a conversation, sending with Enter, and receiving the other person's reply without reloading. No console errors.
- [ ] Inspect CSP, HTTPS/HSTS, and security headers on the deployed Portways origin.
- [ ] Run `npm audit` against the exact lockfile.

## Deploying on Portways

1. Create a Postgres add-on, connect through the Portways database bridge, and run `npm run db:migrate`.
2. Create one Portways project from the repository root and link the add-on.
3. Set `BETTER_AUTH_SECRET` (32+ random characters) and `BETTER_AUTH_URL` (the exact public HTTPS origin). Optionally set `ABLY_API_KEY` for instant delivery.
4. Deploy, start with one replica, and confirm the Postgres connection limit before scaling.

## Live checks after the first deploy

- Sign up two accounts on different devices, start a conversation, and exchange messages.
- Confirm the session cookie is `Secure` on the public origin and that sign-in works from both devices.
- With Ably configured, confirm messages arrive instantly and the browser console shows no CSP errors.
- Review logs to confirm they contain no request bodies, message text, or credentials.

## Known limitations

- No end-to-end encryption. The [`encryption/`](../encryption/README.md) helper is standalone and is not a complete protocol; see [the Phase 6 decision](phase-6-e2ee-architecture.md). An independent security review is required before any encryption claim.
- No email verification or password reset, so there is no way to recover a forgotten password.
- One-to-one text conversations only: no groups, attachments, push notifications, editing, or deletion.
- Starting a conversation reveals whether an email has an account (rate limited to 20 attempts per hour per user).
- Only the most recent 100 messages of a conversation are shown.
