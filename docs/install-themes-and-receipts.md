# Safari installation, themes, and message receipts

## Installation

The existing app manifest, standalone display mode, and Apple touch icon are reused.
The install button provides platform-specific instructions when a native install prompt is
unavailable. iPhone and iPad instructions include Safari’s Share menu, Add to Home Screen,
and Open as Web App when that switch is present. Mac Safari instructions use File or Share,
then Add to Dock, which needs macOS Sonoma or later.

Instructions can be dismissed with the close button, Escape, or a click outside. Installed
standalone windows hide the install button. No service worker caches account or message data.

Sources: [Apple’s iPhone guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/27/ios/27),
[Apple’s Mac guide](https://support.apple.com/en-ca/104996).

## Appearance

Light, Dark, and AMOLED share semantic color variables across public pages and the app.
AMOLED uses black page and panel backgrounds. A saved appearance cookie lets the server render
the selected theme immediately. Local storage synchronizes choices across tabs. Browser chrome
colors follow the selected appearance. The first visit follows the device’s light/dark setting.
There is no inline bootstrap script or weaker content security policy.

## Receipts

- Sent: the message API accepted the message.
- Received: a recipient browser fetched the message and acknowledged it. Being signed in alone
  does not imply receipt. Messages in unopened conversations are acknowledged when fetched.
- Read: the decrypted message bubble was visible in the focused conversation while the document
  was visible. Unverified or unreadable messages do not generate read receipts. For attachments,
  this means seeing the message bubble, not downloading or playing its contents.

Receipts are per account and message. For conversations with several recipients, all recipients
must acknowledge before Received or Read appears. Read receipts imply receipt. Client timestamps
are never accepted. Read timestamps cannot move backward or precede receipt timestamps.

The endpoint requires a signed-in conversation member and a trusted browser origin. Requests
are size-limited and rate-limited, with at most 100 incoming message IDs per batch. A user cannot
acknowledge their own outgoing messages or messages in another conversation. Notifications carry
no message text. Realtime updates use the existing subscriber-only channels, with polling as a
fallback. Client retries are idempotent and cannot downgrade a status. Settings explains that
contacts can see these statuses.

## Rollout and limits

Migration `009-message-receipts.sql` adds a table and is picked up automatically by the existing
`npm start` migration runner before Next.js starts. Apply pending migrations before running a
development server against an existing database. No historical read state is invented or backfilled.
Do not use a bare `next start` in production to bypass migrations.

No production deployment or database migration was performed as part of these source changes.
Lint and the production Webpack build are compilation checks, not an end-to-end verification
of two authenticated accounts or native Safari installation on Apple hardware.
