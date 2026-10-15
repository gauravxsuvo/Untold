"use client";

import { useCallback, useEffect, useState } from "react";
import {
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
      setError(caught instanceof Error ? caught.message : "Registered devices could not be loaded.");
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
        `Revoke ${device.deviceName}? This signs out the other browsers and stops future key delivery to the device. It cannot erase messages or keys the device already downloaded.`,
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
      setFeedback(`${device.deviceName} was revoked. Other open conversations update within 30 seconds.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This device could not be removed.");
    } finally {
      setRevokingId("");
    }
  }

  return (
    <article className="account-device-management">
      <div>
        <p className="messaging-kicker">Encryption devices</p>
        <h2>Your registered browsers</h2>
        <p>
          Private keys stay in this browser profile. Losing it can make
          older messages unreadable. Removing a device stops future delivery; it cannot erase copies
          that device already received.
        </p>
      </div>
      {local.state === "loading" ? (
        <p role="status">Preparing this browser’s device keys…</p>
      ) : local.state === "error" ? (
        <p className="messaging-error" role="alert">{local.error}</p>
      ) : null}
      {error ? (
        <p className="messaging-error" role="alert">{error}</p>
      ) : isLoading ? (
        <p role="status">Loading registered devices…</p>
      ) : devices.length === 0 ? (
        <p>No devices are registered.</p>
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
                ) : <span className="account-device-list__current">{device.revokedAt ? "Revoked" : "Active"}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {feedback ? <p aria-live="polite">{feedback}</p> : null}
    </article>
  );
}
