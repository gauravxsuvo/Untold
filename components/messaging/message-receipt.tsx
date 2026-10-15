import { Check, CheckCheck } from "lucide-react";

export function MessageReceipt({
  receivedAt,
  readAt,
}: {
  receivedAt?: string | null;
  readAt?: string | null;
}) {
  const status = readAt ? "Read" : receivedAt ? "Received" : "Sent";
  const ReceiptIcon = receivedAt || readAt ? CheckCheck : Check;
  const timestamp = readAt ?? receivedAt;
  const description = timestamp ? `${status} · ${new Date(timestamp).toLocaleString()}` : "Sent";
  return (
    <span
      className={`message-receipt${readAt ? " message-receipt--read" : ""}`}
      title={description}
    >
      <ReceiptIcon aria-hidden="true" size={15} strokeWidth={1.8} />
      <span>{status}</span>
    </span>
  );
}
