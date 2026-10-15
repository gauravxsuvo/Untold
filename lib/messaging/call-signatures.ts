import type { LocalDevice, PublicDevice } from "@/crypto/src/protocol";
import type { CallDescription, CallKind } from "./call-types";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isCallId = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
function payload(description: CallDescription) {
  return new TextEncoder().encode(
    JSON.stringify({
      protocol: description.protocol,
      callId: description.callId,
      conversationId: description.conversationId,
      senderId: description.senderId,
      deviceId: description.deviceId,
      kind: description.kind,
      type: description.type,
      sdp: description.sdp,
    }),
  );
}
export function validCallDescription(value: unknown): value is CallDescription {
  if (!value || typeof value !== "object") return false;
  const d = value as CallDescription;
  return (
    d.protocol === "untold-call-v1" &&
    isCallId(d.callId) &&
    isCallId(d.conversationId) &&
    isCallId(d.deviceId) &&
    typeof d.senderId === "string" &&
    d.senderId.length > 0 &&
    d.senderId.length <= 256 &&
    (d.kind === "voice" || d.kind === "video") &&
    (d.type === "offer" || d.type === "answer") &&
    typeof d.sdp === "string" &&
    d.sdp.length < 48_000 &&
    d.sdp.startsWith("v=0") &&
    d.sdp.includes("a=fingerprint:sha-256 ") &&
    typeof d.signature === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(d.signature)
  );
}
export async function signCallDescription(
  local: LocalDevice,
  callId: string,
  conversationId: string,
  kind: CallKind,
  description: RTCSessionDescriptionInit,
): Promise<CallDescription> {
  const d: CallDescription = {
    protocol: "untold-call-v1",
    callId,
    conversationId,
    senderId: local.accountId,
    deviceId: local.deviceId,
    kind,
    type: description.type as "offer" | "answer",
    sdp: description.sdp ?? "",
    signature: "",
  };
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    local.signingPrivateKey,
    payload(d),
  );
  d.signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (!validCallDescription(d)) throw new Error("Call setup unavailable");
  return d;
}
export async function verifyCallDescription(d: CallDescription, device: PublicDevice) {
  if (
    !validCallDescription(d) ||
    device.revoked ||
    device.approved === false ||
    device.deviceId !== d.deviceId ||
    device.userId !== d.senderId
  )
    return false;
  try {
    const decode = (value: string) =>
      Uint8Array.from(
        atob(
          value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4),
        ),
        (c) => c.charCodeAt(0),
      );
    const key = await crypto.subtle.importKey(
      "spki",
      decode(device.signingKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      decode(d.signature),
      payload(d),
    );
  } catch {
    return false;
  }
}
