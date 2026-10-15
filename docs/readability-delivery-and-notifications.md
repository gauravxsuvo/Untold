# Readability, delivery, and mobile improvements

## User controls

- Settings has four font sizes and separate interface zoom choices of 90%, 100%, 110%, and 120%, plus a reset button and preview. Preferences are saved per browser with cookies for the initial server render and local storage for cross-tab updates. Values are restricted to supported choices. Browser pinch zoom remains enabled.
- Typography uses system sans fonts: Apple system fonts on Apple devices, Roboto where supplied by Android, and Segoe UI on Windows. Controls use the same family. Small utility text now starts at 12 CSS pixels before the size preference.
- The appearance control is a themed menu with Light, Dark, and AMOLED options, icons, descriptions, selected-state checks, arrow/Home/End navigation, Escape handling, and focus restoration. It replaces the native select that rendered unreadable options in AMOLED.
- Skeletons cover route transitions, initial inbox/contact/thread/profile/settings loads, and device loading. Refreshes retain existing content. Requests have timeouts and actions show progress. Skeleton animations stop when reduced motion is preferred.

## Message delivery and notifications

Empty chats are private to the original starter and any member who explicitly starts that same chat. Migration 013 records explicit starts on memberships and preserves existing creators’ drafts. The shared conversation list hides automatic recipients until a message exists, so Inbox and Contacts follow the same rule. Text and file-only messages both reveal the chat once committed. Failed sends and uploads alone do not. Starting from either account still reuses the unique direct conversation. Foreground delivery refreshes the list after acknowledging new ciphertext, so a first incoming chat can appear without an existing real-time subscription or push permission.

Previously only an open conversation acknowledged a message. An authenticated background component now fetches up to 100 pending incoming encrypted envelopes and acknowledges them across all conversations. It runs on any page while Untold is visible, every five seconds and on focus/reconnect. It can drain several batches after a backlog. It does not decrypt messages or mark them read.

Delivery endpoints require authentication, enforce membership and incoming-message ownership, bound batches and request sizes, and rate limit requests. Receipt insertion is idempotent, uses the database clock, and preserves Read. Read still requires a visible decrypted message in a focused chat. Merely having internet with a closed or suspended app does not itself prove delivery.

Settings offers opt-in notifications per browser. The permission prompt requires a user action. On iPhone/iPad, install Untold to the Home Screen and open its icon first. Blocked and unsupported states include guidance. Alerts contain no sender names, message text, filenames, or thumbnails.

### Push implementation

- Migration `012-notifications.sql` adds subscriptions, persisted VAPID keys, a retry outbox, and accepted-delivery records. The private key is encrypted with the existing auth secret and generated once with an atomic insert. No additional environment variable or hosted service is required.
- A new message and outbox record commit together. Duplicate message sends do not enqueue another notification. Push runs after the response and through a production Node retry timer registered by `instrumentation.ts`.
- Workers claim small batches with row locks, skip locked rows, and lease them for five minutes. Network calls have a five-second timeout, with at most four concurrent calls per batch. Accepted endpoints are recorded to avoid resending on retries. Transient failures back off, with at most five attempts and one hour of retention. Alerts replace earlier alerts for the same conversation.
- Subscriptions are limited to twenty per account and reference a live auth session with cascade deletion. Sign-out, password reset, and session revocation remove their server subscriptions. A previously permitted browser resynchronizes after a new sign-in. Targets must still be members with a valid session. Already-read messages do not trigger a new attempt.
- Endpoints are restricted to HTTPS browser-vendor push hosts (Google, Apple, Mozilla, Windows). Credentials and custom ports are forbidden; P-256 points and auth keys are validated. Arbitrary URLs cannot turn the server into an internal-network request proxy. Writes require the configured browser origin, bounded JSON, and rate limits.
- `/sw.js` displays alerts, restricts click destinations to inbox/conversations, and makes a best-effort authenticated ciphertext fetch/Received acknowledgement. It never decrypts, marks Read, stores chat content, intercepts fetches, or maintains an offline cache. Delivery acknowledgements require the active account to match the payload account.
- Vendor-queued alerts may still arrive after sign-out. They remain generic and cannot fetch a signed-out account's messages. Turning notifications off removes the server subscription and unsubscribes the browser. OS/battery settings, private browsing, and vendor services can delay or block alerts. Vendor push acceptance is never treated as a Received receipt.

## QR codes and cropping

- Settings explicitly offers “Set up MFA with QR code”. Password confirmation, the QR/manual key, code verification, and recovery codes remain. A same-device authenticator link supports phones that cannot scan their own screen.
- Conversation Details offers QR safety verification. Your displayed code derives from this browser's local public keys. Scans must match the conversation, other account, device ID, and SHA-256 fingerprint of both expected keys. Removed/changed identities are rejected. A matching scan still requires explicit confirmation. This does not sign in a device or transfer private keys.
- Camera access starts only on Scan, asks for no microphone, and stops when closed, hidden, or unmounted. Permissions Policy allows only the same-origin camera and keeps microphone/geolocation disabled. Pasted QR contents and written-code comparison are fallbacks. Scanned strings are never followed as links, executed, or sent to a QR service.
- Profile photos support mouse/touch dragging, pinch/slider zoom, labeled positioning sliders, reset, and a circular crop preview. Crop photo can reopen the existing compressed picture. Existing validation, metadata stripping, size limits, and WebP compression remain. Re-cropping cannot recover detail from the original upload.

## Rollout and checks

### Long conversation layout follow-up

The conversation route is bounded to the visible viewport. Its message history and conversation list scroll independently; the composer stays outside the message scroller, above navigation. `VisualViewport` and `interactive-widget=resizes-content` handle mobile keyboard sizing, while viewport dimensions are adjusted for saved interface zoom. Normal browser pinch zoom stays enabled. The same shrinkable history area contains loading and error states. New incoming messages do not force the reader to the bottom while reading older messages; new outgoing messages and media/viewport changes follow the bottom when appropriate.

Static previews used 100 sample messages and 40 conversations at phone, tablet, desktop, landscape, extra-large text/120% zoom, and a simulated keyboard size. The composer fit within each viewport. This is a layout review, not physical iOS/Android keyboard or live chat verification.

Use `npm start` on the persistent Portways Node server so pending migrations run before traffic and the retry timer stays active. No Redis or extra service is needed. Vendor push endpoints need outbound HTTPS. Keep `BETTER_AUTH_SECRET` stable and backed up securely; changing it without supported key rotation affects existing MFA and VAPID keys.

No dev server, live migration, deployment, or external account action was performed. Local lint and webpack production compilation passed. Static previews with sample data were inspected for mobile Settings/Profile, cropping, the AMOLED menu, and extra-large text at 120% zoom. No tests or live multi-device flows were run. Before release, check PC-to-Android delivery with the chat closed, push on real Android/iOS devices, permission denial, logout/account switching, crop gestures, and QR match/mismatch handling on staging.

Sources: [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [WebKit's iOS push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [WebKit push visibility requirements](https://webkit.org/blog/12945/meet-web-push/).
