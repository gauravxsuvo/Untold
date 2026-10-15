"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Square, Trash2, X } from "lucide-react";
import { useCalls } from "./call-provider";
type Recording = { blob: Blob; url: string; name: string };
export function VoiceRecorder({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (file: File) => Promise<boolean>;
}) {
  const calls = useCalls();
  const [phase, setPhase] = useState<"idle" | "opening" | "recording" | "review" | "sending">(
    "idle",
  );
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const draftRef = useRef<Recording | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const startAt = useRef(0);
  const acquiring = useRef(false);
  const stopMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    delete document.documentElement.dataset.voiceRecording;
  }, []);
  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopMedia();
  }, [stopMedia]);
  function discard() {
    generation.current++;
    stop();
    recorderRef.current = null;
    if (draftRef.current) URL.revokeObjectURL(draftRef.current.url);
    draftRef.current = null;
    setRecording(null);
    setPhase("idle");
    setSeconds(0);
    setError("");
  }
  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    const incoming = (event: Event) => {
      if (!(event as CustomEvent).detail) return;
      if (acquiring.current) {
        generation.current++;
        setPhase("idle");
      }
      stop();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("untold-call-active", incoming);
    return () => {
      mounted.current = false;
      generation.current++;
      stop();
      if (draftRef.current) URL.revokeObjectURL(draftRef.current.url);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("untold-call-active", incoming);
    };
  }, [stop]);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startAt.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= 300) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [phase, stop]);
  async function begin() {
    if (disabled || calls.active || phase !== "idle") return;
    if (acquiring.current || document.documentElement.dataset.callMediaPending) {
      setError("Finish the microphone permission request before trying again.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording isn’t supported here. You can attach an audio file instead.");
      return;
    }
    setError("");
    setPhase("opening");
    acquiring.current = true;
    const token = ++generation.current;
    try {
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) throw new Error();
      document.documentElement.dataset.callMediaPending = "recording";
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: false,
      });
      if (
        !mounted.current ||
        generation.current !== token ||
        document.visibilityState !== "visible"
      ) {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        if (mounted.current && generation.current === token) setPhase("idle");
        return;
      }
      streamRef.current = stream;
      document.documentElement.dataset.voiceRecording = "true";
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48_000 });
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          bytes += event.data.size;
          if (bytes >= 6 * 1024 * 1024) stop();
        }
      };
      recorder.onerror = () => {
        stopMedia();
        if (mounted.current && token === generation.current) {
          generation.current++;
          setPhase("idle");
          setError("The recording stopped unexpectedly. Please try again.");
        }
      };
      recorder.onstop = () => {
        stopMedia();
        if (!mounted.current || token !== generation.current) return;
        const type = recorder.mimeType.split(";")[0];
        const blob = new Blob(chunks, { type });
        if (!blob.size || blob.size > 7 * 1024 * 1024 || Date.now() - startAt.current < 500) {
          setPhase("idle");
          setError("Record for at least a second, then try again.");
          return;
        }
        const extension = type === "audio/mp4" ? "m4a" : type === "audio/ogg" ? "ogg" : "webm";
        const next = {
          blob,
          url: URL.createObjectURL(blob),
          name: `Voice message ${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
        };
        draftRef.current = next;
        setRecording(next);
        setPhase("review");
      };
      startAt.current = Date.now();
      setSeconds(0);
      recorder.start(500);
      setPhase("recording");
    } catch {
      stopMedia();
      if (mounted.current && token === generation.current) {
        setPhase("idle");
        setError("Allow microphone access to record a voice message.");
      }
    } finally {
      acquiring.current = false;
      if (document.documentElement.dataset.callMediaPending === "recording")
        delete document.documentElement.dataset.callMediaPending;
    }
  }
  async function send() {
    if (!recording || disabled || phase !== "review") return;
    setPhase("sending");
    const token = generation.current;
    try {
      const sent = await onSend(
        new File([recording.blob], recording.name, { type: recording.blob.type }),
      );
      if (!mounted.current || token !== generation.current) return;
      if (sent) discard();
      else {
        setPhase("review");
        setError("Your voice message wasn’t sent. You can try again.");
      }
    } catch {
      if (mounted.current && token === generation.current) {
        setPhase("review");
        setError("Your voice message wasn’t sent. You can try again.");
      }
    }
  }
  return (
    <div className={`voice-recorder voice-recorder--${phase}`}>
      {phase === "idle" ? (
        <button
          className="feature-button"
          aria-label="Record a voice message"
          disabled={disabled || calls.active}
          onClick={() => void begin()}
          type="button"
        >
          <Mic size={17} aria-hidden="true" />
          <span>Voice message</span>
        </button>
      ) : phase === "opening" ? (
        <div className="voice-recorder__controls">
          <span role="status">Waiting for microphone…</span>
          <button aria-label="Cancel recording" type="button" onClick={discard}>
            <X size={18} />
          </button>
        </div>
      ) : phase === "recording" ? (
        <div className="voice-recorder__controls">
          <span className="voice-recorder__dot" aria-hidden="true" />
          <span role="status">
            Recording {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
          <button className="feature-button" type="button" onClick={stop}>
            <Square size={16} aria-hidden="true" />
            Stop
          </button>
          <button aria-label="Discard recording" type="button" onClick={discard}>
            <Trash2 size={18} />
          </button>
        </div>
      ) : (
        <div className="voice-recorder__review">
          {/* biome-ignore lint/a11y/useMediaCaption: A private voice recording has no supplied transcript. */}
          <audio
            controls
            preload="metadata"
            src={recording?.url}
            aria-label="Preview your voice message"
          />
          <div className="voice-recorder__controls">
            <button
              aria-label="Discard voice message"
              disabled={phase === "sending"}
              type="button"
              onClick={discard}
            >
              <Trash2 size={18} />
            </button>
            <button
              className="feature-button"
              disabled={disabled || phase === "sending"}
              type="button"
              onClick={() => void send()}
            >
              <Send size={16} aria-hidden="true" />
              {phase === "sending" ? "Sending…" : "Send voice message"}
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p className="messaging-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
