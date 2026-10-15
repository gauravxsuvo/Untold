"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
export function QrScanner({
  onScan,
  label = "Scan QR code",
}: {
  onScan: (value: string) => void;
  label?: string;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const resultHandler = useRef(onScan);
  resultHandler.current = onScan;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let controls: { stop: () => void } | undefined;
    const element = video.current;
    void (async () => {
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
            setActive(false);
            const value = result.getText();
            if (value.length > 4096) setError("This code can’t be used here.");
            else resultHandler.current(value);
          },
        );
        if (stopped) controls.stop();
      } catch {
        if (!stopped) {
          setActive(false);
          setError(
            "Camera access isn’t available. Allow it in your browser settings, or enter the code instead.",
          );
        }
      }
    })();
    const hide = () => {
      if (document.visibilityState !== "visible") setActive(false);
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
  }, [active]);
  return (
    <div className="security-stack">
      <button
        className="security-button security-button--secondary"
        onClick={() => {
          setError("");
          setActive(!active);
        }}
        type="button"
      >
        {active ? <X aria-hidden="true" size={16} /> : <Camera aria-hidden="true" size={16} />}
        {active ? "Stop camera" : label}
      </button>
      {active ? (
        <video
          aria-label="QR code scanner"
          autoPlay
          className="safety-qr__camera"
          muted
          playsInline
          ref={video}
        />
      ) : null}
      {error ? (
        <p role="alert" className="auth-field__hint">
          {error}
        </p>
      ) : null}
    </div>
  );
}
