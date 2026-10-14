# Untold release checklist

**Status: release preparation only. This application is not production-ready.** The local builds validate that the app and the isolated encryption package compile. They do not establish that the hosted database, authentication, realtime delivery, or message encryption works end to end.

## Verified in this workspace

- [x] `npm run build:all` builds the production Next.js app and standalone encryption package.
- [x] `npm run lint`, `npx tsc --noEmit`, and `npm run test:all` pass (17 app tests and 5 encryption tests).
- [x] The local production server returned HTTP 200 for `/` and `/auth/sign-in`; all 12 rendered script tags carried the matching CSP nonce, and browser security headers were present.
- [ ] Inspect CSP, HTTPS/HSTS, and security headers on the deployed Portways origin.
- [ ] Run `npm audit` against the exact lockfile. The attempt in this workspace could not resolve `registry.npmjs.org`, so dependency advisories remain unchecked.

Never mark live-service checks complete based only on a local build.

## Before creating the Portways deployment

1. Create one Portways project from this repository root and link its Postgres add-on.
2. Set `BETTER_AUTH_SECRET` to a unique random value of at least 32 characters, `BETTER_AUTH_URL` to the exact public HTTPS origin, and `ABLY_API_KEY` as server-only variables. Keep the linked `DATABASE_URL` server-only.
3. Apply the documented SQL migrations once from a controlled environment using the Portways bridge. Do not migrate at app startup.
4. Confirm the Portways replica and Postgres connection limits for the selected plan. Start with one app replica.
5. Configure HTTPS at the hosting edge and confirm that sign-in cookies are secure on the public origin.

## Live checks still required

- Verify sign-up, sign-in, sign-out, session expiration, rate limits, and authorization against the live Portways database.
- Verify that a user outside a conversation cannot read its envelopes or receive its Ably channel capability.
- Verify two authorized sessions can exchange an opaque envelope through the database and ID-only Ably notification path. The current mock chat does not perform this flow.
- Inspect production responses for CSP, frame denial, MIME sniffing protection, referrer policy, and correct same-origin rejection.
- Review logs and hosting telemetry to confirm they contain no request bodies, message text, encryption keys, or credentials.
- Run dependency vulnerability checks against the exact lockfile used for deployment.
- Arrange independent security review before enabling real message sending or describing chat as end-to-end encrypted.

## Known product and security limitations

- The chat interface remains a local mock preview. It is not connected to auth, message storage, or realtime delivery.
- The API accepts opaque bytes but cannot establish that they are encrypted.
- The separate Web Crypto helper uses a manually shared symmetric AES-256-GCM key. It has no key exchange, device identity, verified contact keys, forward secrecy, replay prevention, key rotation, group lifecycle, encrypted local storage, or account recovery. It must not be used as a complete chat protocol.
- Per-user rate limits for the custom message and realtime-token APIs remain outstanding; current database-backed limits cover sign-in and sign-up.
- Email verification, password reset delivery, contact discovery, conversation creation, attachment encryption, push notifications, delivery retry/outbox, and device management are not implemented.
- No Portways project, live database, production origin, or Ably credential is configured in this workspace; live deployment and service behavior remain unverified.
