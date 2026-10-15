"use client";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { Download, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { PdfPreview } from "./pdf-preview";
export function AttachmentViewer({
  url,
  name,
  kind,
  onClose,
  onDownload,
}: {
  url: string;
  name: string;
  kind: "image" | "video" | "audio" | "pdf";
  onClose: () => void;
  onDownload: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);
  const title = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="attachment-viewer"
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="attachment-viewer__header">
        <h2 id={title}>{name}</h2>
        <div>
          <button className="feature-button" onClick={onDownload} type="button">
            <Download size={17} aria-hidden="true" />
            <span>Download</span>
          </button>
          <button
            className="feature-button"
            aria-label="Close attachment"
            onClick={onClose}
            type="button"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </header>
      {kind === "image" ? (
        <div className="attachment-viewer__tools">
          <button
            className="feature-button"
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
            type="button"
          >
            <ZoomOut size={18} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="feature-button"
            aria-label="Zoom in"
            disabled={zoom >= 4}
            onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
            type="button"
          >
            <ZoomIn size={18} />
          </button>
          <button
            className="feature-button"
            aria-label="Reset zoom"
            onClick={() => setZoom(1)}
            type="button"
          >
            <RotateCcw size={17} />
          </button>
        </div>
      ) : null}
      <div className={`attachment-viewer__content attachment-viewer__content--${kind}`}>
        {kind === "image" ? (
          <div className="attachment-viewer__image-area" style={{ width: `${zoom * 100}%` }}>
            <Image src={url} alt={name} width={1600} height={1200} unoptimized draggable={false} />
          </div>
        ) : kind === "pdf" ? (
          <PdfPreview url={url} name={name} />
        ) : kind === "video" ? (
          <>
            {/* biome-ignore lint/a11y/useMediaCaption: Shared video may not include captions. */}
            <video controls playsInline preload="metadata" src={url} aria-label={name} />
          </>
        ) : (
          <>
            {/* biome-ignore lint/a11y/useMediaCaption: Shared audio may not include a transcript. */}
            <audio controls preload="metadata" src={url} aria-label={name} />
          </>
        )}
      </div>
      {kind === "video" || kind === "audio" ? (
        <p className="attachment-viewer__note">
          Captions or a transcript may not be included with this file.
        </p>
      ) : null}
    </dialog>
  );
}
