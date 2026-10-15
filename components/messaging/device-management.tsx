"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Check,
  Copy,
  Laptop,
  QrCode as QrIcon,
  ShieldCheck,
  Smartphone,
  Tablet,
} from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { useMessagingDevice } from "@/components/messaging/messaging-device-provider";
import {
  approveLinkedDevice,
  recoverDeviceIdentity,
  revokeAccountDevice,
  userFacingError,
} from "@/lib/messaging/api-client";
import {
  createDeviceApproval,
  createDeviceRemoval,
  pinAccountRoot,
} from "@/crypto/src/account-trust";
import type { PublicDevice } from "@/crypto/src/protocol";
import { QrCode } from "@/components/ui/qr-code";
import { QrScanner } from "@/components/ui/qr-scanner";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { SecurityCodeField } from "@/components/auth/security-controls";

function DeviceIcon({ name }: { name: string }) {
  const Icon = /iPad|tablet/i.test(name)
    ? Tablet
    : /iPhone|Android/.test(name)
      ? Smartphone
      : Laptop;
  return <Icon aria-hidden="true" size={21} strokeWidth={1.8} />;
}
export function DeviceManagement({ accountId }: { accountId: string }) {
  const local = useMessagingDevice();
  const { session } = useAccountSession();
  const [selectedId, setSelectedId] = useState("");
  const [linkCode, setLinkCode] = useState("");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const linkingInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const directory = local.security?.devices ?? [];
  const current = directory.find((d) => d.deviceId === local.device?.deviceId);
  const selected = directory.find((d) => d.deviceId === selectedId && !d.revoked && !d.approved);
  const ownLink = local.link;
  const expired = !current?.linkExpiresAt || Date.parse(current.linkExpiresAt) <= Date.now();
  const displayedCode = ownLink?.secret.match(/.{1,8}/g)?.join("-") ?? "";
  useEffect(() => {
    if (!selectedId) return;
    const frame = requestAnimationFrame(() => linkingInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  function scan(value: string) {
    setError("");
    try {
      const data = JSON.parse(value) as Record<string, unknown>;
      if (
        data.type !== "untold-link-device" ||
        data.version !== 1 ||
        data.userId !== accountId ||
        typeof data.deviceId !== "string" ||
        typeof data.code !== "string" ||
        !/^[a-f0-9]{32}$/.test(data.code)
      )
        throw new Error();
      const target = directory.find(
        (d) => d.deviceId === data.deviceId && !d.revoked && !d.approved,
      );
      if (!target) throw new Error();
      setSelectedId(target.deviceId);
      setLinkCode(data.code);
      setFeedback("Code scanned. Confirm the device below to approve it.");
    } catch {
      setError(
        "This code isn’t for a device waiting on your account. Refresh the device list and try again.",
      );
    }
  }
  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!local.device || !selected || !local.approved || busy) return;
    setBusy("approve");
    setError("");
    setFeedback("");
    try {
      const { approval, sealed } = await createDeviceApproval(
        local.device,
        selected,
        directory,
        linkCode,
      );
      await approveLinkedDevice(approval, sealed);
      setFeedback(
        `${selected.deviceName} is approved. Its existing contact verifications will carry over.`,
      );
      setSelectedId("");
      setLinkCode("");
      await local.refresh();
    } catch (caught) {
      setError(
        userFacingError(
          caught,
          "This device couldn’t be approved. Check the code on the new device, refresh, and try again.",
        ),
      );
    } finally {
      setBusy("");
    }
  }
  async function remove(device: PublicDevice) {
    if (
      !local.device ||
      !local.approved ||
      busy ||
      !window.confirm(
        `Remove ${device.deviceName}? Your other sessions will be signed out. Messages already on the removed device will remain.`,
      )
    )
      return;
    setBusy(device.deviceId);
    setError("");
    setFeedback("");
    try {
      await revokeAccountDevice(
        device.deviceId,
        await createDeviceRemoval(local.device, device.deviceId),
      );
      await local.refresh();
      setFeedback(`${device.deviceName} was removed.`);
    } catch (caught) {
      setError(userFacingError(caught, "This device couldn’t be removed. Try again."));
    } finally {
      setBusy("");
    }
  }
  async function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || !local.device || busy) return;
    setBusy("recover");
    setError("");
    setFeedback("");
    try {
      const result = await recoverDeviceIdentity(
        local.device.deviceId,
        password,
        code,
        backup ? "backup" : "totp",
      );
      await pinAccountRoot(accountId, result.identity, true);
      await local.retry();
      setFeedback(
        "Messaging access was recovered. Compare the new account safety code with your contacts before messaging.",
      );
      setConfirmed(false);
      setCode("");
    } catch (caught) {
      setError(
        userFacingError(
          caught,
          "We couldn’t recover messaging access. Check your details and try again.",
        ),
      );
    } finally {
      setPassword("");
      setBusy("");
    }
  }
  return (
    <article className="account-device-management" id="your-devices">
      <div>
        <p className="messaging-kicker">Your devices</p>
        <h2>Where you use Untold</h2>
        <p>
          Approve a new phone or computer once from a device you already use. Your contacts won’t
          need to compare codes again. Removing a device stops future messages reaching it.
        </p>
      </div>
      {local.state === "loading" ? (
        <LoadingSkeleton label="Preparing your devices…" rows={2} />
      ) : null}
      {local.error ? (
        <p className="messaging-error" role="alert">
          {local.error}
        </p>
      ) : null}
      {!local.approved &&
      local.state !== "loading" &&
      local.device &&
      ownLink &&
      current &&
      !current.revoked ? (
        <div className="device-link-card security-stack">
          <div className="device-link-heading">
            <QrIcon aria-hidden="true" size={23} />
            <div>
              <h3>Approve this device</h3>
              <p>
                On an approved device, open Settings, find this device, and scan this QR code or
                enter the linking code.
              </p>
            </div>
          </div>
          {!expired ? (
            <>
              <QrCode
                label="Scan from an approved device to link this device"
                value={JSON.stringify({
                  type: "untold-link-device",
                  version: 1,
                  userId: accountId,
                  deviceId: local.device.deviceId,
                  code: ownLink.secret,
                })}
              />
              <label htmlFor={`${id}-own-code`}>One-time linking code</label>
              <output className="device-link-code device-link-code--display" id={`${id}-own-code`}>
                {displayedCode}
              </output>
              <button
                className="security-button security-button--secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(displayedCode)
                    .then(() => {
                      setCopied(true);
                    })
                    .catch(() => {
                      setFeedback("Select and copy the linking code above.");
                    })
                }
                type="button"
              >
                {copied ? (
                  <Check aria-hidden="true" size={16} />
                ) : (
                  <Copy aria-hidden="true" size={16} />
                )}
                {copied ? "Copied" : "Copy linking code"}
              </button>
              <p className="auth-field__hint">
                Keep this code private. It expires after 15 minutes. This page updates automatically
                after approval.
              </p>
            </>
          ) : (
            <>
              <p>This linking request expired. Renew it when your other device is ready.</p>
              <button
                className="security-button security-button--secondary"
                onClick={() => void local.retry()}
                type="button"
              >
                Renew linking request
              </button>
            </>
          )}
          <p className="auth-field__hint">
            Approval carries over verified contacts for new messages. Older messages stay on the
            devices that originally received them.
          </p>
        </div>
      ) : null}
      {local.approved &&
      directory.some(
        (d) =>
          !d.revoked && !d.approved && d.linkExpiresAt && Date.parse(d.linkExpiresAt) > Date.now(),
      ) ? (
        <QrScanner label="Scan your new device’s QR code" onScan={scan} />
      ) : null}
      <ul className="account-device-list">
        {directory.map((device) => {
          const isCurrent = device.deviceId === local.device?.deviceId;
          const name = device.deviceName === "This browser" ? "Earlier device" : device.deviceName;
          const status = device.revoked
            ? "Removed"
            : isCurrent && local.approved
              ? "This device · Approved"
              : isCurrent
                ? "This device · Needs approval"
                : device.approved
                  ? "Approved"
                  : "Needs approval";
          return (
            <li key={device.deviceId}>
              <span className="device-list-identity">
                <DeviceIcon name={name} />
                <span>
                  <strong>{name}</strong>
                  <small>{status}</small>
                </span>
              </span>
              {local.approved && !device.revoked && !isCurrent ? (
                <div className="device-list-actions">
                  {!device.approved &&
                  device.linkExpiresAt &&
                  Date.parse(device.linkExpiresAt) > Date.now() ? (
                    <button
                      className="device-list-approve"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setSelectedId(device.deviceId);
                        setLinkCode("");
                        setError("");
                        setFeedback("");
                      }}
                      type="button"
                    >
                      Approve
                    </button>
                  ) : null}
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => void remove(device)}
                    type="button"
                  >
                    {busy === device.deviceId ? "Removing…" : "Remove"}
                  </button>
                </div>
              ) : device.approved && !device.revoked ? (
                <ShieldCheck aria-label="Approved device" size={19} />
              ) : null}
            </li>
          );
        })}
      </ul>
      {selected && local.approved ? (
        <form className="security-form device-link-card" onSubmit={approve}>
          <h3>Approve {selected.deviceName}</h3>
          <p>
            Only approve a device you’re setting up yourself. Enter its linking code or scan its QR
            code above.
          </p>
          <div className="auth-field">
            <label htmlFor={`${id}-link`}>Linking code from your new device</label>
            <input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              className="device-link-code"
              id={`${id}-link`}
              maxLength={40}
              onChange={(event) => setLinkCode(event.target.value)}
              ref={linkingInput}
              required
              spellCheck={false}
              value={linkCode}
            />
          </div>
          <div className="security-actions">
            <button
              className="security-button"
              disabled={
                Boolean(busy) ||
                !/^[a-f0-9]{32}$/.test(linkCode.replace(/[\s-]/g, "").toLowerCase())
              }
              type="submit"
            >
              {busy === "approve" ? "Approving…" : "Approve this device"}
            </button>
            <button
              className="security-button security-button--secondary"
              disabled={Boolean(busy)}
              onClick={() => {
                setSelectedId("");
                setLinkCode("");
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="messaging-error" role="alert">
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p className="auth-field__hint" role="status">
          {feedback}
        </p>
      ) : null}
      {!local.approved && local.device && current && !current.revoked ? (
        <details className="device-recovery">
          <summary>Can’t use an old device?</summary>
          <form className="security-form" onSubmit={recover}>
            <h3>Recover messaging access</h3>
            <p>
              This changes your account safety code, removes your other devices, and signs out other
              sessions. You and your contacts will need to compare codes again. It does not recover
              old messages.
            </p>
            <div className="auth-field">
              <label htmlFor={`${id}-password`}>Your password</label>
              <input
                autoComplete="current-password"
                id={`${id}-password`}
                maxLength={128}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </div>
            {session?.twoFactorEnabled ? (
              <>
                <SecurityCodeField backup={backup} code={code} onChange={setCode} />
                <button
                  className="security-text-button"
                  onClick={() => {
                    setBackup(!backup);
                    setCode("");
                  }}
                  type="button"
                >
                  {backup ? "Use authenticator code" : "Use a saved recovery code"}
                </button>
              </>
            ) : null}
            <label className="security-checkbox">
              <input
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                I can’t use an approved device and understand that my account safety code will
                change.
              </span>
            </label>
            <button
              className="security-button"
              disabled={Boolean(busy) || !confirmed || !password}
              type="submit"
            >
              {busy === "recover" ? "Recovering…" : "Recover on this device"}
            </button>
          </form>
        </details>
      ) : null}
      <button
        className="security-text-button"
        disabled={Boolean(busy) || local.state === "loading"}
        onClick={() => void local.retry()}
        type="button"
      >
        Refresh devices
      </button>
    </article>
  );
}
