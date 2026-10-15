"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, QrCode as QrIcon, X } from "lucide-react";
import { QrCode } from "@/components/ui/qr-code";
import {
  deviceFingerprint,
  type DeviceTrust,
  type LocalDevice,
  type PublicDevice,
} from "@/crypto/src/protocol";

type Check = { deviceId: string; fingerprint: string };
export function SafetyQr({
  conversationId,
  localDevice,
  devices,
  onVerify,
}: {
  conversationId: string;
  localDevice: LocalDevice;
  devices: DeviceTrust[];
  onVerify: (device: PublicDevice) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [ownCode, setOwnCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [pasted, setPasted] = useState("");
  const [match, setMatch] = useState<Check | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const scanResult = useRef<(value: string) => Promise<void>>(async () => {});
  const id = useId();
  useEffect(() => {
    let cancelled = false;
    setOwnCode("");
    setMatch(null);
    void deviceFingerprint({
      userId: localDevice.accountId,
      userName: "",
      deviceName: "",
      revoked: false,
      ...localDevice,
    })
      .then((fingerprint) => {
        if (!cancelled)
          setOwnCode(
            JSON.stringify({
              type: "untold-safety",
              version: 1,
              conversationId,
              userId: localDevice.accountId,
              deviceId: localDevice.deviceId,
              fingerprint,
            }),
          );
      })
      .catch(() => {
        if (!cancelled) setFeedback("We couldn’t prepare your safety code. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, localDevice]);

  async function check(value: string) {
    setMatch(null);
    setFeedback("");
    try {
      if (value.length > 2048) throw new Error("Invalid code");
      const payload: unknown = JSON.parse(value);
      if (!payload || typeof payload !== "object") throw new Error("Invalid code");
      const data = payload as Record<string, unknown>;
      if (
        data.type !== "untold-safety" ||
        data.version !== 1 ||
        data.conversationId !== conversationId ||
        data.userId === localDevice.accountId ||
        typeof data.deviceId !== "string" ||
        typeof data.fingerprint !== "string"
      )
        throw new Error("Invalid code");
      const device = devicesRef.current.find(
        (item) => item.userId === data.userId && item.deviceId === data.deviceId && !item.revoked,
      );
      if (
        !device ||
        device.trust === "changed" ||
        (await deviceFingerprint(device)) !== data.fingerprint
      )
        throw new Error("Invalid code");
      setMatch({ deviceId: device.deviceId, fingerprint: data.fingerprint });
      setFeedback(
        `This code matches ${device.userName}’s ${device.deviceName}. Confirm only if you scanned it from their device or received it through a way you trust.`,
      );
    } catch {
      setFeedback(
        "This QR code doesn’t match a current device in this conversation. Compare the written safety code with your contact before continuing.",
      );
    }
  }
  scanResult.current = check;
  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let controls: { stop: () => void } | undefined;
    let stream: MediaStream | undefined;
    const element = video.current;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (stopped || !element) return;
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 720 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        controls = await new BrowserQRCodeReader().decodeFromStream(
          stream,
          element,
          (result, _error, scanner) => {
            if (!result || stopped) return;
            stopped = true;
            scanner.stop();
            stream?.getTracks().forEach((track) => {
              track.stop();
            });
            setScanning(false);
            void scanResult.current(result.getText());
          },
        );
        if (stopped) controls.stop();
      } catch {
        if (!stopped) {
          setScanning(false);
          setFeedback(
            "Camera access isn’t available. Allow it in your browser settings, or compare the written safety codes instead.",
          );
        }
      }
    })();
    const hide = () => {
      if (document.visibilityState !== "visible") setScanning(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      stopped = true;
      controls?.stop();
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      if (element) element.srcObject = null;
      document.removeEventListener("visibilitychange", hide);
    };
  }, [scanning]);

  async function confirm() {
    if (!match) return;
    setBusy(true);
    try {
      const device = devicesRef.current.find(
        ({ deviceId, revoked, trust }) =>
          deviceId === match.deviceId && !revoked && trust !== "changed",
      );
      if (!device || (await deviceFingerprint(device)) !== match.fingerprint) {
        setMatch(null);
        setFeedback("This device changed. Refresh and compare its safety code again.");
        return;
      }
      await onVerify(device);
      setMatch(null);
      setFeedback("Safety code verified on this browser.");
    } catch {
      setFeedback("We couldn’t verify this device. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="safety-qr">
      <button
        className="security-button security-button--secondary"
        onClick={() => {
          setOpen(!open);
          setScanning(false);
        }}
        type="button"
      >
        <QrIcon aria-hidden="true" size={16} />
        {open ? "Hide QR verification" : "Verify with QR code"}
      </button>
      {open ? (
        <div className="security-stack">
          <h3>Your code for this browser</h3>
          <p>
            Let your contact scan this from their Untold conversation with you. This only checks
            this browser’s identity. Compare other devices separately.
          </p>
          {ownCode ? (
            <QrCode value={ownCode} label="Your device safety code for this conversation" />
          ) : (
            <p role="status">Preparing QR code…</p>
          )}
          <button
            className="security-button security-button--secondary"
            onClick={() => {
              setFeedback("");
              setMatch(null);
              setScanning(!scanning);
            }}
            type="button"
          >
            {scanning ? (
              <X aria-hidden="true" size={16} />
            ) : (
              <Camera aria-hidden="true" size={16} />
            )}
            {scanning ? "Stop camera" : "Scan your contact’s code"}
          </button>
          {scanning ? (
            <video
              aria-label="Safety code scanner"
              autoPlay
              className="safety-qr__camera"
              muted
              playsInline
              ref={video}
            />
          ) : null}
          <details>
            <summary>Paste QR contents instead</summary>
            <div className="auth-field">
              <label htmlFor={id}>Safety QR contents</label>
              <textarea
                id={id}
                maxLength={2048}
                onChange={(event) => setPasted(event.target.value)}
                value={pasted}
              />
              <button
                className="security-text-button"
                disabled={!pasted.trim()}
                onClick={() => void check(pasted.trim())}
                type="button"
              >
                Check code
              </button>
            </div>
          </details>
          {feedback ? (
            <p aria-live="polite" role="status">
              {feedback}
            </p>
          ) : null}
          {match ? (
            <button
              className="security-button"
              disabled={busy}
              onClick={() => void confirm()}
              type="button"
            >
              {busy ? "Verifying…" : "Confirm this device"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
