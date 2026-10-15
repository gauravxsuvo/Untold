import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The browser downloads encrypted attachments straight from the object-storage server using a
// short-lived presigned URL, so that origin must be allowed in connect-src. It comes from the
// same S3_ENDPOINT the server signs URLs with, read at request time (not baked into the build).
function objectStorageOrigin(): string | null {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDevelopment = process.env.NODE_ENV === "development";
  const storageOrigin = objectStorageOrigin();
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // React's crop coordinates and viewer zoom are style attributes, never HTML.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // Decrypted video and audio attachments play from in-memory blob: URLs.
    "media-src 'self' blob:",
    "font-src 'self' data: blob:",
    // Ably realtime (primary endpoints on ably.net, fallbacks on ably-realtime.com), plus the
    // object-storage origin for encrypted attachment downloads.
    `connect-src 'self' blob:${storageOrigin ? ` ${storageOrigin}` : ""} https://*.ably.net wss://*.ably.net https://*.ably-realtime.com wss://*.ably-realtime.com https://*.ably.io wss://*.ably.io`,
    "object-src 'none'",
    "worker-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (!isDevelopment) {
    directives.push("upgrade-insecure-requests");
  }

  const contentSecurityPolicy = directives.join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|sw.js|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
