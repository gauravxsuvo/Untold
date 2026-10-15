# Untold hosting and backend setup

Untold's Next.js application contains both the user interface and its server API routes. Deploy that full-stack Node app as a Portways project, then link Portways Postgres and Object Storage add-ons to it. Accounts, conversations, and message envelopes stay in PostgreSQL; encrypted file bytes stay in the linked private S3-compatible bucket.

The Portways guide says to create separate projects when the frontend and backend are separate app directories. Untold currently has one integrated Next.js app, so Portways should build the repository root as one project; Next.js serves both pages and `/api/*` routes from that process. Do not split authentication into another origin without first designing the cookie and CORS boundary.

## Portways project setup

1. Create a Portways project from this repository with the repository root as its root directory.
2. Link a Portways Postgres add-on to the project. Portways injects its project-scoped PostgreSQL connection as `DATABASE_URL`.
3. Create a Portways **Object Storage (S3)** add-on and link it to the same project. Portways provisions a private project bucket and injects scoped S3 credentials and endpoints.
4. Set `BETTER_AUTH_SECRET` to a random secret of at least 32 characters and `BETTER_AUTH_URL` to the project's public HTTPS origin, such as `https://untold.portways.app`.
5. Optionally set `ABLY_API_KEY` as a server-only environment variable for instant delivery. Ably receives only conversation and message IDs. Without it, the browser polls the API every few seconds.
6. Deploy. Portways sees the root `package.json`, installs dependencies, runs `npm run build`, then runs `npm start`. The start command binds Next.js to `0.0.0.0`; Next.js uses the `PORT` value supplied by Portways.

Use the guide's Env tab for variables. The linked Object Storage add-on provides `S3_ENDPOINT`, `S3_INTERNAL_ENDPOINT` (when reachable), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_FORCE_PATH_STYLE`. Keep both S3 credentials, database credentials, `BETTER_AUTH_SECRET`, and the Ably API key server-only; never expose them through a `NEXT_PUBLIC_` variable. The app uses the Portways public S3 endpoint to sign short-lived private download URLs and the internal endpoint for encrypted uploads when available. The public bucket/CDN path is not used.

The database pool is capped at three connections per app replica. Keep the initial project at one replica. If the project later scales, count `pool size × replicas` against the Postgres add-on's connection limit and enable its PgBouncer option before increasing replicas.

## Build mode: use the default Turbopack build

`npm run build` must stay the default `next build` (Turbopack). Portways builds inside a container with the project at `/app`, and Next 16.4's **webpack** build mis-resolves the root `app/layout.tsx` and `app/page.tsx` to `app/app/layout.tsx` and `app/app/page.tsx` when the project root is exactly `/app`. The symptom is a build crash prerendering `/_not-found` ("useAccountSession must be used inside AccountSessionProvider"), or, if it builds, every page redirecting to `/auth/sign-in`. It does not reproduce on a Windows checkout or in other Linux folders. `npm run build:webpack` exists only as a local fallback if Turbopack fails to start on a machine; do not deploy with it.

## Local database and migrations

For local development, use the Portways database bridge on loopback and put its PostgreSQL URL in `.env.local` as `DATABASE_URL`. `.env.example` shows the format. The app uses the same `DATABASE_URL` setting locally and in Portways; the hosted project receives it from the linked add-on.

The hosted project migrates itself: `npm start` runs `scripts/migrate-on-start.mjs` before `next start`. It applies ordered SQL migrations, each in its own transaction that takes a transaction-scoped Postgres advisory lock and re-checks `untold_migrations.applied`, so concurrent replicas apply each file exactly once (and the lock also works through PgBouncer's transaction pooling). Checksums are immutable: editing an applied migration fails the start, so add a new numbered file instead. A failed migration exits non-zero so the deploy fails visibly. Locally, `npm run db:migrate` runs the same code but only accepts a loopback (bridge) URL. Decision recorded 2026-10-15: the user chose automatic migration on deploy over manual bridge runs.

With the bridge running, a local Next.js server, and the migrations applied, `npm run test:backend` checks the database tables/indexes, Better Auth session routing, and unauthenticated realtime-token rejection. This command only accepts loopback database and app URLs.

## Current application boundary

- Better Auth stores email/password accounts and sessions in the `untold_auth` schema. Passwords are hashed by Better Auth. Email verification and password reset mail are not configured. Behind Portways, Better Auth reads the client IP from Cloudflare's `cf-connecting-ip` header; `X-Forwarded-For` carries several proxy hops there and would put every visitor in one shared rate-limit bucket.
- Drizzle stores conversations, membership, public device keys, and message envelopes in `untold_app`. `GET/POST /api/conversations` lists conversations and finds or creates a one-to-one conversation by account email (one per pair, enforced by `direct_key`). The API checks sessions and membership before reads, writes, device-directory access, and realtime-token issuance, and applies per-user limits from `untold_app.rate_limit`.
- New message envelopes are JSON ciphertext envelopes (`untold-e2ee`, version 1) encoded as base64 on the API wire. The API checks the authenticated sender, conversation, message ID, registered sender device, and the current recipient-device set, then stores and returns bytes without decrypting them. Migration 006 removes pre-encryption or malformed message rows before the app serves requests; the messages API also returns only structurally valid E2EE envelopes. Host backups may retain pre-migration copies.
- Attachment bytes are encrypted in the browser with a fresh AES-GCM key and nonce, with additional data bound to the conversation, message, sender device, and attachment ID. Filename, declared type, plaintext size, key, and nonce travel only inside the signed and encrypted message body. The upload API receives ciphertext bytes only and stores them in a private Portways Object Storage bucket; downloads are membership-checked and use five-minute presigned URLs for the ciphertext. File IDs, conversation/sender association, ciphertext size/hash, and upload timing remain visible to the backend.
- The first-party browser protocol is implemented under [`crypto/`](crypto/README.md). It uses browser-native Web Crypto and IndexedDB, with no cryptography package or separate crypto server. The server stores public device keys only. Contacts compare a shared account safety code. Additional devices need a signed one-time approval, and verified contacts sync across approved devices. Pending devices are excluded from new message-key wraps; identity recovery produces a real code-change warning. Migration 014 and [the account-device rollout notes](docs/account-device-verification.md) describe this flow.
- This protocol has no forward secrecy, post-compromise security, group messaging, key backup, or independent security review. The hosting origin still serves the JavaScript that performs encryption, so a malicious app update or same-origin script compromise can access plaintext and keys while the app is in use. Treat the implementation as an early prototype.
- Ably receives only message-available identifiers and issues short-lived, conversation-scoped subscribe tokens. Conversation and message IDs, timing, and connection metadata remain visible to Ably.
- Group conversations and email delivery remain unimplemented. Private opt-in push notifications use browser-vendor Web Push, encrypted persisted VAPID keys, a Postgres outbox, and a retry worker in the persistent Node server. Migration 012 adds its tables; see [the rollout notes](docs/readability-delivery-and-notifications.md). Attachment sharing is limited to 20 MiB per file and one-to-one chats; there are no call features. Device revocation preserves its public key for old-message signature checks, excludes it from future key wraps, and expires the account's other sessions. It cannot erase messages or keys already downloaded.

## Security headers and release boundary

- The Next.js app applies a nonce-based Content Security Policy to page responses and standard browser security headers to all routes. Authenticated message writes and realtime-token requests also require the configured `BETTER_AUTH_URL` origin.
- TLS termination and HSTS are deployment responsibilities. Serve the project only over HTTPS and set `BETTER_AUTH_URL` to the exact public origin.
- The browser protocol in `crypto/` is bundled into the application and also has a standalone TypeScript build (`npm run build:crypto`). It does not require a separate encryption API or hosted crypto project. The CSP allows `connect-src` to Ably's `ably.net`, `ably-realtime.com`, and `ably.io` hosts for realtime delivery; Ably receives message IDs only.
- Read [`docs/release-checklist.md`](docs/release-checklist.md) before creating the Portways project.

## Limits and operations

- Do not store sessions, uploads, cache state, or other durable data in the container filesystem. Portways recreates containers on deploy/restart and scaled projects have no shared local disk.
- Better Auth sessions and all rate-limit state use PostgreSQL, so they are shared across replicas.
- The earlier full backend flow was verified against a local PostgreSQL-compatible server before the browser encryption flow was connected. Migrations 004–007, the attachment flow, and live Portways object storage have not yet been exercised from this workspace.
- Portways project creation, database linking, environment entry, custom domains, and live deployment happen in the Portways dashboard; this repository change prepares the app but does not create dashboard resources.

## References

- [Portways database and storage guide](https://db.portways.app/docs.md)
- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Ably token authentication](https://ably.com/docs/auth/token?lang=javascript)
- [Ably channel capabilities](https://ably.com/docs/auth/capabilities)
# Private membership and call setup

See [private membership and calls](docs/private-membership-and-calls.md) for migration 015, `ADMIN_EMAIL`, optional admin account pinning, Node.js 22.13+, and Portways managed TURN. New accounts require approval. Existing accounts remain approved. Portways injects `TURN_API_URL` and `TURN_TOKEN` on the server; `/api/ice` exchanges them for temporary credentials. `TURN_RELAY_ONLY=true` supports connectivity checks or relay-only privacy. Calls last up to 55 minutes with the one-hour credential contract. No secret belongs in a browser environment variable.
