"use client";
import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Phone, Play, VideoOff } from "lucide-react";
import { useCallDevices } from "./call-devices";

// Muted inline video must not wait for audio-output selection or autoplay permission.
export function CallMediaView({
  stream,
  muted = false,
  audioOnly = false,
  videoOff = false,
  label,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  audioOnly?: boolean;
  videoOff?: boolean;
  label: string;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const frame = useRef<HTMLFieldSetElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const { attachOutput, blocked: outputBlocked } = useCallDevices();
  useEffect(() => {
    const visual = audioOnly ? null : video.current;
    const audible = audio.current;
    if (!stream) {
      setHasVideo(false);
      return;
    }
    let disposed = false;
    const playVideo = () => {
      if (visual && !disposed) void visual.play().catch(() => {});
    };
    const updateVideo = () => {
      setHasVideo(
        stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted),
      );
      playVideo();
    };
    const tracks = new Set<MediaStreamTrack>();
    const observe = () => {
      for (const track of stream.getTracks()) {
        if (tracks.has(track)) continue;
        tracks.add(track);
        track.addEventListener("mute", updateVideo);
        track.addEventListener("unmute", updateVideo);
        track.addEventListener("ended", updateVideo);
      }
      updateVideo();
      if (audible?.srcObject && !audible.dataset.callOutputBlocked)
        void audible.play().catch(() => setBlocked(true));
    };
    if (visual) visual.srcObject = stream;
    let detach: (() => void) | undefined;
    if (audible && !muted) {
      audible.srcObject = stream;
      detach = attachOutput(audible, () => setBlocked(true));
    }
    observe();
    stream.addEventListener("addtrack", observe);
    stream.addEventListener("removetrack", observe);
    visual?.addEventListener("loadedmetadata", playVideo);
    visual?.addEventListener("canplay", playVideo);
    const resume = () => {
      playVideo();
      if (audible?.srcObject && !audible.dataset.callOutputBlocked)
        void audible.play().catch(() => setBlocked(true));
    };
    window.addEventListener("untold-call-windowchange", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      detach?.();
      stream.removeEventListener("addtrack", observe);
      stream.removeEventListener("removetrack", observe);
      for (const track of tracks) {
        track.removeEventListener("mute", updateVideo);
        track.removeEventListener("unmute", updateVideo);
        track.removeEventListener("ended", updateVideo);
      }
      visual?.removeEventListener("loadedmetadata", playVideo);
      visual?.removeEventListener("canplay", playVideo);
      window.removeEventListener("untold-call-windowchange", resume);
      document.removeEventListener("visibilitychange", resume);
      if (visual) {
        visual.pause();
        visual.srcObject = null;
      }
      if (audible) {
        audible.pause();
        audible.srcObject = null;
      }
    };
  }, [stream, muted, audioOnly, attachOutput]);
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
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (node.ownerDocument.fullscreenElement === node) {
      await node.ownerDocument.exitFullscreen().catch(() => {});
      return;
    }
    try {
      if (node.requestFullscreen) {
        await node.requestFullscreen();
        return;
      }
    } catch {
      /* In-app fallback. */
    }
    const media = video.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (media?.webkitEnterFullscreen && media.readyState >= 1) {
      try {
        media.webkitEnterFullscreen();
        return;
      } catch {
        /* In-app fallback. */
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
      {!muted ? (
        <audio
          ref={audio}
          muted={muted}
          aria-label={`${label} audio`}
          onPlaying={() => setBlocked(false)}
        />
      ) : null}
      {!audioOnly ? (
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          aria-label={label}
          data-call-remote={!muted || undefined}
        />
      ) : null}
      {audioOnly || videoOff || !hasVideo ? (
        <div className="call-media__placeholder" aria-hidden="true">
          {audioOnly ? <Phone size={42} /> : <VideoOff size={32} />}
          <span>
            {audioOnly
              ? label
              : videoOff
                ? "Camera off"
                : stream
                  ? "Waiting for video"
                  : "Connecting…"}
          </span>
        </div>
      ) : null}
      {!audioOnly ? (
        <button
          type="button"
          className="call-media__fullscreen"
          onClick={() => void fullscreen()}
          title={expanded || nativeFullscreen ? "Exit fullscreen" : "View fullscreen"}
          aria-label={`${expanded || nativeFullscreen ? "Exit fullscreen" : "View fullscreen"}: ${label}`}
        >
          {expanded || nativeFullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
        </button>
      ) : null}
      {blocked && !outputBlocked ? (
        <button
          type="button"
          className="feature-button call-media__play"
          onClick={() => {
            const node = audio.current;
            if (node && !node.dataset.callOutputBlocked)
              void node
                .play()
                .then(() => setBlocked(false))
                .catch(() => {});
          }}
        >
          <Play size={16} />
          Enable call audio
        </button>
      ) : null}
    </fieldset>
  );
}
