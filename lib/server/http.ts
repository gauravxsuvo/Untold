import "server-only";

import { BackendConfigurationError } from "@/lib/server/database";
import { getAuth } from "@/lib/auth/server";
import { readBoundedStream } from "@/lib/messaging/bounded-stream";

export async function getAuthenticatedUser(request: Request) {
  const session = await getAuthenticatedSession(request);
  return session?.user ?? null;
}

export async function getAuthenticatedSession(request: Request) {
  return getAuth().api.getSession({ headers: request.headers });
}

export function backendErrorResponse(error: unknown): Response {
  if (error instanceof BackendConfigurationError) {
    return Response.json(
      {
        code: "service_not_configured",
        message:
          error.service === "realtime"
            ? "The realtime service is not configured yet. Please try again later."
            : "The account service is not configured yet. Please try again later.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  console.error("Untold backend request failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return Response.json(
    { code: "service_unavailable", message: "The service could not complete this request." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { code: "unauthorized", message: "Sign in to continue." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export function trustedBrowserOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const requestOrigin = new URL(request.url).origin;
    const configuredOrigin = process.env.BETTER_AUTH_URL?.trim();
    const trustedOrigin = configuredOrigin
      ? new URL(configuredOrigin).origin
      : requestOrigin;

    return new URL(origin).origin === trustedOrigin;
  } catch {
    return false;
  }
}

export function forbiddenOriginResponse(): Response {
  return Response.json(
    { code: "forbidden_origin", message: "This request origin is not allowed." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
  if (!request.body) return { ok: false, status: 400 };
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = await readBoundedStream(request.body, { maxBytes, signal: request.signal, timeoutMs: 15_000 });
    return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch (error) {
    return { ok: false, status: error instanceof RangeError ? 413 : 400 };
  } finally {
    bytes?.fill(0);
  }
}
