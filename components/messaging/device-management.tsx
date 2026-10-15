"use client";

import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

import { useCallback, useEffect, useState } from "react";
import {
  userFacingError,
  fetchAccountDevices,
  revokeAccountDevice,
  type AccountDevice,
} from "@/lib/messaging/api-client";
import { useLocalMessagingDevice } from "@/components/messaging/use-messaging";

export function DeviceManagement({ accountId }: { accountId: string }) {
  const local = useLocalMessagingDevice(accountId);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [revokingId, setRevokingId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!accountId || local.state === "loading") return;
    setIsLoading(true);
    try {
      setDevices(await fetchAccountDevices());
      setError("");
    } catch (caught) {
      setError(userFacingError(caught, "Your devices couldn’t be loaded. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }, [accountId, local.state]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function revoke(device: AccountDevice) {
    if (
      !window.confirm(
        `Remove ${device.deviceName}? This also signs out your other browsers. The removed device won’t receive new messages, but copies it already received will remain.`,
      )
    ) {
      return;
    }
    setRevokingId(device.deviceId);
    setFeedback("");
    try {
      await revokeAccountDevice(device.deviceId);
      setDevices((current) => current.map((item) =>
        item.deviceId === device.deviceId ? { ...item, revokedAt: new Date().toISOString() } : item,
      ));
      setFeedback(`${device.deviceName} was removed. Your conversations will update shortly.`);
    } catch (caught) {
      setError(userFacingError(caught, "This device could not be removed."));
    } finally {
      setRevokingId("");
    }
  }

  return (
    <article className="account-device-management">
      <div>
        <p className="messaging-kicker">Your devices</p>
        <h2>Where you use Untold</h2>
        <p>
          Clearing your browser data or losing a device can make older messages unreadable.
          Removing a device stops new messages from reaching it. Copies it already received will remain.
        </p>
      </div>
      {local.state === "loading" ? (
        <p role="status">Getting this browser ready…</p>
      ) : local.state === "error" ? (
        <p className="messaging-error" role="alert">{local.error}</p>
      ) : null}
      {error ? (
        <p className="messaging-error" role="alert">{error}</p>
      ) : isLoading && devices.length === 0 ? (
        <LoadingSkeleton label="Loading your devices…" rows={2} />
      ) : devices.length === 0 ? (
        <p>Your devices will appear here once they’re ready.</p>
      ) : (
        <ul className="account-device-list">
          {devices.map((device) => {
            const isCurrent = device.deviceId === local.device?.deviceId;
            return (
              <li key={device.deviceId}>
                <span>
                  <strong>{device.deviceName}{isCurrent ? " · This browser" : ""}{device.revokedAt ? " · Removed" : ""}</strong>
                  <time dateTime={device.createdAt}>
                    Added {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(device.createdAt))}
                  </time>
                </span>
                {!isCurrent && !device.revokedAt ? (
                  <button
                    disabled={revokingId === device.deviceId}
                    onClick={() => void revoke(device)}
                    type="button"
                  >
                    {revokingId === device.deviceId ? "Removing…" : "Remove device"}
                  </button>
                ) : <span className="account-device-list__current">{device.revokedAt ? "Removed" : "Active"}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {feedback ? <p aria-live="polite">{feedback}</p> : null}
    </article>
  );
}
