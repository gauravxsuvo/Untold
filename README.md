# Untold

Calls now offer movable windows, fullscreen video/screen views, floating windows on supported browsers, and microphone/camera/output selection. Live audio targets up to 96 kbit/s per peer. See [call windows and devices](docs/call-window-and-devices.md) for browser support and rollout checks.

Group chats support names, compressed photos, owner/member controls, and existing account safety checks. Desktop typing focuses the open chat's composer. See [groups and desktop typing](docs/groups-and-desktop-typing.md) for migration 016 and rollout details.

Group voice/video calls and direct/group screen sharing use the existing Portways TURN integration. Cameras target 720p at 30 fps, screen sharing targets 720p at 60 fps, and outgoing video has a bitrate budget. Shared database limits protect direct/group messages against bursts. Include migration 017 and see [group calls and media](docs/group-calls-and-media.md) for limits and deployment checks.

Private membership approval, attachment viewers, voice recordings, voice/video calls, and direct photo cropping are described in [the setup guide](docs/private-membership-and-calls.md). Set `ADMIN_EMAIL` before deployment. Calls use Portways' server-only `TURN_API_URL`/`TURN_TOKEN` integration. The guide covers relay checks, normal connection privacy, outage fallback and the 55-minute call limit.

Untold is a calm messaging app for the conversations that matter. You sign up with email and password, add a friend by their account email, and talk. It is one full-stack Next.js application: the interface and the server API deploy together as a single Node.js service on [Portways](#deploying-on-portways).

> **Encryption status:** Text and attachment files are encrypted in the browser before the API or Portways object storage receives them. Migration 006 removes pre-encryption message rows when the app next starts, so that old history disappears; database backups may retain copies. Compare the shared account safety code once per contact, then approve additional devices from an existing device. Protocol v1 has no forward secrecy and has not had an independent security review. Someone who gains access to an unlocked device may be able to read its messages; do not treat this as production-secure.

## Features

| Area | What it does |
| --- | --- |
| Accounts | Email and password sign-up and sign-in through [Better Auth](https://better-auth.com), stored in PostgreSQL. Passwords are at least 15 characters and hashed. Sign-in and sign-up are rate limited per visitor. |
| Conversations | Start a one-to-one conversation by entering someone's account email. Starting it again from either side opens the same conversation. |
| Messaging | Send and receive text messages of up to 2,000 characters. Messages appear immediately for the sender, retry safely without duplicates, and arrive for the other person within a few seconds. |
| Attachments | Share images, video, audio, PDFs, office documents, and other files up to 20 MiB. Files encrypt in the browser; supported images preview in chat, audio/video play on request, and other types download as files. |
| Device encryption | A first-party browser protocol encrypts new messages for every approved device. It uses no external cryptography package or hosted encryption service. Device safety codes, local key storage, and revocation are built into the app. |
| Live updates | With an Ably key configured, new messages arrive instantly. Without one, the app refreshes open conversations every 3 seconds and the list every 8 seconds. |
| Inbox and contacts | The inbox shows recent conversations, and contacts lists the people you talk with. Untold never reads device contacts. |
| Access control | Every `/app` page requires a signed-in account (checked on the server). Every API call checks the session and conversation membership, and writes must come from the app's own origin. |
| Abuse limits | Message burst, account, per-chat and conversation limits shared across devices and replicas. Starting conversations is limited to 20 per hour and realtime tokens to 30 per minute. See the group calls/media guide for exact message budgets. |
| Security headers | A nonce-based Content Security Policy from `proxy.ts`, and standard browser headers from `next.config.ts`. |

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router, `proxy.ts`), React 19, strict TypeScript
- Tailwind CSS 4
- PostgreSQL via [Drizzle ORM](https://orm.drizzle.team) and `pg`
- Better Auth for accounts and sessions
- The browser's built-in Web Crypto API for the first-party encryption protocol in [`crypto/`](crypto/README.md)
- [Ably](https://ably.com) for optional realtime notifications
- Biome for linting, and the Node.js test runner for tests
- npm, with Node.js 22.13 or newer

> This project uses a newer Next.js than most documentation and training data cover. Check `node_modules/next/dist/docs/` before changing framework-level code (see [`AGENTS.md`](AGENTS.md)).

## Running locally

You need Node.js 22.13 or newer and a PostgreSQL database. With Portways, run the Portways database bridge so the database is reachable on `127.0.0.1` (see [`BACKEND.md`](BACKEND.md)).

1. Install dependencies and create your local environment file:

   ```bash
   npm install
   cp .env.example .env.local
   ```

2. Fill in `.env.local` (see [Environment variables](#environment-variables)).
3. Apply the database migrations:

   ```bash
   npm run db:migrate
   ```

4. Start the app and open <http://localhost:3000>:

   ```bash
   npm run dev
   ```

5. Optional: with the dev server running, `npm run test:backend` checks the database tables and the auth routes.

`npm start` also applies pending migrations before serving. The manual `npm run db:migrate` command and the backend smoke test refuse to run against anything that is not a loopback address. If the database or auth settings are missing, pages still render and the API returns `503 service_unavailable` instead of crashing.

### Environment variables

All of these are server-only. Never give any of them a `NEXT_PUBLIC_` prefix.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection URL. A linked Portways Postgres add-on sets it automatically. |
| `BETTER_AUTH_SECRET` | Yes | Random secret of at least 32 characters. Generate one with `openssl rand -base64 48`. |
| `BETTER_AUTH_URL` | Yes | The exact public origin, such as `http://localhost:3000` locally or `https://untold.portways.app` in production. Must be HTTPS outside localhost. Writes from any other origin are refused. |
| `ABLY_API_KEY` | No | Ably API key with publish and subscribe capabilities. It turns on instant message delivery. Without it, the app falls back to polling. |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | For attachments | Injected by a linked Portways Object Storage add-on. Credentials remain server-only; the app uses the add-on's private bucket. |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | For attachments | S3-compatible client settings injected by Portways. |
| `S3_INTERNAL_ENDPOINT` | Optional | Portways in-cluster address for server-side uploads. The public endpoint is the fallback. |
| `S3_PREFIX` | Optional | Object-key prefix, used for Portways preview deployments when configured. |

`.env.example` is the template. Real `.env*` files are git-ignored.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Production build. Portways runs this. |
| `npm start` | Apply pending database migrations, then serve the production build on `0.0.0.0` (on `PORT` when set). |
| `npm run lint` | Lint with Biome. |
| `npm test` | Type-check and run the app tests. |
| `npm run build:crypto` | Build the standalone first-party browser crypto package. |
| `npm run build:all` | Build the app and crypto package. |
| `npm run test:encryption` | Run boundary tests for the older standalone AES helper; it is not used by chat. |
| `npm run test:all` | App plus older AES helper tests. |
| `npm run db:migrate` | Manually apply migrations through a loopback database URL (safe to re-run). |
| `npm run test:backend` | Local backend smoke checks. |

## Deploying on Portways

Untold deploys as **one** Portways project built from the repository root. Portways detects `package.json`, installs dependencies, runs `npm run build`, prunes dev dependencies, and runs `npm start`. Next.js listens on the `PORT` that Portways provides. No Dockerfile is needed.

Do not split it into separate frontend and backend projects: the session cookies and origin checks assume the pages and `/api/*` share one origin.

### 1. Database

1. In Portways, create a **Postgres add-on** and link it to the project (below).
2. Create a Portways **Object Storage (S3)** add-on and link it to the same project. Keep its bucket private; this enables attachment sharing.
3. On every deploy, `npm start` applies any pending SQL migrations from `scripts/migrations/` before the server starts accepting requests. Each migration runs once, in a transaction guarded by a Postgres advisory lock, so several replicas starting together are safe. If a migration fails, the container exits and the deploy shows as failed instead of serving a half-migrated database.

### 2. Project

1. Create a Portways project from this repository, with the repository root as the root directory and `main` as the branch.
2. Link the Postgres and Object Storage add-ons. Portways injects `DATABASE_URL` and the private `S3_*` settings.
3. In the **Env** tab, set the following before the first deploy:

   ```text
   BETTER_AUTH_SECRET=<random string, 32+ characters>
   BETTER_AUTH_URL=https://<your-subdomain>.portways.app
   ABLY_API_KEY=<optional Ably key>
   ```

   Values must be single-line. `BETTER_AUTH_URL` must exactly match the address people use, including `https://` and with no trailing slash.
4. Deploy. Saving env vars does not restart a running container, so redeploy or restart after changing them.

### 3. Try it with a friend

1. Open the project URL, choose **Create an account**, and sign up.
2. Your friend does the same on their own device.
3. One of you opens **Conversations**, enters the other's account email, and selects **Start**.
4. Send a message. It appears for the other person within a few seconds, or instantly when Ably is configured. Use the paperclip to attach a photo or file.

### 4. Operating it

- **Replicas:** start with one. The database pool is capped at 3 connections per replica. Before scaling out, count `pool size × replicas` against the add-on's limit and enable PgBouncer.
- **State:** sessions, rate limits, conversations and messages all live in PostgreSQL. Nothing durable is written to the container, so restarts and redeploys are safe.
- **Visitor IPs:** Better Auth reads Cloudflare's `cf-connecting-ip` header to give each visitor their own sign-in limit behind the Portways proxies.
- **HTTPS:** TLS is handled at the Portways edge.
- **Custom domain:** add it in the project's Settings, set `BETTER_AUTH_URL` to it, and redeploy.

After the first deploy, work through [`docs/release-checklist.md`](docs/release-checklist.md).

## Known limitations

- **Early encryption protocol.** Message text, file bytes, and file details are encrypted in the browser and stored as ciphertext, but protocol v1 has no forward secrecy and no independent review. Verify safety codes before sending. Migration 006 permanently removes pre-encryption message rows from the live database; host backups may retain copies. See [`crypto/`](crypto/README.md).
- **No email delivery.** Email addresses are not verified. Password recovery requires MFA to have been configured before the password was lost; password reset mail is not configured.
- **Attachment size and scope.** Direct/group chats support files up to 20 MiB each, with no message editing or deletion. Small group calls support up to eight people. Screen sharing and background notifications depend on browser/OS support; real-device verification remains outstanding. See [group calls and media](docs/group-calls-and-media.md).
- **Email lookup.** Starting a conversation reveals whether an email has an account. It is rate limited, and conversation partners see each other's display name and email.
- **Message history** shows the most recent 100 messages per conversation.

## Project layout

```text
app/                    Next.js routes: landing, /auth/*, /app/* (signed-in), /api/*
components/             UI (app shell, auth, brand, landing, messaging)
lib/auth/               Better Auth client/server setup, server session helper, form validation
lib/messaging/          Message and attachment metadata, conversation helpers, browser API client
lib/server/             Database pool, schema, conversations, rate limits, Ably, HTTP helpers
scripts/                Migration runner (on start and manual), backend smoke test, ordered SQL migrations
tests/                  Unit tests (compiled with tsconfig.tests.json)
crypto/                 First-party browser protocol, package build, and design notes
encryption/              Older isolated AES-GCM helper; not used by chat
docs/                   E2EE architecture, encrypted attachment design, and release checklist
proxy.ts                Per-request CSP nonce
```

## Further reading

- [`BACKEND.md`](BACKEND.md): backend design and Portways setup in detail
- [`docs/release-checklist.md`](docs/release-checklist.md): what has and hasn't been verified
- [`docs/phase-6-e2ee-architecture.md`](docs/phase-6-e2ee-architecture.md): encryption decision record
- [`plan.md`](plan.md): project plan and phase history
