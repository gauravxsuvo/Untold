# Call reliability, history, and navigation

Implemented locally on 2026-10-16. This supersedes the earlier call-window follow-up's migration guidance: **include migration 018 after 017 before serving this application version**.

## Behavior

- Remote video uses muted inline playback and a separate routed audio element. Output selection and audible autoplay cannot hold back the picture. Late tracks, track interruption, window movement, and restore retry playback. Enable call audio handles audible autoplay restrictions; output failure remains visible in the active call window.
- Phones get a full visible-height call surface; desktop gets a bounded movable/resizable window. A definite media area replaces the percentage-height sizing cycle. Controls stay outside the media scroller. More options contains devices and connection information. Group tiles can be pinned; screen sharing takes a wide tile. Themes and readability preferences remain supported.
- Minimized calls retain return, mute, and hangup/leave controls. Supported browsers offer Document PiP or native video PiP. Failed PiP offers a separate user-clicked popup action. Closing a child window returns the existing media and controls to Untold. Sharing and playback errors stay visible inside the external call surface.
- Screen capture uses the clicked window's API, explains permission/OS failures, and relaxes unsupported optional capture constraints while preserving sender bandwidth limits. It replaces camera video, retains microphone audio and camera state, and restores the camera on Stop. Browsers without capture omit the start-share control and explain the limit in More options; receiving shares remains available.
- Direct/group calls create persistent cards in their conversations, including call-only conversations. A card updates in place. Call activity contributes to conversation visibility, preview, and ordering. A draft or capture failure before server acceptance does not expose a private draft chat.
- Calls provides All/Missed filters, date groups, details, known durations, call-back, and joining a specific live group room. An expired Join action cannot silently start another room. The account missed indicator acknowledges only entries visible in a focused Calls view and syncs across devices.
- Navigation is Inbox, Chats/Conversations, Calls, Contacts, Settings. Profile is at `/app/settings/profile`; the old `/app/profile` address redirects there.

## Persistence and authorization

Migration `018-call-history.sql` adds direct answer/connection/end metadata, camera/share status, group connection acknowledgments, and `call_history`, `call_history_audience`, and `call_attendance`.

Database triggers write history in the same transaction as signaling/participant updates. Persistence is centralized below HTTP handlers to cover expiry, repeated end requests, device/account revocation, and recovery. Post-response callbacks publish metadata invalidations only; polling and foreground snapshots repair missed notifications.

Direct duration requires connected acknowledgments from both selected approved devices after answer acceptance. Group duration begins after overlapping connected attendance from at least two joined participants; per-person intervals survive leave/rejoin. These are application-reported timestamps, not proof someone heard or watched media. Answer acceptance alone is not treated as connection success.

History checks account/device approval, current conversation membership, and the captured audience. New group members cannot query earlier rooms. Selected-device revocation ends direct calls and removes group participation. Bounded reconciliation finalizes expired records without a final browser request. One participant leaving does not end the group's shared history card while others remain.

Mixed timeline reads select messages and calls through one ordered cursor before loading encrypted bodies. Cursors preserve PostgreSQL microseconds. Loaded live cards continue receiving terminal updates even when newer activity pushes them beyond the newest page. Message encryption and Received/Read remain separate from system activity.

History contains server-visible participant/timing/status metadata, never recordings, frames, SDP, ICE candidates, TURN credentials, or private keys. It is not presented as encrypted chat content. Legacy direct records retain only provable metadata and unknown outcomes/durations. Historical group rooms are not backfilled because their audience cannot safely be reconstructed from current membership.

## Verification

The standard suite includes call labels/outcomes/cursors and conversation activity checks. Two additional scripts use isolated tools under the ignored test-build directory:

```powershell
npm install --prefix .test-build/call-tools --no-package-lock --no-audit --no-fund @electric-sql/pglite@0.5.10 esbuild@0.28.2
npm run test:calls:database
npm run test:calls:browser
```

PGlite executes ephemeral PostgreSQL without reading `DATABASE_URL`. Esbuild bundles actual call window/media/device components for a generated-media browser fixture. Neither package is a production dependency. The browser harness uses its own temporary profile and a local peer connection, not real cameras/microphones or accounts. Set `BROWSER_PATH` if needed. Cleanup closes its browser and deletes only its own checked temporary profile.

Recorded results:

- `npm test`: 50 passing tests.
- Database harness: 12 passing checks using migrations 001–018 and actual server queries: upgrade/legacy data, repeated terminal updates, missed/declined outcomes, group rejoining, late/removed-member access, and equal/sub-millisecond timeline cursor boundaries. This is not a concurrent multi-connection PostgreSQL stress test.
- Headless Chromium: moving remote video before fullscreen, one remote audio owner, late audio, simulated output failure keeping video playing while audio pauses, minimize/restore, denied PiP followed by a real popup, same-element preservation/close/return, video sender replacement with bandwidth controls, group layout, readability, and cleanup.
- Viewports: 320x568, 390x844, 390x340, touch landscape 844x390, tablet 768x1024, desktop 1366x768 and 1440x900; also 120% zoom, 200% text, and AMOLED. Rendered screenshots were reviewed under `.test-build/calls-browser`.
- TypeScript, lint, production webpack compilation, and whitespace checks pass. Default Turbopack stalled in this Windows workspace; its identified build process was stopped and the existing webpack fallback succeeded.

The fixture supplies account/call context and control fixtures. It tests actual rendering/media primitives and a real loopback peer connection, not authenticated signaling between live accounts, a native capture chooser, or production TURN connectivity.

## Release checks

1. Deploy migration 018 with the app through the existing migration-on-start `npm start` workflow. No new runtime environment variables are needed. Check schema/trigger creation permission on staging before publishing new queries. Keep the additive migration/data if reverting app code; never rewrite an applied migration.
2. Exercise two approved accounts and a 3–8-person group on staging: normal video, start/answer/decline/cancel/missed, device changes, rejoining, two-device answer races, revocation/recovery, busy calls, call-only chat visibility, missed badge sync, history paging, and Profile/photo editing.
3. Check physical iPhone Safari/Home Screen, Android Chrome/installed app, desktop Safari/Firefox/Chrome/Edge, separate networks, and relay-only connectivity. Cover actual capture chooser dismissal/denial/native Stop, OS permissions, native fullscreen, manual/automatic PiP permissions, popup blocking, headphones disconnecting, lock/background/foreground, and ending during permission prompts.
4. Confirm all capture indicators stop after hangup, removal, or main-window closure. A PWA cannot add missing mobile capture APIs or guarantee calls while its OS suspends it. The existing signed signaling, verification, relay policy, and 55-minute credential limit remain in force.

No production migration, authenticated live call, physical-device test, commit, or deployment was performed here.
