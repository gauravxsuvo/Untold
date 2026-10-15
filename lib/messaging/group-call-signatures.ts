import type { LocalDevice, PublicDevice } from "@/crypto/src/protocol";
import { isCallId } from "./call-signatures";
import type { GroupCallDescription } from "./group-call-types";
function payload(d: GroupCallDescription) {
  return new TextEncoder().encode(
    JSON.stringify({
      protocol: d.protocol,
      roomId: d.roomId,
      linkId: d.linkId,
      conversationId: d.conversationId,
      senderId: d.senderId,
      deviceId: d.deviceId,
      targetUserId: d.targetUserId,
      targetDeviceId: d.targetDeviceId,
      kind: d.kind,
      type: d.type,
      sdp: d.sdp,
    }),
  );
}
export function validGroupCallDescription(value: unknown): value is GroupCallDescription {
  if (!value || typeof value !== "object") return false;
  const d = value as GroupCallDescription;
  return (
    d.protocol === "untold-group-call-v1" &&
    isCallId(d.roomId) &&
    isCallId(d.linkId) &&
    isCallId(d.conversationId) &&
    isCallId(d.deviceId) &&
    isCallId(d.targetDeviceId) &&
    typeof d.senderId === "string" &&
    d.senderId.length > 0 &&
    d.senderId.length <= 256 &&
    typeof d.targetUserId === "string" &&
    d.targetUserId.length > 0 &&
    d.targetUserId.length <= 256 &&
    d.senderId !== d.targetUserId &&
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
export async function signGroupCallDescription(
  local: LocalDevice,
  fields: Omit<
    GroupCallDescription,
    "protocol" | "senderId" | "deviceId" | "signature" | "type" | "sdp"
  >,
  description: RTCSessionDescriptionInit,
) {
  const d: GroupCallDescription = {
    ...fields,
    protocol: "untold-group-call-v1",
    senderId: local.accountId,
    deviceId: local.deviceId,
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
  if (!validGroupCallDescription(d)) throw new Error("Call setup unavailable");
  return d;
}
export async function verifyGroupCallDescription(d: GroupCallDescription, device: PublicDevice) {
  if (
    !validGroupCallDescription(d) ||
    device.revoked ||
    !device.approved ||
    d.deviceId !== device.deviceId ||
    d.senderId !== device.userId
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
