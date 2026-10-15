export const turnCredentialTtlSeconds = 3600;
// Leave room for cached credentials, permission prompts, and ICE gathering.
export const maxCallDurationMs = 55 * 60 * 1000;
export const fallbackIceServers: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
