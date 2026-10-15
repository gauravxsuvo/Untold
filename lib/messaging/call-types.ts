export type CallKind = "voice" | "video";
export type CallDescription = {
  protocol: "untold-call-v1";
  callId: string;
  conversationId: string;
  senderId: string;
  deviceId: string;
  kind: CallKind;
  type: "offer" | "answer";
  sdp: string;
  signature: string;
};
export type CallSnapshot = {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  callerDeviceId: string;
  calleeDeviceId: string | null;
  kind: CallKind;
  status: "ringing" | "active" | "ended";
  offer: CallDescription | null;
  answer: CallDescription | null;
  createdAt: string;
  expiresAt: string;
  peerName: string;
};
export type CallConfiguration = {
  enabled: boolean;
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
};
