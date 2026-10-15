"use client";
import { useEffect, useId, useState } from "react";
import { Check, Copy, QrCode as QrIcon, ShieldCheck } from "lucide-react";
import { QrCode } from "@/components/ui/qr-code";
import { QrScanner } from "@/components/ui/qr-scanner";
import { useMessagingDevice } from "@/components/messaging/messaging-device-provider";
import { accountPairCode, validAccountIdentity } from "@/crypto/src/account-trust";
import type { DeviceTrust, LocalDevice, PublicDevice } from "@/crypto/src/protocol";
import { userFacingError } from "@/lib/messaging/api-client";

export function SafetyQr({
  localDevice,
  devices,
  onVerify,
}: {
  conversationId: string;
  localDevice: LocalDevice;
  devices: DeviceTrust[];
  onVerify: (device: PublicDevice) => Promise<void>;
}) {
  const local = useMessagingDevice();
  const own = devices.find((d) => d.userId === localDevice.accountId)?.accountIdentity;
  const peer = devices.find((d) => d.userId !== localDevice.accountId);
  const identity = peer?.accountIdentity;
  const [fingerprint, setFingerprint] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [matched, setMatched] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const pasteId = useId();
  const verified = devices.some(
    (d) => d.userId === identity?.userId && !d.revoked && d.approved && d.trust === "verified",
  );
  const changed = devices.some(
    (d) => d.userId === identity?.userId && !d.revoked && d.trust === "changed",
  );
  const rootKey = JSON.stringify([own, identity]);
  useEffect(() => {
    let cancelled = false;
    setFingerprint("");
    setMatched(false);
    setFeedback("");
    setCopied(false);
    const [ownRoot, peerRoot] = JSON.parse(rootKey) as unknown[];
    if (validAccountIdentity(ownRoot) && validAccountIdentity(peerRoot))
      void accountPairCode(ownRoot, peerRoot)
        .then((value) => {
          if (!cancelled) setFingerprint(value);
        })
        .catch(() => {
          if (!cancelled)
            setFeedback("We couldn’t prepare your safety code. Refresh and try again.");
        });
    return () => {
      cancelled = true;
    };
  }, [rootKey]);
  const accounts = own && identity ? [own.userId, identity.userId].sort() : [];
  async function confirm() {
    if (!peer || !fingerprint || !local.approved || busy) return;
    if (
      changed &&
      !window.confirm(
        "This account’s safety code changed. Only continue after comparing the new code with your contact by phone or in person.",
      )
    )
      return;
    setBusy(true);
    setFeedback("");
    try {
      await onVerify(peer);
      setFeedback("Contact verified. This carries over to your approved devices.");
      setMatched(false);
    } catch (caught) {
      setFeedback(
        userFacingError(
          caught,
          "We couldn’t verify this contact. Refresh and compare the current code.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  function scan(value: string) {
    setMatched(false);
    try {
      const data = JSON.parse(value) as Record<string, unknown>;
      if (
        data.type !== "untold-account-safety" ||
        data.version !== 2 ||
        data.code !== fingerprint ||
        JSON.stringify(data.accounts) !== JSON.stringify(accounts)
      )
        throw new Error();
      setMatched(true);
      setFeedback(
        "The code matches. Confirm only if you scanned it from your contact’s device or received it through a way you trust.",
      );
    } catch {
      setFeedback(
        "This code doesn’t match these accounts. Ask your contact to update Untold and open the safety code in your conversation.",
      );
    }
  }
  if (!local.approved)
    return (
      <p className="auth-field__hint">
        Approve this device in Settings first. Your existing contact verifications will then carry
        over.
      </p>
    );
  if (!identity || !own)
    return (
      <p className="auth-field__hint">
        Ask your contact to open Untold so their account safety code is available.
      </p>
    );
  return (
    <section className="account-safety security-stack" aria-label="Account safety code">
      <div className="account-safety__status">
        <ShieldCheck aria-hidden="true" size={19} />
        <strong>
          {changed
            ? "Account safety code changed"
            : verified
              ? "Contact verified"
              : "Verify this contact once"}
        </strong>
      </div>
      <p>
        {changed
          ? "Your contact recovered or reset their messaging identity. Compare the new code before sharing again."
          : "You and your contact see the same code. Compare it by phone, in person, or by scanning their QR code. Adding an approved device won’t change it."}
      </p>
      <code className="account-safety__code">{fingerprint || "Preparing safety code…"}</code>
      <div className="security-actions">
        <button
          className="security-button security-button--secondary"
          disabled={!fingerprint}
          onClick={() =>
            void navigator.clipboard
              .writeText(fingerprint)
              .then(() => {
                setCopied(true);
              })
              .catch(() => {
                setFeedback("Select and copy the code above.");
              })
          }
          type="button"
        >
          {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
          {copied ? "Copied" : "Copy code"}
        </button>
        <button
          className="security-button security-button--secondary"
          disabled={!fingerprint}
          onClick={() => setShowQr(!showQr)}
          type="button"
        >
          <QrIcon aria-hidden="true" size={16} />
          {showQr ? "Hide QR code" : "Show QR code"}
        </button>
      </div>
      {showQr && fingerprint ? (
        <>
          <QrCode
            value={JSON.stringify({
              type: "untold-account-safety",
              version: 2,
              accounts,
              code: fingerprint,
            })}
            label="Shared account safety code for you and your contact"
          />
          <QrScanner label="Scan your contact’s safety code" onScan={scan} />
          <details className="security-stack">
            <summary>Paste QR contents instead</summary>
            <div className="auth-field">
              <label htmlFor={pasteId}>Safety QR contents</label>
              <textarea
                id={pasteId}
                maxLength={4096}
                onChange={(event) => setPasted(event.target.value)}
                value={pasted}
              />
              <button
                className="security-text-button"
                disabled={!pasted.trim()}
                onClick={() => scan(pasted.trim())}
                type="button"
              >
                Check code
              </button>
            </div>
          </details>
        </>
      ) : null}
      {(!verified || changed || matched) && fingerprint ? (
        <button
          className="security-button"
          disabled={busy}
          onClick={() => void confirm()}
          type="button"
        >
          {busy
            ? "Verifying…"
            : matched
              ? "Confirm matching code"
              : changed
                ? "I compared the new code"
                : "I compared this code"}
        </button>
      ) : null}
      {feedback ? (
        <p className="auth-field__hint" role="status">
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
