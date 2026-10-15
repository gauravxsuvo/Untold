"use client";
import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Phone, Play } from "lucide-react";
import { useCallDevices } from "./call-devices";

export function CallMediaView({
  stream,
  muted = false,
  audioOnly = false,
  label,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  audioOnly?: boolean;
  label: string;
}) {
  const element = useRef<HTMLMediaElement | null>(null);
  const frame = useRef<HTMLFieldSetElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const { attachOutput } = useCallDevices();
  useEffect(() => {
    const node = element.current;
    if (!node || !stream) return;
    node.srcObject = stream;
    let detach: (() => void) | undefined;
    if (muted) void node.play().catch(() => setBlocked(true));
    else detach = attachOutput(node, () => setBlocked(true));
    return () => {
      detach?.();
      node.pause();
      node.srcObject = null;
    };
  }, [stream, muted, attachOutput]);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    let doc = node.ownerDocument;
    const changed = () => setNativeFullscreen(doc.fullscreenElement === node);
    const moved = () => {
      doc.removeEventListener("fullscreenchange", changed);
      doc = node.ownerDocument;
      doc.addEventListener("fullscreenchange", changed);
      changed();
      const media = element.current;
      if (media?.srcObject && !media.dataset.callOutputBlocked)
        void media.play().catch(() => setBlocked(true));
    };
    doc.addEventListener("fullscreenchange", changed);
    window.addEventListener("untold-call-windowchange", moved);
    return () => {
      doc.removeEventListener("fullscreenchange", changed);
      window.removeEventListener("untold-call-windowchange", moved);
    };
  }, []);
  async function fullscreen() {
    const node = frame.current;
    if (!node) return;
    const doc = node.ownerDocument;
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (doc.fullscreenElement === node) {
      await doc.exitFullscreen().catch(() => {});
      return;
    }
    try {
      if (node.requestFullscreen) {
        await node.requestFullscreen();
        return;
      }
    } catch {
      /* PiP documents can reject fullscreen. */
    }
    const video = element.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (video?.webkitEnterFullscreen && video.readyState >= 1) {
      try {
        video.webkitEnterFullscreen();
        return;
      } catch {
        /* Use the in-window view. */
      }
    }
    setExpanded(true);
  }
  return (
    <fieldset
      ref={frame}
      aria-label={label}
      className={`call-media${expanded ? " call-media--expanded" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          setExpanded(false);
        }
      }}
    >
      {audioOnly ? (
        <>
          <audio
            ref={(node) => {
              element.current = node;
            }}
            autoPlay={muted}
            muted={muted}
            aria-label={label}
            onPlaying={() => setBlocked(false)}
          />
          <div className="call-avatar">
            <Phone size={42} aria-hidden="true" />
          </div>
        </>
      ) : (
        <video
          ref={(node) => {
            element.current = node;
          }}
          autoPlay={muted}
          playsInline
          muted={muted}
          aria-label={label}
          onPlaying={() => setBlocked(false)}
        />
      )}
      {!audioOnly ? (
        <button
          type="button"
          className="call-media__fullscreen"
          onClick={() => void fullscreen()}
          title={expanded || nativeFullscreen ? "Exit fullscreen" : "View fullscreen"}
          aria-label={
            expanded || nativeFullscreen ? `Exit fullscreen: ${label}` : `View fullscreen: ${label}`
          }
        >
          {expanded || nativeFullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
        </button>
      ) : null}
      {blocked ? (
        <button
          type="button"
          className="feature-button call-media__play"
          onClick={() => {
            const node = element.current;
            if (!node || node.dataset.callOutputBlocked) return;
            void node
              .play()
              .then(() => setBlocked(false))
              .catch(() => {});
          }}
        >
          <Play size={16} />
          Play call audio
        </button>
      ) : null}
    </fieldset>
  );
}
