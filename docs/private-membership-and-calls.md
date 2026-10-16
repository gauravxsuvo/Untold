# Private membership, attachments, and calls

## Setup before deploying

1. Use Node.js 24.0 or newer. PDF.js is loaded only when opening a PDF.
2. Set `ADMIN_EMAIL` to the email of your existing Untold account. Set `ADMIN_USER_ID` too when possible to bind administration to one account ID.
3. Deploy migration `015-membership-and-calls.sql` with the application. `npm start` applies ordered migrations as usual. Existing accounts retain access. All later signups require approval, even if they already have a valid sign-in session.
4. Open Settings, then **Account requests**. The owner can approve requests, decline requests, remove existing members' access, or approve a declined account later. Lists have pagination. The owner cannot remove their own access.
5. For a fresh installation with a new owner account, first set `ADMIN_EMAIL`, sign up, and open the waiting page's Account details. Copy the account reference into `ADMIN_USER_ID`, then restart the service. A fresh signup never becomes an administrator just by matching an unverified email address. Existing approved owner accounts can use `ADMIN_EMAIL` alone.

Approval is checked on the server for messaging, files, profile photos, notifications, device management, real-time tokens, and call endpoints. The app also checks periodically and on focus to move a removed member to the waiting page. Removing access ends their calls and removes their push subscriptions. Copies they previously downloaded or decrypted cannot be erased from their devices.

Authentication remains available to pending accounts so they can sign in, check their request, recover their password under the existing MFA rules, or sign out. New requests are visible to the administrator even if the applicant never opens the inbox.

## Portways managed TURN

Untold is behind a Cloudflare Tunnel. Its call signaling uses short authenticated HTTPS requests with `no-store`; no long-running request, custom WebSocket server, or sticky process is required. Configure the public HTTPS address as `BETTER_AUTH_URL`. Preserve the usual Cloudflare forwarding headers and origin checks. Do not cache `/api/*`, `/access`, or authenticated app pages at the edge.

Portways has supplied a credential broker contract. Link/enable that feature and keep the two injected variables on the server:

```dotenv
TURN_API_URL=the-server-endpoint-injected-by-portways
TURN_TOKEN=the-secret-injected-by-portways
# Optional: true for a relay connectivity check or enforced relay-only privacy.
TURN_RELAY_ONLY=false
```

`GET /api/ice?deviceId=<current-approved-device>` checks the signed-in session, approved membership, approved device and a local request budget, then POSTs the configured endpoint with `Authorization: Bearer TURN_TOKEN` and `{"ttl":3600}`. Only an HTTP 200 containing validated ICE servers succeeds. The response is the `iceServers` array, with private/no-store headers. The browser receives temporary ICE usernames/credentials; it never receives the bearer token, broker URL, or an upstream error body. A compatibility `/api/calls/config` route retains the older response shape. There is no direct Cloudflare TURN credential API integration.

Credential requests occur only when a person starts or answers a call. They are not part of call polling. Successful credentials are cached per account in server memory for at most one minute and simultaneous requests for that account share one provider call. Memory and concurrent provider requests are bounded. There are no automatic provider retries. Provider 429 responses open a cooldown of at least 15 minutes; other failures, including 503, use at least three minutes. `Retry-After` can extend that to one hour. The cooldown is per server process, so replicas each maintain their own cache. Response bodies, processing time and URL formats are bounded, redirects are rejected, and upstream error bodies are discarded.

Calls currently end at 55 minutes so one-hour credentials remain valid through setup, caching and normal connection maintenance. Longer calls require a future credential-renewal and ICE renegotiation flow; replacing credentials alone is not treated as sufficient. The call panel shows the duration limit. Start a new call to continue.

Production uses normal ICE candidate selection, following Portways' guide. Direct connections can disclose a participant's network address to their contact; the call panel explains this. If the broker is temporarily unavailable or quota limited, the browser makes one attempt using `stun:stun.cloudflare.com:3478`, with a visible direct-connection notice. STUN cannot replace a relay on every network. Authentication failures, device/member approval failures, local rate limits, missing configuration and unknown server errors do not use this fallback. When `TURN_RELAY_ONLY=true`, direct connections and STUN fallback are both disabled; relay failure stops the call with a clear message.

For the deployment connectivity check, temporarily set `TURN_RELAY_ONLY=true`, make a call across different networks, and inspect `chrome://webrtc-internals` for a selected relay candidate pair. Restore false for Portways' suggested normal production mode, or deliberately retain true if hiding participants' network addresses from each other is required. The relay network must be reachable by browsers outside the HTTP Cloudflare Tunnel. Do not cache `/api/ice` at Cloudflare.

Previously configured `TURN_URLS`/`TURN_SHARED_SECRET` relays remain supported as a compatibility option, with one-hour temporary credentials. Portways' injected broker configuration takes priority. No `TURN_*` secret may have a `NEXT_PUBLIC_` or `VITE_` prefix. Without relay configuration, calls stay unavailable; account approval, messaging, recordings and attachment previews work independently.

### Connection setup troubleshooting

The Chrome-installed desktop app uses the same browser connection setup as the website. The earlier message "The call couldn’t connect to your network. Please try again." came from a client-side 15-second ICE gathering deadline, before the caller submitted the offer. That message alone did not establish whether the broker or relay was working. A pending or unreachable optional server could keep gathering open even after a usable candidate was available.

Setup now uses one bundled transport for audio and video. It sends the signed gathered SDP when gathering completes, or after a relay candidate is available and gathering has been quiet for 1.5 seconds (at least three seconds total). It otherwise waits at most 25 seconds and uses the candidates found so far. Normal mode can attempt direct candidates at that deadline. Relay-only mode still requires an actual relay candidate and never silently enables direct connections. No late candidates are appended to signed descriptions or sent unsigned, and the credential broker is not retried.

The browser console can report `Untold call setup` with a reason, candidate-type counts, ICE policy and numeric ICE error codes. These diagnostics intentionally omit addresses, server URLs, credentials, SDP, identities and browser error text. `relay-not-reached` means credentials/configuration were obtained but no relay allocation was gathered; direct connectivity may still succeed. `no-relay-candidate` means strict relay mode could not gather a relay route. A numeric error for one server is not, on its own, proof all servers failed.

If setup still fails after deploying the fix, capture only the `/api/ice` HTTP status, its safe error `code` if present, and the `Untold call setup` diagnostic. Do not share the ICE response body, Authorization headers, SDP, or full network exports. Ask Portways to confirm valid temporary credentials and publicly reachable UDP and TCP/TLS relay endpoints, including TLS on port 443 for restricted networks. The HTTP Cloudflare Tunnel does not carry WebRTC media. Use the relay-only connectivity check described above to establish that a real relay path works; restore the intended privacy policy afterwards.

## Call behavior and privacy

Group voice/video rooms, direct/group screen sharing and camera/screen bandwidth targets are documented in [group calls and media](group-calls-and-media.md). Include migration 017 after the group migration. The original `/api/calls` endpoint below remains the direct-call API; `/api/group-calls` handles group rooms.

- One voice or video call per account at a time. An incoming call can be answered on any approved device, and the first answer wins. Other devices stop ringing. Connection details for an established call are returned only to its selected devices.
- Device signatures cover the call ID, conversation ID, sender, device, media kind, description type, and complete SDP, including the DTLS fingerprint. Clients check the signature against a locally verified account and approved device before accepting a remote description. Calls require existing safety-code verification.
- Camera and microphone are requested only after choosing Call or Answer. Audio recording uses a separate explicit permission action. All media tracks stop when a call ends, on connection failure, device approval loss, navigation away, or cancellation after a delayed permission response.
- WebRTC encrypts media in transit. Untold stores transient signed connection descriptions for setup, never call recordings. The server sees call participants, timing, and signaling. This does not protect against compromised application code, devices, or dishonest origin delivery.
- Unanswered calls expire after 75 seconds. Active calls use both participants' heartbeats and expire when a participant disappears. Temporary connection interruptions have a reconnect window and then show a clear ended state. Expired descriptions are cleared when that call is revisited or either participant next performs a call action; minimal ended metadata remains.
- Incoming calls appear throughout the signed-in app. Enabled Web Push sends a private incoming-call alert with a short TTL. Open Untold to answer. Web apps do not provide native CallKit/Android phone integration, guaranteed background ringing, or guaranteed calls while suspended or the screen is locked. Keep the app open during calls.
- The microphone can be muted, the camera disabled, and the call panel minimized while using the rest of Untold. Speech captions are not generated.

## Attachments and voice recordings

- Photos open in a modal with zoom controls, PDFs in a page-by-page canvas viewer with page text where available, and audio/video with browser playback controls. Download remains available, including for unsupported formats or PDFs requiring an external reader.
- Files are downloaded as ciphertext and decrypted in memory. Existing encrypted upload, authentication, compression, decompression bounds, media inspection, filename restrictions, and size limits remain in use.
- PDF.js is dynamically loaded with a dedicated local worker. PDFs are rendered to canvas; the UI does not run document JavaScript or create interactive document links or forms. Render size, page count, image pixels, and operation time are bounded. Closing the viewer terminates its worker. Password-protected, complex, or unsupported PDFs have a download fallback.
- HTML, SVG, executable files, and Office documents are never embedded in the application as active content. Preview MIME types and media headers are checked after decryption. Downloading a file does not make it safe to execute in another application.
- Voice recordings use the browser's supported compressed audio format, a 48 kbit/s target, a five-minute duration cap, and bounded bytes. The browser may choose a different actual bitrate. Users can play back, discard, or send a recording. Recording stops when the app is hidden or a call arrives. Sending uses the same encrypted, compressed attachment path as other files.
- Profile crops show the original image with a movable square and resize handles. Pinching changes crop size. Keyboard arrows move the selection and plus/minus resize it. The circular guide previews the avatar. Only the selected 512-pixel crop is compressed and uploaded.

## Deployment checks still required

Compilation and linting do not prove live network behavior. Before enabling calls in production, check:

1. A new signup waits for approval and cannot bypass it by calling an API directly. Approve, decline, remove access, reapprove, and sign out.
2. Only the configured owner can see and use account review. Check fresh-owner bootstrap and an ordinary applicant using a similar email.
3. Open JPG/PNG, audio, video, a multipage PDF, a corrupt PDF, and a password-protected PDF on desktop, Android, and iPhone. Confirm closing releases playback/resources.
4. Record, stop, preview, discard, send, and retry voice messages on Safari and Chrome. Check permission denial and backgrounding during recording.
5. Make voice/video calls between separate Wi-Fi and mobile-data networks through the production tunnel. Temporarily use relay-only mode to confirm the selected candidate pair is relay, including TCP/TLS 443 on a restricted network. Check normal production mode, quota/service-failure fallback, strict-mode failures, and that authentication failures never mint relay credentials or trigger fallback. Confirm the bearer token is absent from browser requests/responses.
6. Check answer, decline, cancel during permission prompts, busy contacts, simultaneous calls, unanswered timeout, removal of device/account access, mute, camera toggle, minimize, reconnect failure, and hang-up from either side.
7. Check incoming Web Push on an installed iPhone app and Android, with notifications allowed. Confirm stale/expired alerts cannot answer an ended call.
8. Crop with touch, a mouse, corner handles, keyboard, portrait/landscape images, and large text settings.

No live database migration, relay provisioning, production deployment, or real-device call was performed as part of the implementation.
