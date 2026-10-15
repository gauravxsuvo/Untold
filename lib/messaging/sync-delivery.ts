"use client";

export async function syncDelivery(viewerId: string, signal: AbortSignal): Promise<number> {
  const response = await fetch("/api/delivery", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) return 0;
  const result = (await response.json()) as {
    viewerId?: string;
    messages?: { id: string; envelope: string }[];
  };
  if (signal.aborted || result.viewerId !== viewerId || !Array.isArray(result.messages)) return 0;
  // Ciphertext has reached this browser. Do not decrypt or mark it read here.
  const ids = result.messages
    .filter(
      (message) =>
        typeof message.id === "string" &&
        typeof message.envelope === "string" &&
        message.envelope.length > 0,
    )
    .map(({ id }) => id);
  if (!ids.length) return 0;
  const receipt = await fetch("/api/delivery", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewerId, messageIds: ids }),
  });
  if (!receipt.ok) return 0;
  // A first incoming message can reveal a chat we have not subscribed to yet.
  window.dispatchEvent(new Event("untold:conversations-changed"));
  return ids.length;
}
