# Call windows and devices

## Controls

Direct and group calls now share a movable, resizable, nonblocking call window. Drag its title bar, or focus the title and use the arrow keys. Shift moves farther; Home centers it. The toolbar also offers Center, Expand, Minimize and a floating-window button. The same controls follow the current theme and text preferences.

Each camera or shared-screen view has its own fullscreen button. It uses native fullscreen where available, Safari's video fullscreen when supported, or an expanded view within the current window. Escape exits an expanded view. Shared-screen previews are not mirrored.

On supported desktop browsers, the floating-window button uses Document Picture-in-Picture, which stays above other applications. A checked option enables the browser's automatic picture-in-picture action while a call is capturing media. Automatic entry still depends on browser support, settings, permission and eligibility. Allow automatic picture-in-picture for Untold if Chrome offers that permission. Other browsers open a separate popup from a click; this fallback is not guaranteed to stay above other apps. Move an external window using its operating-system title bar or frame.

Existing media elements move into the external window, preserving the streams and output routing. Closing that window returns the call to Untold. Ending the call or closing the main app closes the external window and releases capture. A popup cannot keep the call alive after the main app closes. Mobile operating systems may suspend a background web app; this does not add native background calling to iOS or Android.

## Audio and device choices

Live microphone audio now has a **96 kbit/s payload target per peer connection**, with mono preferred 48 kHz capture, echo cancellation, noise suppression and automatic gain control. Opus is preferred when available. This is a maximum sender budget, not a constant encoded rate or a guarantee that a negotiated codec uses 96 kbit/s. Silence and congestion can reduce usage. Camera and sharing budgets remain unchanged; see [group calls and media](group-calls-and-media.md).

Settings > Audio and video lets someone choose microphone, camera and output preferences for the next call. It does not activate the microphone or camera. During a call, open Audio and video devices in the call window to change sources. Device names may be hidden until capture permission is allowed. Refresh devices updates the list.

Input switching captures only the requested source and replaces its track on existing connections. Mute and camera-off settings are retained. A failed switch attempts to restore the original source; connections that cannot safely restore are closed. Hangup during a permission request releases late-arriving capture. Screen selection and input switching are coordinated; stop sharing before choosing a different camera.

Where browser APIs allow it, Speakers or headphones routes every remote call stream to the selected output. A native output picker is shown when supported. Other browsers use the operating system's sound settings. A disconnected selected output pauses call playback until another output is chosen, rather than intentionally redirecting it to speakers. A failed output switch attempts to restore the previous output and stays paused if restoration fails. Browser-controlled changes to the system-default output remain governed by the operating system.

Preferences and device IDs stay in memory for the current app session. They are not uploaded to Untold or stored as server account settings. Reloading resets these choices to the system defaults.

## Deployment and remaining device checks

This follow-up adds no dependencies, environment variables or database migrations. Existing group calls still require migration 017. Continue using Portways' normal production build and migration-on-start command. The same-origin Permissions-Policy now permits speaker selection, fullscreen and picture-in-picture alongside microphone, camera and screen capture. It does not bypass browser permission prompts.

TypeScript, lint and a local production build are compilation checks. No automated tests or live calls were run for this follow-up. Before a live rollout, check:

- Desktop Chrome/Edge and installed Chrome apps: title dragging, keyboard movement, resize, minimize/restore, fullscreen, manual floating, automatic entry permission, close/return and hangup from the external window.
- Safari desktop, iPhone and Android: accessible controls, fullscreen/fallback, phone rotation, large text, dark/AMOLED themes, and browser-specific popup/background limits.
- Two accounts and a group: switch microphones and cameras, switch while muted or camera-off, deny permission, unplug inputs, and hang up while a permission request is pending. Confirm every capture indicator stops after hangup.
- Choose headphones before playback, change outputs during a call, deny output permission, unplug the selected output, and confirm safe recovery. Check browsers without output-selection support.
- Watch and fullscreen a shared screen, start/stop sharing around device changes, cancel the screen picker, and confirm the previous camera/mute state returns.
- In `chrome://webrtc-internals`, inspect encoded audio bitrate and video dimensions/frame rate, including group size changes. Confirm existing relay behavior across separate networks.

Platform references: [Chrome Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture), [automatic conferencing picture-in-picture](https://developer.chrome.com/blog/automatic-picture-in-picture), and [W3C audio output selection](https://www.w3.org/TR/audio-output/).
