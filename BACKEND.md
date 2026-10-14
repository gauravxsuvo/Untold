# Untold hosting and backend setup

Untold's Next.js application contains both the user interface and its server API routes. Deploy that full-stack Node app as a Portways project, then link a Portways Postgres add-on to it. The app's account, conversation, and message-envelope data stay in the linked database.

The Portways guide says to create separate projects when the frontend and backend are separate app directories. Untold currently has one integrated Next.js app, so Portways should build the repository root as one project; Next.js serves both pages and `/api/*` routes from that process. Do not split authentication into another origin without first designing the cookie and CORS boundary.

## Portways project setup

1. Create a Portways project from this repository with the repository root as its root directory.
2. Link a Portways Postgres add-on to the project. Portways injects its project-scoped PostgreSQL connection as `DATABASE_URL`.
3. Set `BETTER_AUTH_SECRET` to a random secret of at least 32 characters and `BETTER_AUTH_URL` to the project's public HTTPS origin, such as `https://untold.portways.app`.
4. Optionally set `ABLY_API_KEY` as a server-only environment variable for instant delivery. Ably receives only conversation and message IDs. Without it, the browser polls the API every few seconds.
5. Deploy. Portways sees the root `package.json`, installs dependencies, runs `npm run build`, then runs `npm start`. The start command binds Next.js to `0.0.0.0`; Next.js uses the `PORT` value supplied by Portways.

Use the guide's Env tab for variables. Never expose database credentials, `BETTER_AUTH_SECRET`, or the Ably API key through a `NEXT_PUBLIC_` variable. Portways passes recognized public prefixes to the build, so only values intended for browser code should use those prefixes.

The database pool is capped at three connections per app replica. Keep the initial project at one replica. If the project later scales, count `pool size × replicas` against the Postgres add-on's connection limit and enable its PgBouncer option before increasing replicas.

## Local database and migrations

For local development, use the Portways database bridge on loopback and put its PostgreSQL URL in `.env.local` as `DATABASE_URL`. `.env.example` shows the format. The app uses the same `DATABASE_URL` setting locally and in Portways; the hosted project receives it from the linked add-on.

The hosted project migrates itself: `npm start` runs `scripts/migrate-on-start.mjs` before `next start`. It applies ordered SQL migrations, each in its own transaction that takes a transaction-scoped Postgres advisory lock and re-checks `untold_migrations.applied`, so concurrent replicas apply each file exactly once (and the lock also works through PgBouncer's transaction pooling). Checksums are immutable: editing an applied migration fails the start, so add a new numbered file instead. A failed migration exits non-zero so the deploy fails visibly. Locally, `npm run db:migrate` runs the same code but only accepts a loopback (bridge) URL. Decision recorded 2026-10-15: the user chose automatic migration on deploy over manual bridge runs.

With the bridge running, a local Next.js server, and the migrations applied, `npm run test:backend` checks the database tables/indexes, Better Auth session routing, and unauthenticated realtime-token rejection. This command only accepts loopback database and app URLs.

## Current application boundary

- Better Auth stores email/password accounts and sessions in the `untold_auth` schema. Passwords are hashed by Better Auth. Email verification and password reset mail are not configured. Behind Portways, Better Auth reads the client IP from Cloudflare's `cf-connecting-ip` header; `X-Forwarded-For` carries several proxy hops there and would put every visitor in one shared rate-limit bucket.
- Drizzle stores conversations, membership, and message envelopes in `untold_app`. `GET/POST /api/conversations` lists conversations and finds or creates a one-to-one conversation by account email (one per pair, enforced by `direct_key`). The API checks sessions and membership before reads, writes, and realtime-token issuance, and applies per-user limits from `untold_app.rate_limit`.
- Message envelopes are plaintext JSON (`{"v":1,"type":"text","text":…}`, base64 on the wire, up to 2,000 characters). They are protected in transit by HTTPS but are **not end-to-end encrypted**: the server and database operator can read them. The UI states this wherever messages appear.
- Ably receives only message-available identifiers and issues short-lived, conversation-scoped subscribe tokens. Conversation and message IDs, timing, and connection metadata remain visible to Ably.
- Group conversations, device management, end-to-end encryption, attachments, push notifications, and email delivery remain unimplemented.

## Security headers and release boundary

- The Next.js app applies a nonce-based Content Security Policy to page responses and standard browser security headers to all routes. Authenticated message writes and realtime-token requests also require the configured `BETTER_AUTH_URL` origin.
- TLS termination and HSTS are deployment responsibilities. Serve the project only over HTTPS and set `BETTER_AUTH_URL` to the exact public origin.
- The helper in `encryption/` is built separately with `npm run build:encryption`. It uses browser Web Crypto and is not called by the chat UI. The CSP allows `connect-src` to Ably's `ably.net`, `ably-realtime.com`, and `ably.io` hosts for realtime delivery. Do not host it as an API that receives plaintext or keys; its code belongs on the client.
- Read [`docs/release-checklist.md`](docs/release-checklist.md) before creating the Portways project.

## Limits and operations

- Do not store sessions, uploads, cache state, or other durable data in the container filesystem. Portways recreates containers on deploy/restart and scaled projects have no shared local disk.
- Better Auth sessions and all rate-limit state use PostgreSQL, so they are shared across replicas.
- The full flow (migrations, sign-up, sign-in, starting a conversation, messaging both ways, membership isolation, rate limits) was verified on 2026-10-15 against a local PostgreSQL-compatible server and the production build. A live Portways database and Ably delivery have not been exercised from this workspace.
- Portways project creation, database linking, environment entry, custom domains, and live deployment happen in the Portways dashboard; this repository change prepares the app but does not create dashboard resources.

## References

- [Portways hosting guide in this repository](<portways-hosting-guide (3).md>)
- [Portways database and storage guide](https://db.portways.app/docs.md)
- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Ably token authentication](https://ably.com/docs/auth/token?lang=javascript)
- [Ably channel capabilities](https://ably.com/docs/auth/capabilities)
