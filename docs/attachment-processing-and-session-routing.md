# Session routing and attachment processing

## Plan and result

1. Fix the home route: check the existing server session and redirect authenticated visits to `/app/inbox`. Previously `/` always returned the public landing page, even with a valid session. The sign-in pages already performed the correct session check. No authentication lifetime or cookie security is weakened.
2. Prepare each attachment on its sender's device, compress when useful, then encrypt. The server continues to receive only opaque authenticated ciphertext.
3. Authenticate received ciphertext before bounded decompression. Validate received bytes too, because a modified sender can bypass sender-side checks.
4. Bound decoding, memory, time, request concurrency, and stored bytes. Remove automatic image previews and close the attachment deletion/message publication race.
5. Check the implementation with unit tests, real Chromium codecs, lint, a production build, and an approved production-dependency advisory audit.

## Compression behavior

- The existing **20 MiB input/file limit** remains in effect before and after processing. A tiny compressed input cannot opt into an unlimited decoded size.
- Static JPEG, PNG, and WebP images of at least 128 KiB are eligible for WebP conversion at 84% quality, with a maximum output edge of 1920 pixels. Dimensions are checked before browser decoding: no more than 24 million pixels or 8192 pixels along either edge. Re-encoding also removes source metadata. Animation is preserved by retaining the original file.
- Supported MP4 and WebM clips up to two minutes are eligible for browser-native WebM/VP8/Opus recording, at up to 24 fps and 1280 by 720 pixels (orientation preserved). Audio tracks are retained. Processing is real time and can be cancelled. Long clips, unsupported encoders, low bitrate clips, failures, and background-tab interruptions retain the original file instead of uploading a truncated recording.
- Every resulting file of at least 1 KiB is eligible for a separate lossless gzip pass. Untold keeps the compressed result only if it saves at least 128 bytes and more than 3%. Already compressed videos, audio, documents, and archives may have little or no further compression available.
- Native `CompressionStream` support is feature detected. Browsers without it keep ordinary files unchanged; they need an updated browser to receive gzip-compressed attachments.
- Media conversion changes the filename extension to `.webp` or `.webm`. Lossless gzip is transparent: recipients download the original bytes with the original name. Compression is per file and never combines file data with session cookies or other secrets.
- Uncompressed attachment manifests remain version 1. Gzip manifests use version 2 with authenticated compression metadata and a decoded size. Old clients reject the unknown version instead of saving compressed bytes under a misleading extension. Deploy the updated client before using gzip attachments.

## Security boundaries

- Both sender and recipient reject executable/script/shortcut/macro document extensions and recognized PE, ELF, Mach-O, and shebang signatures. MIME headers alone are not trusted for supported media. These checks reduce risk; they are not antivirus or a proof that a file is harmless.
- Filename sanitation strips path separators, Windows alternate-stream characters, ASCII controls, bidi overrides and invisible direction characters; Windows reserved names and trailing dots are handled as well.
- Only explicitly requested raster, video, and audio previews are embedded. HTML, SVG, PDF, GIF, AVIF, unknown types, and animated image formats are downloaded as inert bytes instead of embedded. Complex image formats retain their original content for download. Previewable media must pass signature and dimension checks. Downloads use `application/octet-stream`, an explicit download filename, no referrer, and short-lived authorized object-storage URLs.
- Gzip expands only after AES-GCM authentication and exactly once, using streaming reads with an authenticated decoded length, a 20 MiB hard cap, a deadline, cancellation, and gzip integrity checking. Archives inside attachments are never extracted by the application.
- Upload requests require the existing authenticated user, conversation membership, allowed origin, and active owned encryption device. Ciphertext size is bounded even without `Content-Length`; a supplied length must exactly match the body. Transport `Content-Encoding` is rejected, and incomplete/slow bodies are cancelled. Uploads and storage requests have deadlines.
- Existing database-backed hourly upload limits remain. Additional guards allow at most two upload buffers per user and four per application process. An atomic PostgreSQL advisory lock protects a **1 GiB ciphertext storage quota per sender** across replicas. The per-process memory guard does not replace deployment-level connection limits.
- Attachment deletion and message insertion now lock the same attachment row in database transactions. The stored object is removed only after the unreferenced row is deleted. Duplicate message IDs with different ciphertext are rejected. Concurrent publication cannot lose its stored object through the former check-then-delete race.
- Unmounting cancels active preparation/uploads and wipes retained mutable plaintext/ciphertext buffers. Browser-created immutable Blobs remain subject to normal browser memory management.

End-to-end encryption prevents the application server from inspecting or antivirus-scanning plaintext. Malicious PDFs/archives or new executable formats cannot all be identified from signatures. A recipient's browser and operating system must still handle downloaded files safely. Arbitrary native decoder vulnerabilities and the existing prototype encryption protocol require independent security review; this change does not claim to eliminate all possible attacks.

Storage and PostgreSQL are separate systems. A storage deletion failure can leave an inaccessible encrypted orphan; the server logs the cleanup condition. A database commit error may mean the commit acknowledgement was lost: the upload preserves its object for reconciliation rather than deleting a potentially committed file. Operations should reconcile object-storage inventory against database references and expire abandoned, unlinked uploads under a documented retention policy. Never apply a blanket age-based lifecycle deletion rule to sent attachments.

## Deployment and checks

- Redeploy the code to apply the behavior to the hosted site. Migration `008-attachment-sender-index.sql` adds the sender index used for quota accounting; the existing start migration runner applies it. No message data rewrite is required.
- `npm test`: covers legacy/new attachment manifests, exact lossless restoration, decompression bombs, corrupted/truncated streams, malicious media headers, executable spoofing, filename tricks, stream deadlines, cancellation, upload lengths/encodings, and concurrency slots.
- `npm run test:attachments:browser`: an isolated temporary Chromium profile creates actual image/video fixtures and checks native compression, dimensions, audible audio retention, cancellation, and unsupported-encoder fallback. Set `BROWSER_PATH` if Chrome/Edge/Chromium is not in a standard location. No account, camera, microphone, application server, or database is used.
- `npx tsc --noEmit` and lint on the changed files check integration.
- The production Webpack build succeeds. The local default Turbopack build fails internally when its CSS worker process exits before connecting, including outside the restricted shell. The existing `npm run build:webpack` fallback builds the complete application.
- Approved `npm audit --omit=dev` reported **zero known production dependency vulnerabilities** on 2026-10-15. This is an advisory check, not an independent penetration test.
- The database/storage transaction changes have been reviewed and compiled; no concurrency test against a real PostgreSQL/object-storage deployment or live authenticated production session was performed.

Guidance consulted: [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [Compression Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API), and the installed Next.js authentication, redirect, and route-handler guides.
