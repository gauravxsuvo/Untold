import "server-only";

import { BackendConfigurationError } from "@/lib/server/database";
import { getAuth } from "@/lib/auth/server";

export async function getAuthenticatedUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user ?? null;
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
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}
