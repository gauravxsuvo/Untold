const maxDevicesPerConversation = 32;

export type E2eeEnvelopeHeader = {
  protocol: "untold-e2ee";
  version: 1;
  conversationId: string;
  messageId: string;
  senderId: string;
  senderDeviceId: string;
  wrappedKeys: { deviceId: string }[];
};

export function parseE2eeEnvelope(bytes: Uint8Array): E2eeEnvelopeHeader | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const envelope = value as Partial<E2eeEnvelopeHeader> & Record<string, unknown>;
  if (
    envelope.protocol !== "untold-e2ee" ||
    envelope.version !== 1 ||
    typeof envelope.conversationId !== "string" ||
    typeof envelope.messageId !== "string" ||
    typeof envelope.senderId !== "string" ||
    typeof envelope.senderDeviceId !== "string" ||
    typeof envelope.nonce !== "string" ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.signature !== "string" ||
    !Array.isArray(envelope.wrappedKeys) ||
    envelope.wrappedKeys.length < 1 ||
    envelope.wrappedKeys.length > maxDevicesPerConversation
  ) {
    return null;
  }
  if (
    envelope.wrappedKeys.some(
      (wrapped) =>
        !wrapped ||
        typeof wrapped !== "object" ||
        typeof (wrapped as { deviceId?: unknown }).deviceId !== "string" ||
        typeof (wrapped as { salt?: unknown }).salt !== "string" ||
        typeof (wrapped as { nonce?: unknown }).nonce !== "string" ||
        typeof (wrapped as { ciphertext?: unknown }).ciphertext !== "string",
    )
  ) {
    return null;
  }
  return envelope as E2eeEnvelopeHeader;
}
