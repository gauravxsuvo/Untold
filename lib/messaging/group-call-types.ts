import type { CallKind } from "./call-types";
export type GroupCallDescription = {
  protocol: "untold-group-call-v1";
  roomId: string;
  linkId: string;
  conversationId: string;
  senderId: string;
  deviceId: string;
  targetUserId: string;
  targetDeviceId: string;
  kind: CallKind;
  type: "offer" | "answer";
  sdp: string;
  signature: string;
};
export type GroupCallParticipant = {
  userId: string;
  name: string;
  deviceId: string | null;
  instanceId: string | null;
  status: "invited" | "joined" | "left" | "declined";
  sharing: boolean;
  muted: boolean;
  cameraOff: boolean;
};
export type GroupCallLink = {
  id: string;
  lowerUserId: string;
  upperUserId: string;
  offer: GroupCallDescription | null;
  answer: GroupCallDescription | null;
};
export type GroupCallSnapshot = {
  id: string;
  conversationId: string;
  name: string;
  kind: CallKind;
  status: "active" | "ended";
  createdAt: string;
  ringUntil: string;
  expiresAt: string;
  participants: GroupCallParticipant[];
  links: GroupCallLink[];
};
