# Untold — Project Plan and Working Prompt

## Current status

### Production call setup timeout (2026-10-16)

- [x] Trace the reported Chrome-installed desktop error to the client ICE-gathering deadline before offer submission.
- [x] Use gathered candidates instead of rejecting usable routes when an optional server remains pending; allow up to 25 seconds and use a bundled audio/video transport.
- [x] Preserve relay-only enforcement, signed SDP snapshots, cancellation/resource cleanup, and the broker's no-retry behavior.
- [x] Preserve an already-connected state when applying an answer, and add bounded console diagnostics without addresses, credentials or SDP.
- [x] Document safe production troubleshooting. Real relay connectivity still needs confirmation after deployment.

TypeScript, lint (196 files), production webpack compilation, and whitespace checks passed. No automated tests, live broker requests, live calls, commit or deployment were performed for this fix; production credentials were not read or printed. Live relay connectivity remains unverified.

### Portways managed TURN (2026-10-16, implemented locally)

- [x] Use server-only TURN_API_URL/TURN_TOKEN to POST {"ttl":3600}; return only validated iceServers from authenticated /api/ice.
- [x] Accept only HTTP 200; handle 429/503 and malformed responses with bounded requests, short credential caching and provider cooldowns. Never poll the credential API automatically.
- [x] Use production ICE selection with STUN fallback for a relay outage, optional TURN_RELAY_ONLY checks, and clear connection privacy copy. Never fall back on authentication/approval failure.
- [x] Keep call duration within credential lifetime, update deployment notes and compile/lint without live tests or deployment.

Production mode follows Portways' normal ICE selection and can disclose network addresses to contacts; relay-only mode disables direct fallback. Calls are capped at 55 minutes for one-hour credentials. Local production webpack compilation, TypeScript, lint and diff checks passed. Secrets were not read or printed; there was no live broker request, automated test, live call, migration, commit or deployment. The guide in `docs/private-membership-and-calls.md` has the exact rollout checks and configuration.

### Groups and desktop typing (2026-10-16, implemented locally)

- [x] Add named groups with compressed, cropped photos and owner controls for adding/removing members and leaving.
- [x] Enforce current membership across messages, files, notifications and realtime. Snapshot message recipients so new members do not receive old history and group receipts remain accurate.
- [x] Reuse account safety verification per group member and exclude former members from new encryption recipients.
- [x] Show group names/photos and message sender names in the inbox and chat, and keep calls limited to direct chats.
- [x] Focus the composer when typing on a desktop without interrupting inputs, dialogs, text selection, shortcuts, or composition.
- [x] Document migration, compile, and lint. Do not start the development server or run tests.

Groups support eight members and up to 64 approved recipient devices. Membership changes serialize with message insertion. Newly added groups rise in the list when a person joins. Former members' identities are returned only when they authored messages the viewer was authorized to receive. Profile photos require a current shared membership. Production webpack build, TypeScript, standalone crypto compilation, lint and diff checks pass. No automated tests, live account flows, migration execution, development server, commit, or deployment were run. Include migration 016 after 015 and follow `docs/groups-and-desktop-typing.md` before live rollout.

### Account verification and device approval (2026-10-15, implemented locally)

The user chose to approve a new device once from an existing device. Contact verification must follow the account across approved devices. Signing in alone must not silently authorize another encryption device.

- [x] Add a stable account safety identity, signed device approvals, and signed contact-verification records. Keep private signing/agreement keys on their original device.
- [x] Add one-time device linking with a secret shown only on the new device and transferred by QR or code to the approving device. Pin the account identity from the encrypted approval response.
- [x] Sync verified contacts to approved devices; migrate previously compared device codes when they match the stable identity. Verify each contact account once, with a new check only when the account identity is deliberately reset.
- [x] Keep pending or removed devices out of message recipients. They must not block existing conversations. Require approval before sending or verifying contacts from a new device.
- [x] Add Settings controls for linking, approving, removing, and recovering when every old device is unavailable. Recovery requires password and existing MFA, revokes other devices/sessions, and changes the account identity so contacts get a real change warning.
- [x] Update safety QR/copy/loading states and rollout docs. Compile and lint; record remaining live-device verification requirements without claiming an independent cryptographic review.

Device labels now identify the platform and browser or installed app, including iPhone, iPad, Android, Windows, and Mac. Existing labels refresh when each device opens the updated app. The current-device marker is separate. Linking supports camera QR and a wrapping, copyable code; approval and removal use distinct styles. Transient device-refresh errors preserve an existing approval. Atomic IndexedDB updates prevent two tabs from generating conflicting identities/link secrets or rolling back trust pins.

Local production webpack build, TypeScript, lint, and standalone crypto compilation pass. Static sample-data Settings previews cover approved/pending devices on desktop, phone, tablet, and extra-large text at 120% zoom. No automated tests, live two-account/device flows, migrations, or deployment were run. Commit all new files with migration 014. Use the default production build on Portways and npm start for migration; staging checks in docs/account-device-verification.md remain required before a live rollout.

### Private empty chats and iPhone notification review (2026-10-15)

- [x] Keep an empty chat visible only to its original starter and anyone who explicitly starts that same chat themselves. Reuse the existing conversation when both people enter each other’s email.
- [x] Show the chat to both members after the first committed message, including a file-only message. Unsent text, failed sends, and uploaded files without a sent message do not reveal it in the recipient’s chat list or Contacts.
- [x] Add migration 013 to track explicit starts per member, preserve original starters’ existing drafts, and hide older empty chats from automatic recipients without deleting messages.
- [x] Refresh the chat list after foreground delivery acknowledges a first incoming message, including when push is disabled and that chat has no live subscription yet.
- [x] Review iPhone/iPad notification implementation against Apple’s Home Screen installation, user-initiated permission, Apple push endpoint, and visible-notification requirements. Real iPhone delivery remains unverified.
- [x] Complete lint, production webpack compilation (including TypeScript), and whitespace checks. No tests or live two-account/iPhone flows were run. Deployment and migration 013 have not been run here. Deploy with npm start so migration 013 runs before the new app serves requests; verify both accounts on staging.

### Full-screen chats and safer account controls (2026-10-15)

- [x] Open chats across the full app window on screens up to 1000px wide. Hide global navigation and page headings while chatting, keep an accessible back button, and restore the conversation list and app navigation on return.
- [x] Keep chat history scrollable and the composer visible with safe-area padding, keyboard resizing, large text, and interface zoom.
- [x] Move sign out to Settings with a deliberate confirmation, progress, and a safe retry message. Replace sidebar sign out with an account settings link.
- [x] Hide the repeated privacy banner after current safety codes are verified. Keep the complete note in Details, and preserve warnings for new, changed, missing, or revoked devices.
- [x] Complete local lint, production compilation, static visual review, and the release handoff. Live device/account checks and migration verification remain separate release gates.

Lint, the final webpack production build (including TypeScript), and whitespace checks pass. The production dependency audit reports zero known vulnerabilities. Static previews cover long histories on phone, tablet, landscape, and desktop, large text at 120% zoom, a simulated keyboard viewport, Details, and the restored list/navigation view. No automated tests or live account/device flows were run. No deployment or database migration was performed. The local UI changes are ready to commit; complete the outstanding live checks in docs/release-checklist.md before treating the full release as production verified.

### Conversation composer visibility (2026-10-15, implemented locally)

- [x] Bound the conversation route to the visible viewport on desktop, tablet, and mobile. Scroll long histories and conversation lists inside their panels.
- [x] Keep the composer above mobile navigation and adapt to the keyboard, orientation, interface zoom, and font settings.
- [x] Apply the same bounded history region to loading/error states. Review static long-thread layouts and record compilation and visual review results.

The conversation shell now has a fixed visible-viewport height, shrinkable panels, an independently scrolling history, and a composer outside the message scroller. Mobile navigation occupies its own grid row. VisualViewport updates handle keyboard resizing, orientation, and saved interface zoom; regular pinch zoom stays enabled. Small-screen conversation headings collapse while a chat is open, and keyboard mode hides extra app chrome while preserving chat navigation and security-state warnings. Scroll following handles late media sizing and viewport changes, preserves the reader's position above the bottom, and follows new outgoing messages.

Lint and webpack compilation passed. Static sample-data previews with 100 messages and 40 conversations were reviewed at 320x568, 390x844, 768x1024, 844x390, and 1440x900, plus extra-large text at 120% interface zoom and a simulated 390x340 keyboard viewport. The composer stayed within the viewport and above the navigation bar; message history remained scrollable. No tests, live account flows, physical keyboard/device checks, deployment, or migration runs were performed.

### Readability, delivery, and mobile improvements (2026-10-15, implemented locally)

- [x] 1. Add separate font size and interface zoom controls in Settings, persist them on this device, and preserve browser pinch zoom.
- [x] 2. Use readable system sans fonts (Apple system fonts on Apple devices, Roboto on Android, Segoe UI on Windows), with consistent form and message typography.
- [x] 3. Fix Received acknowledgements while Untold is open outside the conversation. Keep Read limited to visible messages in a focused conversation.
- [x] 4. Add opt-in notifications, browser push subscriptions, a minimal service worker, and private new-message alerts. Document any deployment keys needed. Do not include plaintext chat content in notifications.
- [x] 5. Add skeletons and clear loading/progress states for inbox, contacts, conversations, settings, profile, and slow actions without hiding existing content during refresh.
- [x] 6. Make the authenticator QR setup in Settings easy to discover and complete, retaining password confirmation and code verification.
- [x] 7. Add safety-code QR display and scanning/manual fallback on mobile and tablet. Validate exact device keys and conversation context before allowing confirmation.
- [x] 8. Improve profile-photo cropping with direct drag/touch positioning and zoom, retain accessible controls, and preserve upload compression.
- [x] 9. Replace the native appearance dropdown shown in the screenshot with a consistent themed, keyboard-accessible menu across Light, Dark, and AMOLED.

Implemented all nine items. Readability controls save per browser, system sans typography replaces inconsistent control fonts, Received acknowledgements run across the open app, private opt-in Web Push uses an encrypted persisted VAPID key and database retry outbox, loading skeletons preserve existing content during refresh, MFA setup includes QR and a same-device link, safety QR scans validate device fingerprints with explicit confirmation, photo crops support drag/pinch/sliders, and the appearance menu is fully themed. Preserve earlier MFA, installation, and security changes. No live deployment or database migration is implied by implementation. Lint and the webpack production build passed; mobile/desktop static previews were reviewed including extra-large text at 120% zoom. No tests or live account/device flows were run. Migration 012 is applied by npm start on deployment. Push needs browser permission (and a Home Screen install on iOS). See docs/readability-delivery-and-notifications.md for rollout and remaining real-device checks.

### Phase 8 — encrypted media and file sharing (implemented locally, 2026-10-15)

The user asked for WhatsApp-style image, document, and general file sharing, and explicitly excluded calling features. Keep the current one-to-one chat and build attachment delivery into it.

- [x] Add a private Portways S3-compatible Object Storage add-on integration. Do not store uploads on the app container or make the bucket public.
- [x] Encrypt file bytes in the browser with a fresh AES-GCM key and nonce before upload. Bind encryption to the conversation, message, sender device, and attachment ID.
- [x] Put only encrypted bytes in Portways Object Storage. Keep filename, declared media type, plaintext size, file key, and nonce inside the E2EE message envelope. Authorize attachment upload/download through Untold APIs and conversation membership.
- [x] Support image, video, audio, PDF, office documents, and arbitrary file downloads. Show safe in-chat previews for supported raster images, audio, and video; require explicit download for other files.
- [x] Add progress, retry feedback, keyboard/screen-reader support, and a 20 MiB per-file limit (below Portways' 25 MB single-request limit). Keep calls and unrelated WhatsApp features out of scope.
- [x] Add the additive database migration, private attachment API routes, schema, UI, crypto helpers, deployment setup, release checks, and updated plan/README.

Hosting choice: Portways' own MinIO-backed S3-compatible add-on is the file store; it is not an AWS-hosted bucket. The AWS S3 SDK is only the server-side protocol client for Portways' S3 API. The existing E2EE remains first-party and uses native Web Crypto; do not add an external crypto package or allow plaintext file bytes/metadata to reach the API or storage.

### Phase 8 implementation notes

- Implemented locally: migration 007, private upload/download APIs, membership and device checks, rate limits, browser AES-GCM encryption, encrypted attachment manifests, image/audio/video handling, generic downloads, progress, retry and discard controls, and release/setup docs.
- The release still requires a Portways Object Storage add-on linked to the existing app project so Portways injects private bucket credentials, plus the two-browser and live authorization checks in the release checklist. This remains one hosted app project plus its linked storage/database add-ons; no separate attachment service is needed.
- The AWS S3 SDK is only a server-side client for the Portways S3-compatible API. It is not an AWS hosted bucket, crypto provider, or encryption service. File encryption uses the browser's built-in Web Crypto API.

### Finalization pass (2026-10-15)

The local implementation for the current one-to-one messaging scope is in place. Production release remains gated on the live and security checks in `docs/release-checklist.md`. This pass closes stale product copy and makes the handoff explicit.

- [x] Review the implementation snapshot against the release checklist and the actual connected encryption flow.
- [x] Fix product copy that described shipped device safety-code verification as missing.
- [x] Rebuild the site and standalone crypto package, and run lint after the copy fix.
- [x] Keep the release checklist as the handoff for the steps that require two real browser profiles, Portways credentials/live deployment, or an independent protocol review.
- [x] Local finalization is complete; report the build and exact remaining external release gates without claiming those gates are done.

Local final checks before this follow-up on 2026-10-15: `npm run build:all`, `npm run lint`, and `git diff --check` pass. No tests were run after the encryption integration in that pass. Next release steps are listed in the release checklist: verify migration 006, confirm host backup retention, run the two-browser encrypted flow, deploy to Portways with migrations 004–006, inspect the live origin and dependency audit, then obtain an independent protocol review.

### Security hardening in progress (2026-10-15)

- Threat model: protect new message contents from normal backend/database access, assuming correct client code, verified device keys, and uncompromised devices and browser origin. An intended recipient deliberately sharing a message is outside Untold's server-side confidentiality responsibility.
- Compromised device or browser-origin code remains an app-side risk; non-extractable keys do not prevent same-origin code from asking the browser to decrypt.
- The user approved permanently removing pre-encryption message history. Added migration 006 to delete rows that are not structurally valid protocol-v1 envelopes from the live database before the app starts. It also removes malformed/unsupported envelopes. The API filters non-E2EE rows, and the client no longer decodes plaintext legacy messages.
- Migration 006 cannot erase copies retained in host backups. The removed history is unavailable to both conversation members after migration.
- Protocol v1 uses static device agreement keys and has no forward secrecy. A secure upgrade needs a carefully reviewed ratcheting design and independent cryptographic review; do not claim the absolute guarantee or treat an unreviewed homemade ratchet as a fix.
- Before release, verify migration 006 against a database containing both legacy plaintext rows and valid encrypted envelopes, then run the complete two-browser device-verification flow.
- Current checks for this hardening pass: `npm run lint`, `npm run build:crypto`, `npx tsc --noEmit`, and `git diff --check` pass. Four `npm run build:all` attempts failed during Next webpack output with Windows `EPERM: operation not permitted, mkdir` errors under `.next`; the full site build and migration execution remain unverified here. No tests were run.

- Phase 0 (repository inspection and planning): approved.
- Phase 1 (brand foundation and visual prototype): approved.
- Phase 2 (application shell and navigation): approved.
- Phase 3 (messaging interface): approved by the user on 2026-10-14.
- Phase 4 (authentication and onboarding): preview approved by the user on 2026-10-14. Provider selection was deferred to the backend discussion below.
- Phase 5 (backend and real-time messaging): approved; hosting target was changed from Vercel to Portways on 2026-10-15. The user started Phase 6 on 2026-10-14.
- Phase 6 (end-to-end encryption): after the user's explicit direction to build the protocol in-house without a third-party crypto package, a first-party browser protocol is connected to one-to-one messages. It uses native Web Crypto and IndexedDB, with public device keys and ciphertext stored by the Untold backend. Migration 006 purges pre-encryption message rows from the live database. The protocol remains an early custom protocol without forward secrecy or independent review. See [the current Phase 6 design and limits](docs/phase-6-e2ee-architecture.md).
- Phase 7 (hardening and release preparation): local hardening and build preparation complete. Production release remains gated on the checklist in [`docs/release-checklist.md`](docs/release-checklist.md), including live Portways/Ably verification, custom API rate limits, and a dependency audit.
- Production messaging (2026-10-15): one-to-one conversations use authenticated Portways APIs and Postgres, with optional Ably ID notifications and polling fallback. New sends use the first-party encrypted envelope; migration 006 purges older message rows on app startup. Live Portways deployment is pending.

## Durable project rules

- The user explicitly authorized continuing the remaining phases through a final build on 2026-10-15. Do not stop for an intermediate approval prompt.
- Keep security claims accurate. State that messages are browser-encrypted with an early custom protocol that lacks forward secrecy and independent review; migration 006 removes legacy rows from the live database, while host backups may retain copies. A recipient choosing to share decrypted text is outside Untold's server-side confidentiality responsibility; compromised endpoints remain an app-side risk. Do not call the current protocol production-secure.
- Superseded on 2026-10-15: the Phase 3 mock conversations and demo session were removed when real messaging shipped (see the production messaging status above).
- Keep the established calm, premium, accessible visual direction and responsive behavior.
- Update this file with phase status and decisions at each approval boundary. The original master prompt is preserved verbatim below.

## Current implementation snapshot

- Stack: Next.js App Router, React, strict TypeScript, Tailwind CSS 4; npm.
- Hosting target: one Portways full-stack Next.js project (UI plus API route handlers) linked to Portways Postgres and private Object Storage add-ons.
- Preview: http://localhost:3000
- Phase 1 landing page and brand foundation are in place.
- Phase 2 routes: `/app/inbox`, `/app/conversations`, `/app/contacts`, `/app/settings`, `/app/profile`; shared shell, navigation, status, loading, and error components are in place.
- The current conversation workspace uses real backend delivery, local device keys, safety-code trust checks, and encrypted-envelope transport. The older mock messaging preview and plaintext-history display were superseded.
- One-to-one conversations now support encrypted image, video, audio, document, and general file attachments up to 20 MiB each. Attachments use private Portways Object Storage; only ciphertext is uploaded, and filename/type/key/nonce remain inside the encrypted message envelope. See [`docs/phase-8-encrypted-attachments.md`](docs/phase-8-encrypted-attachments.md).
- Phase 5 provides Better Auth email/password sessions, Portways Postgres/Drizzle schemas and migrations, membership-checked message envelopes, and scoped Ably ID notifications. Email verification and password reset delivery remain unconfigured.
- App and encryption test suites are present. Tests have not been run for this attachment update.

### Phase 6 implementation update (2026-10-15)

- User specifically asked us to build our own end-to-end encryption code without a third-party crypto package. This supersedes the earlier feasibility stop for this implementation pass; it does not remove the independent-review requirement.
- Added `crypto/src/protocol.ts`: per-browser P-256 ECDH and ECDSA identity keys, local IndexedDB persistence, AES-GCM text envelopes, HKDF-based per-device content-key wraps, signatures, and safety-code fingerprints.
- Added migrations 004 and 005 and authenticated device registration/directory/revocation routes. The API returns message bytes as opaque base64 and verifies that new envelope headers match the authenticated account, conversation, message ID, active sender device, and current active-device list.
- Connected chat send and receive to encrypt/verify/decrypt in the browser. New and changed devices block sending; messages from unverified sender devices are not shown. Account settings include revocation of other devices and expiry of their account's other sessions.
- Known limits: static ECDH has no forward secrecy or post-compromise security; first-contact key substitution remains possible before a manual comparison; no key backup/recovery or group chats; attachments are limited to 20 MiB each; same-origin malicious JavaScript can access unlocked plaintext; old host backups may retain legacy plaintext. No independent review or two-browser security verification has been completed.
- Added migration 006 to purge pre-encryption and malformed/unsupported message rows at startup. The app no longer decodes legacy plaintext messages, and the messages API filters responses to valid protocol-v1 envelopes.
- Current checks: `npm run build:all` and `npm run lint` pass. The default Turbopack build hit a Windows worker-start failure, so `npm run build` uses Next.js's supported webpack build. No tests or two-browser flow were run for this update; migration 005 and live Portways connectivity remain unverified.
- Browser-native Web Crypto and IndexedDB references: [W3C Web Crypto](https://www.w3.org/TR/WebCryptoAPI/) and [W3C IndexedDB](https://www.w3.org/TR/IndexedDB/). See [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html) for the forward-secrecy and post-compromise properties this v1 protocol does not implement.

## Phase 4 decision context (provider decision recorded below)

- Do not connect a real identity provider, persist credentials, create an account data model, or implement password/account recovery before explaining the available approaches and their security and operational consequences.
- Phase 4 can demonstrate form validation, onboarding, and a clearly labeled temporary in-memory demo session. Password fields must never leave the browser and must be cleared after a valid preview submission or when leaving the form.
- Keep account-access recovery distinct from recovery of future end-to-end encryption keys. Account recovery may restore login without recovering old message keys.
- Provider approaches compared before integration: a managed identity service such as Clerk (quick hosted flows and session/user management, with an external processor and vendor dependency); auth bundled with a chosen backend such as Supabase Auth (convenient with its Postgres/RLS stack, while tying identity and session behavior to that platform); or a self-managed framework such as Better Auth (more control over where account data lives, with greater responsibility for storage, session security, email delivery, abuse controls, and updates). The choice also depends on pricing, data residency, sign-in methods, and keeping future encryption keys separate from provider-held account data. At the end of Phase 4, no option had been selected; Better Auth was selected for Phase 5 below.
- Recovery concepts presented for review: verified email reset, a user-held single-use recovery code, or approval from an existing trusted device. These have different availability and compromise risks. No recovery mechanism is wired up; recovery of account access does not by itself recover future message keys.
- References: [Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication), [Clerk user management](https://clerk.com/docs/guides/users/managing), [Supabase Auth](https://supabase.com/docs/guides/auth), [Better Auth](https://better-auth.com/docs/introduction), [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), and [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html).

## Phase 4 review record (2026-10-14)

- Added sign-up and sign-in screens with local validation, useful field errors, password visibility, and explicit feedback that credentials are not sent or saved.
- Added a fictional in-memory demo session, onboarding and identity-verification education, a profile preview, and sign-out controls. Reload clears the session; there is no real authentication or account persistence.
- Added an account-recovery concept page comparing email reset, a saved recovery code, and a trusted device. No recovery mechanism is connected; account recovery is distinguished from recovering future message keys.
- Provider directions and consequences are summarized above; no provider or account data model has been selected.
- `npm run lint`, `npx tsc --noEmit`, `npm test` (9 passing tests), and `npm run build` all pass.
- Browser review covered validation, password clearing, sign-in feedback, sample profile, onboarding, logout, recovery concepts, route HTTP status, and 390/768/1024/1440-pixel layouts. No horizontal overflow was found.
- Review captures: `untold-phase4-signup-desktop.png`, `untold-phase4-signup-mobile.png`, `untold-phase4-onboarding-desktop.png`, `untold-phase4-onboarding-mobile.png`, and `untold-phase4-recovery-desktop.png` in the Codex visualization output folder.
- Preview: http://localhost:3000
- User approved the preview direction on 2026-10-14. At that point no authentication provider was selected; the later Phase 5 architecture discussion records the decision.

## Backend hosting discussion (2026-10-14)

- The user asked us to use [Portways database docs](https://db.portways.app/docs) to guide the database choice and asked whether the rest can be hosted on Vercel.
- The sandboxed browser and fetch tools could not resolve the host, but the user supplied `/docs.md` and authorized another attempt. An escalated direct HTTPS read then returned HTTP 200; the full guide was reviewed. Source: [Portways database and storage guide](https://db.portways.app/docs.md).
- Portways provides Postgres, Redis, and S3-compatible object storage. Postgres is reached through an encrypted WebSocket gateway at `wss://db.portways.app/v1`; for serverless hosts including Vercel, the guide recommends `@neondatabase/serverless` with `wsProxy = () => "db.portways.app/v1"`, secure WebSockets enabled, `pipelineConnect = false`, and the token passed as a WebSocket subprotocol. The guide says the HTTP query helper is unsupported; use the `Pool`/`Client` API. A bridge process is for conventional hosts and cannot be kept beside serverless functions.
- Keep the Portways token, Postgres username/password/database, and any storage credentials in server-side environment variables only. The guide documents token-specific rate, connection, data, query, and storage limits. Example common limits include 3 queries/second and 10 concurrent Postgres connections; pools need to be small (`max: 1`–`3` on serverless), reused, and recycled before 10 minutes idle / 12 hours lifetime. Actual token tier and quotas must be confirmed before production capacity is assumed. Databases above 5 GB become read-only by default. Run schema migrations from one controlled location, not at every function start.
- Vercel is a suitable host for this Next.js App Router application and its server-side routes/functions. Its current documentation supports Next.js full-stack deployment and WebSockets in Functions as public beta. Vercel documents a need for shared state for durable coordination across socket/function instances. Portways documents Redis through its bridge, but does not provide a serverless Redis WebSocket path in this guide; do not assume Portways Redis can be used directly from Vercel Functions.
- Phase 5 architecture (approved by the user's "start with next phase" response): (1) deploy the Next.js app and server-side API on Vercel; (2) use Portways Postgres through the documented Neon serverless WebSocket driver for account, conversation, membership, and opaque message-envelope persistence; (3) use Better Auth with its PostgreSQL/Drizzle adapter in app-specific schemas; (4) use Ably Pub/Sub as the managed realtime broker, with Vercel issuing short-lived channel-scoped tokens after checking session and conversation membership; publish only message-available IDs over Ably and fetch opaque payloads through the authenticated app API; (5) reserve Portways S3-compatible private storage for a later attachment design, after Phase 6 defines encryption. Keep cryptographic keys and plaintext message content out of the server architecture.
- Ably is recommended over Vercel's public-beta WebSocket runtime for the initial realtime transport because its managed Pub/Sub connection layer avoids building multi-instance socket fanout into Vercel Functions. Ably adds a separate provider dependency and can still observe conversation/channel identifiers, event timing, and connection metadata; do not send message text or ciphertext through Ably when IDs plus authenticated fetches suffice. Issue narrow capabilities for only the specific conversation channels a user can access; keep presence/typing signals out of scope until their metadata value is justified.
- Better Auth was selected because its official docs support PostgreSQL and Drizzle, allowing identity/session records to live with Portways instead of adding an identity database. Trade-off: Untold owns more auth integration and operational work. The integration uses the documented Neon serverless Pool and a controlled SQL migration runner; it still needs a live Portways smoke check. Clerk remains the lower-operations managed alternative with an external identity processor; Supabase Auth is less cohesive with Portways as the chosen primary database.
- Important scale/operations caveat: Portways quotas are per token and each Vercel instance can open its own pool. Even a small per-instance pool can hit the token connection/query ceilings as instances multiply. Keep pools at one connection initially, batch database work, monitor 429/slowdown limits, and confirm the issued token tier plus regional latency before treating this as production capacity.
- References: [Portways docs](https://db.portways.app/docs.md), [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Vercel WebSocket support announcement](https://vercel.com/changelog/websocket-support-is-now-in-public-beta), [Vercel environment variables](https://vercel.com/docs/environment-variables), [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql), [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [Ably token authentication](https://ably.com/docs/auth/token?lang=javascript), and [Ably channel capabilities](https://ably.com/docs/auth/capabilities).
- User said "start with next phase" on 2026-10-14 after reviewing the proposed architecture; treated as approval to implement Phase 5 with Vercel, Portways Postgres, Better Auth, and Ably. Secrets are not available and must not be placed in source control or chat.
- Hosting decision changed on 2026-10-15 after the user provided the Portways hosting guide (kept private and out of the repository): run the Next.js UI and API routes on Portways and use a linked Portways Postgres add-on. This supersedes Vercel as the application host and removes the serverless Neon WebSocket gateway from the hosted runtime. The existing Next.js app is one integrated full-stack service, so it is deployed from the repository root as one Portways project; if frontend and API become separate app directories later, they must be separate Portways projects with distinct root directories. Keep Ably for the currently approved ID-only realtime notifications unless its transport is separately redesigned.
- At the start of Phase 5, no backend implementation, provider setup, database schema, or secrets had been added.

## Phase 5 implementation record (2026-10-14)

- Added Better Auth server and client setup for email/password sign-up, sign-in, persisted sessions, and sign-out. Password rules are 15–128 characters. Auth rate limits use the database with five sign-in and sign-up attempts per minute per detected client IP. Email verification is not required because no mail service is configured; recovery remains unimplemented.
- Added a Portways Neon serverless WebSocket Pool with the documented WSS proxy, secure WebSockets, disabled pipeline connect, and the token subprotocol. The pool max is one per warm function instance, idle timeout five minutes, and maximum lifetime one hour.
- Added `untold_auth` and `untold_app` schemas. Fixed the membership index to allow users in multiple conversations and the message pagination index to allow equal timestamps. Stored message envelopes use PostgreSQL `bytea` and a 64 KiB decoded payload cap.
- Added checksummed SQL migrations for the auth and messaging tables. `npm run db:migrate` uses the Portways bridge through `DATABASE_URL` and refuses non-loopback hosts. `.env.example` documents required server-only variables.
- Added authenticated message envelope GET/POST handlers with membership checks and sender/client-message idempotency. Added Ably channel token issuance that verifies every requested membership and grants only `subscribe` on those conversation channels for 15 minutes. Publish events contain only conversation and message IDs. Ably publish failure does not discard the saved envelope; delivery retry/outbox behavior remains future work.
- Rewired the account UI to the real auth client when configured, preserving the fictional in-memory sample profile. Passwords are cleared after each request. Profile and settings distinguish an account session from the demo session. Messaging screens explicitly remain mock-only.
- Added pure unit coverage for configuration checks, password limits, and opaque envelope validation, plus a conditional local backend smoke-check command that checks migrated schemas, Better Auth session routing, and unauthenticated realtime rejection.
- Local checks: `npm test` passes 17 tests; `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass; `npm audit` reports zero vulnerabilities. The built home, sign-up, and inbox routes returned HTTP 200. With no backend environment configured, auth and realtime API routes returned the designed 503 configuration response.
- Live integration has not been run because no Portways credentials, local bridge, or Ably key are present. Follow `BACKEND.md` to configure local or Vercel environment variables and run `npm run test:backend` when those services are available. Do not claim live database or realtime delivery has been verified.
- Historical limits at the end of Phase 5: no conversation creation/contact discovery, no email verification or password recovery mail, no client encryption, no UI message delivery, no attachments, and no push notifications. Later Phase 6 and Phase 8 updates supersede the encryption and attachment limits above. The server cannot prove that accepted opaque bytes are encrypted.
- Documentation: [BACKEND.md](BACKEND.md); source guide: [Portways docs](https://db.portways.app/docs.md).

## Portways application hosting update (2026-10-15)

- The user's current hosting decision is to host the frontend, server API, and database on Portways. This supersedes the earlier Vercel hosting direction recorded above.
- The repository is one integrated Next.js full-stack app: its pages and `/api/*` routes run in the same Node process. Deploy the root project on Portways; `npm run build` produces the Next build, and `npm start` binds to `0.0.0.0` while Next reads Portways's `PORT`. Link a Portways Postgres add-on, which injects `DATABASE_URL` with a project-scoped login. Do not split the app into separate origins just to match a generic frontend/API example; if the code is later split into separate directories, create a Portways project for each root.
- Switched the hosted runtime database driver from Neon-over-WebSocket to the standard `pg` driver and Drizzle's Node Postgres adapter. The runtime pool is capped at three connections per replica, within the hosting guide's five-connection recommendation. Migrations continue to run once from a controlled machine through the local Portways bridge; never run them at app startup. (Superseded 2026-10-15: migrations now run on start under an advisory lock; see BACKEND.md.)
- `BACKEND.md` now documents Portways project creation, add-on linking, environment variables, local bridge migrations, replica limits, and the still-external Ably notification dependency. Dashboard resources and live deployment cannot be created from this repository alone.
- After the switch, `npx tsc --noEmit` and `npm run build` pass. The automated test suite was not run for this hosting update. No Portways project or live database is configured here, so deployment connectivity remains unverified.

## Phase 6 pre-implementation security decision and candidate review (2026-10-15; historical)

This records the assessment before the user's explicit direction to implement a first-party v1. The current implementation and its limits are recorded in the Phase 6 implementation update in the current status section above.

The detailed proposal is in [`docs/phase-6-e2ee-architecture.md`](docs/phase-6-e2ee-architecture.md). It keeps Untold's own Next.js app, Portways Postgres/API, and Ably ID notifications; it does not adopt Matrix or Megolm and does not invent a protocol.

### Current feasibility decision

- OpenMLS 0.9.1 is the strongest protocol-engine candidate on license and audit evidence. SRLabs performed an external audit. Its core has a WASM CI test job, while the separate browser binding crate remains an unpublished experiment and is not covered by that job.
- `@vanishing.page/webcrypto-mls` provides a browser-native TypeScript surface, but its package metadata selects the Big Time Public License and no independent audit of its MLS core was found. Its in-repository audit covers the random-access attachment branch, not the MLS core.
- CoreCrypto provides a custom MLS transport API, but its GPL-3.0 license needs review and its documented WASM keystore is unaudited. `mls-rs` marks its browser Web Crypto provider experimental and reports no full third-party audit. None provides a complete, supported browser integration path for Untold.
- The experimental OpenMLS wrapper is incomplete for browser persistence and has panic/unimplemented paths. No Rust toolchain is installed in this workspace, so the route cannot currently be built or validated here. Do not write an unreviewed custom crypto binding or store private keys on the server to work around this.
- No external encryption dependency has been added and no UI/API message flow has changed. The standalone helper in [`encryption/`](encryption/README.md) uses the browser Web Crypto API, but chat remains mock-only and messages are not end-to-end encrypted. Phase 6 remains stopped at the documented integration security gates.
- Created [`crypto/`](crypto/README.md) as a private, dependency-free package boundary for Untold's browser integration. It is not a protocol implementation or separate hosted service.
- Before resuming, establish a supported browser API, reviewed local-state and recovery design, reproducible browser build, backend device/key-package directory, and ordered paginated message history. Complete two-device adversarial tests and independent review before enabling real messages or making a production E2EE claim.
- References: [OpenMLS 0.9.1](https://docs.rs/crate/openmls/0.9.1), [OpenMLS SRLabs audit summary](https://blog.phnx.im/openmls-independent-security-audit/), [OpenMLS WASM experiment](https://github.com/openmls/openmls/tree/main/openmls-wasm), [OpenMLS WASM CI job](https://github.com/openmls/openmls/blob/main/.github/workflows/tests.yml), [OpenMLS JavaScript API request](https://github.com/openmls/openmls/issues/487), [`webcrypto-mls` manifest](https://github.com/vanishing-page/webcrypto-mls/blob/main/package.json), [`webcrypto-mls` attachment audit](https://github.com/vanishing-page/webcrypto-mls/blob/main/AUDIT-ra.md), [Wire CoreCrypto](https://github.com/wireapp/core-crypto), [`mls-rs`](https://github.com/awslabs/mls-rs), [IETF MLS RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html), and [OpenE2EE assurance statement](https://github.com/open-e2ee/signal-protocol-js/blob/main/docs/ASSURANCE.md).

## Phase 7 hardening and build record (2026-10-15)

- Added nonce-based CSP through the Next.js 16 `proxy.ts` convention, standard browser security headers, and exact-origin checks for authenticated message writes and realtime-token requests. Added `connection()` at the root layout so every page renders dynamically and Next.js can attach the request nonce to its scripts.
- Reduced backend failure logging to an error type and removed raw realtime publish errors. No request body or message content is logged by these paths.
- Added `encryption/tests/` boundary checks for random secret shape, Unicode round trips, wrong keys/context, tampering, invalid envelope/version, and 64 KiB limits. `npm run test:all` runs both suites.
- Added `npm run build:encryption` and `npm run build:all`; the separate package emits browser JavaScript and TypeScript declarations under ignored `encryption/dist/`.
- Checks: `npm run lint`, `npx tsc --noEmit`, and `npm run test:all` pass (22 tests). `npm run build:all` passes. The sandboxed first build hit a Windows SWC path permission failure; the same build succeeded with elevated workspace access.
- Production HTTP smoke check on the local built app: `/` and `/auth/sign-in` returned 200; all 12 script tags included their request's CSP nonce; `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` were present.
- `npm audit` could not reach `registry.npmjs.org` because DNS/network access is restricted; dependency advisory status is unverified. No Portways instance, live database, or Ably credentials are configured. Custom message/realtime API rate limits, live authorization checks, live HTTPS/HSTS inspection, email verification/recovery, and independent crypto review remain outstanding.
- At the time of this record, the final artifact was a local production build and chat was still a mock preview. Superseded by the Phase 6 implementation update above; live Portways deployment is still pending.

## Phase 3 review record (2026-10-14)

- `npm run lint`, `npx tsc --noEmit`, `npm test` (5 passing tests), and `npm run build` all pass.
- Browser review confirmed search, conversation selection, no-results feedback, local message composition feedback, and the unverified/not-encrypted details disclosure.
- Browser viewports checked at 390, 768, 1024, and 1440 pixels; the 390-pixel list and conversation thread were reviewed visually.
- Existing application routes returned HTTP 200 in the local preview.
- Review captures: `untold-phase3-desktop.png`, `untold-phase3-mobile-list.png`, and `untold-phase3-mobile-thread.png` in the Codex visualization output folder.
- Preview: http://localhost:3000
- User approved Phase 3 on 2026-10-14; Phase 4 began after approval.

---

## Original master prompt (preserved verbatim)
# Codex Master Prompt: Untold

You are the lead product designer, senior frontend engineer, and software architect responsible for building **Untold**, a premium end-to-end encrypted messaging platform.

Your task is to build a polished, modern, privacy-first messaging web application with the simplicity, refinement, and attention to detail associated with Apple's design philosophy.

**You MUST work in strictly controlled phases. Implement one phase at a time, show me the actual result, and wait for my explicit approval before proceeding. This is a mandatory requirement.**

Do not attempt to build the entire application in one go.

---

## 1. Product Vision

**Product:** Untold  
**Category:** Private, end-to-end encrypted messaging  
**Brand personality:** Premium, minimalist, calm, trustworthy, modern  
**Brand tagline:** "Some things are just between us."

Untold should feel like a thoughtfully designed consumer technology product, not a generic messaging clone or a cybersecurity dashboard.

The experience should communicate privacy through its design rather than relying on excessive locks, shields, gradients, or technical jargon.

### Core principles

- Privacy by design.
- Beautiful, intuitive interfaces.
- Fast and responsive interactions.
- Minimal visual clutter.
- Clear and honest security communication.
- Accessibility and responsive design.
- Maintainable, production-quality code.

Never claim that a feature is encrypted, secure, or production-ready unless its implementation genuinely supports that claim.

## 2. Technology Stack

Use modern, stable, production-ready technologies and their latest mutually compatible stable versions available when implementation begins.

Preferred stack:

- **Next.js:** App Router.
- **React:** Current stable release compatible with Next.js.
- **TypeScript:** Strict mode enabled.
- **Tailwind CSS:** Current stable version.
- **shadcn/ui:** Only where useful; customise components to match the product.
- **Lucide React:** Consistent, restrained iconography.
- **Motion:** Optional, for subtle and purposeful transitions.
- **Zod:** Runtime validation for untrusted input and form data.
- **React Hook Form:** Where complex forms justify it.

Use Server Components by default and Client Components only where interactivity requires them.

Use the package manager already present in the repository. If the project is empty, choose a suitable package manager and remain consistent.

Do not introduce unnecessary dependencies or outdated APIs. Check official documentation when needed rather than guessing.

The backend, database, authentication provider, and cryptographic implementation must be selected deliberately in the appropriate phases. Do not make irreversible architectural decisions without explaining their trade-offs.

## 3. Visual Direction

The interface should resemble a premium, carefully art-directed product.

### Brand identity

- Wordmark: `untold`, preferably lowercase.
- Typography: A refined sans-serif with excellent readability.
- Logo: A simple, distinctive symbol that can work independently as an app icon.
- Colours: Restrained neutrals with one subtle signature accent.
- Surfaces: Clean, precise, and uncluttered.
- Borders and shadows: Subtle, purposeful, and consistent.
- Spacing: Generous whitespace and a coherent spacing system.

Prefer an elegant light theme initially, with a carefully designed dark theme introduced where appropriate.

Avoid:
- Generic AI-generated landing-page aesthetics.
- Excessive glassmorphism.
- Neon gradients and glowing borders.
- Oversized collections of rounded cards.
- Unnecessary animations and decorative elements.
- Stock imagery that does not contribute to the product.
- Copying Apple's actual branding, proprietary assets, or interface designs.

The result should have its own recognisable identity while retaining the refinement of premium consumer software.

## 4. Mandatory Phase-Gated Workflow

Work sequentially through the phases below.

**After completing each phase, stop and wait for my approval.**

Do not start the next phase merely because the current phase appears complete. Only an explicit instruction from me, such as "Approved, proceed to Phase 2", authorises you to continue.

If I request changes, revise the current phase and present it again for approval.

### Phase 0: Repository inspection and planning

Before changing any files:

1. Inspect the existing repository, directory structure, dependencies, scripts, and configuration.
2. Identify whether this is an existing application or a new project.
3. Preserve existing functionality and avoid overwriting useful work.
4. Establish the proposed architecture, routes, design system, and phase plan.
5. Identify important technical risks, especially those associated with end-to-end encryption.

If the repository is empty, prepare the project structure and tooling plan.

Do not implement the entire application.

Present a concise plan, the proposed stack, the anticipated directory structure, and the deliverables for Phase 1.

**Stop and wait for approval before beginning Phase 1.**

### Phase 1: Brand foundation and visual prototype

Build the initial visual foundation of Untold.

Deliverables:

- A refined wordmark and simple original logo.
- Typography, colour tokens, spacing, borders, and design primitives.
- A responsive landing page introducing Untold.
- A compelling hero section and clear product positioning.
- A concise explanation of the privacy-first philosophy.
- Feature sections covering private messaging, encrypted conversations, and future capabilities.
- A clear call to action.
- A polished footer and responsive navigation.
- Responsive layouts for desktop, tablet, and mobile.

Use accurate wording. Do not advertise encryption features that have not yet been implemented.

The landing page must feel like a real product, even when the backend does not yet exist.

Run the development server, verify the page, and present the actual rendered result using available preview or screenshot capabilities. If a visual preview tool is unavailable, provide the local URL and precise instructions for viewing it.

Do not begin authentication or messaging functionality during this phase unless I explicitly approve expanding its scope.

**Stop and wait for approval.**

### Phase 2: Application shell and navigation

Once Phase 1 is approved:

- Establish the authenticated application layout.
- Implement navigation, responsive layouts, and reusable interface components.
- Create the primary routes for the inbox, conversations, contacts, settings, and profile.
- Design loading, empty, error, and unavailable states.
- Establish consistent keyboard navigation and accessibility behaviour.

Use mock data where necessary. Clearly distinguish mock functionality from real functionality.

Do not implement cryptography or a production backend yet.

Present the working application shell and wait for approval.

### Phase 3: Messaging interface

Build the core messaging experience using mock conversations and mock contacts.

Include:

- Conversation list and search.
- Message history.
- Message composition and sending interactions.
- Message timestamps and delivery-state presentation.
- Contact and conversation details.
- Responsive layouts for smaller screens.
- Empty states and sensible interaction feedback.
- Clear visual distinctions between the current user and other participants.

The interface must be coherent and usable, not merely a collection of static screenshots.

Do not fabricate encryption status, verified identities, or real message delivery.

Present the working prototype and wait for approval.

### Phase 4: Authentication and onboarding

Design and implement the authentication experience.

Include:

- Sign-up and sign-in interfaces.
- Session and logout flows.
- Form validation and useful error messages.
- Account recovery design, with security implications explained before implementation.
- Onboarding and privacy education.
- Identity verification concepts where appropriate.

Before selecting an authentication provider or changing the data model, explain the available options and their consequences.

Never store plaintext passwords or implement authentication using insecure shortcuts.

Present the implemented flows and wait for approval.

### Phase 5: Backend and real-time messaging

Propose and agree upon the backend architecture before implementation.

Evaluate appropriate technologies for:

- User identity and account management.
- Contact discovery.
- Conversation membership.
- Real-time message transport.
- Persistent message storage.
- Device management.
- Rate limiting and abuse prevention.
- Push notifications, if required.

Design the system so that the server does not need access to plaintext message content.

Treat push notifications, message previews, logs, backups, metadata, and file uploads as potential privacy risks.

Implement the agreed architecture incrementally. Add integration tests and document required environment variables.

Do not proceed without my approval of the proposed backend design.

### Phase 6: End-to-end encryption

Treat this phase as a security-critical engineering task, not a visual feature.

Before implementation, provide a written security architecture covering:

- The threat model and security assumptions.
- Device identity and public/private key management.
- Session establishment and key agreement.
- Message encryption and authentication.
- Forward secrecy and post-compromise security.
- Multi-device support and device revocation.
- Key verification and identity-change warnings.
- Secure handling of attachments.
- Key backup and account recovery trade-offs.
- Server-visible metadata and its limitations.

Prefer a mature, independently reviewed messaging protocol and maintained cryptographic implementations. Investigate established approaches such as the Signal Protocol and determine whether a supported implementation is suitable for this platform.

Do not invent a cryptographic protocol or design your own encryption primitives.

Do not assume that HTTPS, database encryption, or encrypting messages with one permanent key constitutes complete end-to-end encryption.

Never place private keys in plaintext server storage, expose secrets to client bundles, or log decrypted messages.

If a reliable protocol integration cannot be implemented safely with the available libraries and infrastructure, stop and explain the limitation instead of improvising.

Create tests for cryptographic boundaries, authentication failures, replay handling, and key changes as appropriate to the selected protocol. Arrange independent security review before representing the system as production-secure.

Present the implementation, limitations, and verification evidence. Wait for approval.

### Phase 7: Hardening and release preparation

Once the preceding phases are approved:

- Test mobile, tablet, and desktop behaviour.
- Audit accessibility and keyboard interactions.
- Review loading performance and bundle sizes.
- Add appropriate rate limits and input validation.
- Review authentication, session handling, and permissions.
- Check dependency vulnerabilities and security headers.
- Review error handling and privacy-safe logging.
- Add automated tests and a repeatable build process.
- Configure deployment requirements and environment variables.
- Document known limitations and outstanding security risks.

Do not declare the application production-ready merely because the build succeeds.

Provide a release checklist and a clear distinction between verified functionality, untested assumptions, and remaining work.

---

## 5. Approval Protocol

At the end of every phase, provide the following report:

**Phase completed:** Phase number and name.

**What changed:** The important files, components, routes, and behaviours implemented.

**How to preview:** The local URL and any steps needed to inspect the work.

**What works:** Verified functionality.

**What remains mocked or incomplete:** Any limitations that matter to evaluating the result.

**Checks performed:** Build, lint, type-check, tests, and visual checks actually completed. Never claim a check passed unless you ran it successfully.

**Next phase:** A brief description of the proposed next phase.

Then ask:

"Would you like to approve this phase, request changes, or discuss anything before proceeding?"

After asking, STOP.

Do not silently begin another phase, run ahead with additional implementation, or interpret silence as approval.

## 6. Engineering Standards

Throughout the project:

- Use clear, reusable, strongly typed components.
- Keep components focused and avoid unnecessarily large files.
- Follow the conventions of the existing repository.
- Separate UI, application logic, data access, and security-sensitive operations.
- Avoid `any` unless genuinely unavoidable and documented.
- Handle failures explicitly.
- Never hardcode credentials or commit `.env` files containing secrets.
- Keep environment variables documented in `.env.example` without real secrets.
- Use realistic mock data, clearly isolated from production services.
- Add tests for important behaviours as functionality is introduced.
- Do not suppress errors simply to make a build pass.
- Do not make unrelated changes outside the approved phase.
- Keep documentation updated when architecture changes.

If a dependency or technical decision has a meaningful security, performance, maintenance, or cost trade-off, explain it before proceeding.

## 7. How You Should Work With Me

I will review each phase and provide feedback.

You are responsible for implementing the approved scope, running the appropriate checks, and presenting the actual result.

If I request a revision, make the necessary changes within the current phase, verify them, and present the updated result. The phase remains incomplete until I approve it.

If you encounter a blocking decision, ask a concise question rather than making a risky assumption.

Do not ask me to make trivial design decisions that you can reasonably handle using the established visual direction.

**Your immediate task is Phase 0 only. Inspect the repository and present the implementation plan. Do not implement Phase 1 or any subsequent phase until I approve the plan.**
# Attachments, calls, and private membership

- [x] Open supported attachments in an accessible in-app viewer with download fallback.
- [x] Record, preview, discard, and send compressed voice messages through encrypted uploads.
- [x] Add voice and video calls with authenticated signaling, incoming controls, cleanup, and provider-neutral TURN configuration. Cloudflare-specific TURN integration removed at the user's request.
- [x] Require admin approval for new accounts, enforce it on APIs, and add approve/reject management.
- [x] Replace crop positioning sliders with direct dragging, pinch zoom, and clear crop controls.
- [x] Document configuration and remaining live-device deployment checks in `docs/private-membership-and-calls.md`.

Implementation is complete in files. Local production webpack build, TypeScript, lint, and diff checks pass. Production dependency audit reports zero known vulnerabilities, including PDF.js. No automated tests were run. Relay provisioning, migration 015 on the live database, and real-device call checks remain deployment steps.
