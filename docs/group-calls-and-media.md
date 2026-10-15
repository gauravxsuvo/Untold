# Group calls, screen sharing and message limits

## Deploying

Include `scripts/migrations/017-group-calls.sql` after migration 016. Use the existing production `npm run build` and `npm start` commands on Portways; start applies migrations before serving the app. Do not change applied migration files. No new provider, service, package or public environment variable is required. Keep the existing server-only `TURN_API_URL` and `TURN_TOKEN` configuration, with the intended `TURN_RELAY_ONLY` policy.

Refresh or close/reopen Untold on every participant's device after deployment. Local compilation does not establish that a TURN relay is reachable from real devices. Use the connectivity checks in [private membership and calls](private-membership-and-calls.md).

## Group voice and video

- The voice/video buttons in a group start a call or join its existing call. Up to eight accounts can participate, with one approved device per account. A person already in a direct or group call cannot join another call on a different device.
- Current approved group members present when a room starts receive an invitation. Invitations ring for 75 seconds. A declined or missed invitation can be joined later using the group's call buttons while the room remains active. People added after the call began join the next call.
- Camera/microphone capture starts only after choosing Start or Join. Starting calls, answering direct calls, recording voice messages and pending microphone prompts coordinate to prevent overlapping capture requests. A delayed permission response after cancellation releases its media tracks.
- After reopening the app while its old group participation is still live, a Rejoin action creates fresh connections and asks for media permission as needed. It does not automatically reactivate capture. Leave dismisses the old participation.
- Each join also selects one browser-window instance. Rejoining from another window of the same approved device replaces the old instance; the older window stops its media on its next update and cannot overwrite the new pair descriptions or heartbeats.
- The call panel shows participants, connecting/failed states, microphone/camera controls, screen sharing and Leave call. Leaving removes only that person's connections; the remaining participants can continue. The room ends when everyone leaves, nobody answers the initial invitation, all heartbeats lapse, or the 55-minute credential safety limit is reached.
- Calls use a small full mesh with a separate encrypted WebRTC connection between each pair. Portways TURN relays media where necessary; the HTTP Cloudflare Tunnel handles signaling. No SFU or media recording server has been added. Large conferences need a different media architecture. Eight people can still be demanding for older phones even with bandwidth caps.
- Signed pair descriptions bind the room, fresh pair ID, conversation, both accounts and selected devices, call type, SDP and DTLS fingerprint. Both server and recipient verify signatures. Deterministic offer roles avoid simultaneous offers. Rejoining creates fresh pair IDs; old descriptions cannot be reused for a new pair.
- Account safety verification remains account-to-account. Each participant checks the verified account identities and approved devices before connecting, with periodic directory refreshes during a call. Current group membership, account approval, session, device approval and chosen device are checked on every room read/action. Removing a group member, revoking a device, removing account access or recovering an account removes their participation and setup descriptions. Other clients close the removed connections when their next room update arrives.
- Signaling is authenticated, bounded and rate limited, with short no-store HTTPS requests. The credential broker is fetched once when a person joins, then reused for their pair connections; it is not retried in a loop or fetched separately for each peer. Late unsigned ICE candidates are never appended to signed SDP.
- Notifications use existing opt-in Web Push. iPhone/iPad notifications require a Home Screen installation and notification permission. Web app suspension and background ringing limitations still apply. Keep Untold open.

Group names, membership, participation, timestamps, sharing/mute flags and transient connection descriptions are server-visible metadata. Call media is encrypted in transit between browsers. Completed/expired setup descriptions are cleared when a room is revisited, left, pruned or restarted. Copies of previously received media cannot be erased from another device. This custom identity/signaling implementation has not had an independent security review.

## Media targets and bandwidth

Previously camera capture requested 960 by 540 pixels without an explicit frame-rate or sender bitrate limit. Audio used browser defaults without an explicit speech bitrate budget.

| Source | Capture/sending target | Payload bitrate target |
| --- | --- | --- |
| Microphone | Mono, preferred 48 kHz capture, echo cancellation and noise suppression; prefer Opus where supported | Up to 96 kbit/s per peer |
| Camera | Up to 1280 by 720, 30 fps | Up to 1.2 Mbit/s outgoing video |
| Shared screen | Up to 1280 by 720, 60 fps, preserving the chosen surface's aspect ratio | Up to 2.5 Mbit/s outgoing video |

Direct calls use the full video budget for one peer. Group calls divide the outgoing video budget by the number of other joined participants and rebalance when membership changes. For example, with four people each outgoing camera connection targets at most 400 kbit/s. Audio has a separate per-peer budget. Total wire usage also includes encryption, packet overhead, retransmission, signaling and downloads; these values are not exact data-usage promises. Actual resolution, frame rate, codec and bitrate can be lower because of browser capabilities, source size, hardware, negotiated codecs, congestion and group size. A 60 fps screen source cannot be forced when the browser or selected source only supplies 30 fps.

Screen sharing replaces the outgoing camera video, so it does not add a second simultaneous video upload. The camera is paused while sharing. The microphone continues normally, and no tab/system audio is requested. The browser shows its own screen/window chooser on every start. Stop sharing, the browser's Stop control, leaving/hanging up, navigation, approval loss or cleanup stops capture and restores the camera's previous on/off state where the call continues. A browser that cannot replace the video source safely shows a retry message instead of silently running unrestricted capture.

Screen sharing depends on `getDisplayMedia` support and operating-system screen-recording permissions. Unsupported mobile browsers can watch a shared screen if they support the call's video codec, but cannot start a share. A native mobile capture capability is not added by installing the website. The chooser is invoked directly from a click, with resolution/frame-rate constraints applied after source selection, and no persistent screen permission is assumed.

## Message spam limits

The server applies these database-backed fixed windows to every authenticated message write, including attachments and group messages, before parsing or checking the larger encrypted envelope:

| Scope | Limit |
| --- | --- |
| One account across chats and devices | 8 requests per 5 seconds; 60 per minute |
| One account within one chat | 6 requests per 5 seconds; 30 per minute |
| One conversation across members | 180 requests per minute |

Counters are atomic PostgreSQL upserts shared by replicas and devices. Denied requests do not create messages or notifications. Existing client message IDs still prevent duplicate stored messages, and retries also count toward the request budget. The server returns HTTP 429 with a bounded wait time and `Retry-After`; the interface explains when to retry. No plaintext message inspection is needed. Normal browser clients cannot disable these limits; sufficiently many approved accounts can still coordinate abuse, so membership approval remains relevant.

## Checks still needed on real devices

The subsequent [call window and device controls](call-window-and-devices.md) follow-up adds fullscreen, draggable windows, floating windows and microphone/camera/output selection. Its live-device checks also apply.

Local TypeScript, lint and production compilation are separate from live behavior. No automated tests, live migration, live call or production deployment were performed during this implementation. Before treating this release as verified, check:

1. Three-to-eight person voice/video calls, inviting, declining, joining late, and leaving while the rest continue. Check a busy account and answering from two devices.
2. Chrome/Edge desktop, Safari desktop, iPhone and Android across separate Wi-Fi/mobile networks. Confirm relay candidates in relay-only mode and restore the chosen production policy.
3. Screen/window selection, chooser cancellation, native Stop, repeated start/stop, camera-off restoration, sharing while someone joins/leaves, ending while a picker/permission request is pending, and watching on a phone. Confirm no screen capture continues after leaving.
4. Actual encoded dimensions, frame rate and bitrate in `chrome://webrtc-internals`, including camera-to-screen-to-camera transitions and larger group budgets. Source/browser limits can prevent reaching the requested target.
5. Group removal, device revocation, membership rejection and identity recovery during a call. Removed participants must disappear and surviving peers must close their connections on the next update.
6. One participant losing connectivity while others continue; browser suspension, the 75-second initial invitation expiry, 60-second heartbeat expiry and 55-minute hard limit.
7. Message bursts in direct chats and groups, multiple tabs/devices, correct 429/wait copy, no duplicate storage or push alerts, and normal sending after the window resets.

The group media panel scrolls its tiles independently and retains call controls on small/short viewports. Real touch, keyboard, large-font and screen-reader checks remain part of device review.
