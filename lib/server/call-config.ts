import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { CallConfiguration } from "@/lib/messaging/call-types";
import { turnCredentialTtlSeconds } from "@/lib/messaging/call-policy";
import { readBoundedStream } from "@/lib/messaging/bounded-stream";

export class RelayUnavailableError extends Error {
  constructor(
    public readonly status: 429 | 503,
    public readonly retryAfterSeconds: number,
  ) {
    super("Call connection service is unavailable.");
  }
}
export function callingEnabled() {
  return Boolean(
    (process.env.TURN_API_URL?.trim() && process.env.TURN_TOKEN?.trim()) ||
      (process.env.TURN_URLS?.trim() && process.env.TURN_SHARED_SECRET?.trim()),
  );
}
export function callTransportPolicy(): RTCIceTransportPolicy {
  return process.env.TURN_RELAY_ONLY?.trim().toLowerCase() === "true" ? "relay" : "all";
}
type CacheEntry = { expiresAt: number; servers: RTCIceServer[] };
type RelayState = {
  key: string;
  cache: Map<string, CacheEntry>;
  pending: Map<string, Promise<RTCIceServer[]>>;
  blockedUntil: number;
  blockedStatus: 429 | 503;
};
const globals = globalThis as typeof globalThis & { untoldRelayState?: RelayState };
function stateFor(url: string, token: string): RelayState {
  const key = createHash("sha256").update(url).update("\0").update(token).digest("hex");
  if (globals.untoldRelayState?.key !== key)
    globals.untoldRelayState = {
      key,
      cache: new Map(),
      pending: new Map(),
      blockedUntil: 0,
      blockedStatus: 503,
    };
  return globals.untoldRelayState;
}
function iceUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  const port = value.match(/:(\d{1,5})(?:\?|$)/)?.[1];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return false;
  return (
    /^(?:stun|stuns|turn|turns):(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?(?:\?transport=(?:tcp|udp))?$/i.test(
      value,
    ) && !/:53(?:\?|$)/.test(value)
  );
}
function iceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value) || !value.length || value.length > 16)
    throw new RelayUnavailableError(503, 180);
  const servers: RTCIceServer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new RelayUnavailableError(503, 180);
    const original: unknown[] = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    if (original.length > 16) throw new RelayUnavailableError(503, 180);
    const urls = original.filter(iceUrl);
    if (!urls.length) continue;
    const turn = urls.some((url) => /^turns?:/i.test(url));
    if (
      turn &&
      (typeof entry.username !== "string" ||
        !entry.username.length ||
        entry.username.length > 2048 ||
        typeof entry.credential !== "string" ||
        !entry.credential.length ||
        entry.credential.length > 2048)
    )
      throw new RelayUnavailableError(503, 180);
    servers.push({
      urls,
      ...(turn ? { username: entry.username, credential: entry.credential } : {}),
    });
  }
  if (!servers.some((server) => (server.urls as string[]).some((url) => /^turns?:/i.test(url))))
    throw new RelayUnavailableError(503, 180);
  return servers;
}
function retryAfter(response: Response, fallback: number) {
  const value = response.headers.get("retry-after");
  if (!value) return fallback;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(fallback, Math.min(3600, seconds)) : fallback;
}
async function managedIceServers(userId: string, endpoint: string, token: string) {
  const state = stateFor(endpoint, token);
  const cached = state.cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.servers;
  if (state.blockedUntil > Date.now())
    throw new RelayUnavailableError(
      state.blockedStatus,
      Math.max(1, Math.ceil((state.blockedUntil - Date.now()) / 1000)),
    );
  const waiting = state.pending.get(userId);
  if (waiting) return waiting;
  if (state.pending.size >= 16) throw new RelayUnavailableError(503, 10);
  const task = (async () => {
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      const url = new URL(endpoint);
      // An internal HTTP URL is supported. Only trusted server configuration
      // controls this destination. Client requests cannot supply or replace it.
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash)
        throw new RelayUnavailableError(503, 180);
      const startedAt = Date.now();
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ ttl: turnCredentialTtlSeconds }),
      });
      // Portways documents exactly 200 as success, including rejection of 201.
      if (response.status !== 200) {
        console.warn("Untold relay credential request was unavailable", {
          status: response.status,
        });
        void response.body?.cancel();
        throw new RelayUnavailableError(
          response.status === 429 ? 429 : 503,
          retryAfter(response, response.status === 429 ? 900 : 180),
        );
      }
      if (!response.body) throw new RelayUnavailableError(503, 180);
      bytes = await readBoundedStream(response.body, { maxBytes: 64 * 1024, timeoutMs: 10_000 });
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as {
        iceServers?: unknown;
      } | null;
      const servers = iceServers(body?.iceServers);
      // A malformed credential broker must not echo the long-term bearer token.
      if (
        servers.some((server) =>
          [server.username, server.credential, ...(server.urls as string[])].some(
            (value) => typeof value === "string" && value.includes(token),
          ),
        )
      )
        throw new RelayUnavailableError(503, 180);
      for (const [id, entry] of state.cache)
        if (entry.expiresAt <= Date.now()) state.cache.delete(id);
      while (state.cache.size >= 256) {
        const oldest = state.cache.keys().next().value;
        if (oldest === undefined) break;
        state.cache.delete(oldest);
      }
      state.cache.set(userId, { servers, expiresAt: startedAt + 60_000 });
      return servers;
    } catch (error) {
      const failure =
        error instanceof RelayUnavailableError ? error : new RelayUnavailableError(503, 180);
      state.blockedUntil = Math.max(
        state.blockedUntil,
        Date.now() + failure.retryAfterSeconds * 1000,
      );
      state.blockedStatus = failure.status;
      throw failure;
    } finally {
      bytes?.fill(0);
    }
  })();
  state.pending.set(userId, task);
  try {
    return await task;
  } finally {
    state.pending.delete(userId);
  }
}
export async function callConfiguration(userId: string): Promise<CallConfiguration> {
  const iceTransportPolicy = callTransportPolicy();
  if (!callingEnabled()) return { enabled: false, iceServers: [], iceTransportPolicy };
  const endpoint = process.env.TURN_API_URL?.trim();
  const token = process.env.TURN_TOKEN?.trim();
  if (endpoint && token)
    return {
      enabled: true,
      iceServers: await managedIceServers(userId, endpoint, token),
      iceTransportPolicy,
    };
  // Compatibility with a previously configured standard TURN REST relay.
  const secret = process.env.TURN_SHARED_SECRET?.trim();
  const urls =
    process.env.TURN_URLS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (!secret || !urls.length || !urls.every(iceUrl) || urls.some((url) => !/^turns?:/i.test(url)))
    throw new RelayUnavailableError(503, 180);
  const username = `${Math.floor(Date.now() / 1000) + turnCredentialTtlSeconds}:${createHmac("sha256", secret).update(userId).digest("hex").slice(0, 24)}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { enabled: true, iceServers: [{ urls, username, credential }], iceTransportPolicy };
}
