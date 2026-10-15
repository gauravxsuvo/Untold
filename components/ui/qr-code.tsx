"use client";

import { useId, useMemo } from "react";
import QRCode from "qrcode";

export function QrCode({ value, label }: { value: string; label: string }) {
  const id = useId();
  const qr = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
    const paths: string[] = [];
    for (let y = 0; y < modules.size; y++)
      for (let x = 0; x < modules.size; x++)
        if (modules.data[y * modules.size + x]) paths.push(`M${x + 4},${y + 4}h1v1h-1z`);
    return { path: paths.join(""), size: modules.size + 8 };
  }, [value]);
  return (
    <svg
      aria-label={label}
      className="security-qr"
      role="img"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
    >
      <title id={id}>Untold QR code</title>
      <path d={`M0,0h${qr.size}v${qr.size}H0z`} fill="#ffffff" />
      <path d={qr.path} fill="#000000" shapeRendering="crispEdges" />
    </svg>
  );
}
