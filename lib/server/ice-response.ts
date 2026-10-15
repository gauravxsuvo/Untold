import "server-only";
import {
  getAuthenticatedUser,
  unauthorizedResponse,
  backendErrorResponse,
  forbiddenOriginResponse,
  trustedBrowserOrigin,
} from "./http";
import { callConfiguration, callTransportPolicy, RelayUnavailableError } from "./call-config";
import { accountDeviceDirectory } from "./device-trust";
import { consumeRateLimit, rateLimitedResponse } from "./rate-limit";
import { getDatabase } from "./database";

export async function iceResponse(request: Request, legacy = false) {
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "X-Untold-ICE-Policy": callTransportPolicy(),
  };
  try {
    const site = request.headers.get("sec-fetch-site");
    if (
      (site && site !== "same-origin" && site !== "none") ||
      (request.headers.has("origin") && !trustedBrowserOrigin(request))
    )
      return forbiddenOriginResponse();
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    const deviceId = new URL(request.url).searchParams.get("deviceId");
    if (
      !(await accountDeviceDirectory([user.id])).some(
        (device) => device.deviceId === deviceId && device.approved && !device.revoked,
      )
    )
      return Response.json(
        { message: "Approve this device in Settings before calling." },
        { status: 403, headers },
      );
    const limit = await consumeRateLimit(getDatabase().db, `call-config:${user.id}`, {
      max: 60,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    const config = await callConfiguration(user.id);
    if (!config.enabled)
      return Response.json(
        {
          code: "calls_unavailable",
          message: "Calls aren’t available yet. Please try again later.",
        },
        { status: 503, headers },
      );
    return Response.json(legacy ? config : config.iceServers, { headers });
  } catch (error) {
    if (error instanceof RelayUnavailableError)
      return Response.json(
        {
          code: "relay_unavailable",
          message:
            error.status === 429
              ? "Call connections are busy right now. Please try again later."
              : "The call connection service is unavailable. Please try again in a few minutes.",
        },
        {
          status: error.status,
          headers: { ...headers, "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    return backendErrorResponse(error);
  }
}
