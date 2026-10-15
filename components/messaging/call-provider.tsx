"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Minimize2, Phone, PhoneOff, Video, VideoOff, X } from "lucide-react";
import { useMessagingDevice } from "./messaging-device-provider";
import { classifyDeviceTrust } from "@/crypto/src/protocol";
import { fetchConversationDevices } from "@/lib/messaging/api-client";
import { signCallDescription, verifyCallDescription } from "@/lib/messaging/call-signatures";
import { fallbackIceServers, maxCallDurationMs } from "@/lib/messaging/call-policy";
import { gatherCallDescription } from "@/lib/messaging/call-ice";
import type {
  CallConfiguration,
  CallDescription,
  CallKind,
  CallSnapshot,
} from "@/lib/messaging/call-types";

type Phase = "preparing" | "outgoing" | "incoming" | "connecting" | "connected";
type Current = { call: CallSnapshot; phase: Phase };
function callError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return /^(?:This browser can’t|Allow camera|Allow microphone|Compare your contact’s|Your call access changed|Approve this device|Calls aren’t|Call connections are busy|The call connection service|The call couldn’t|We couldn’t|You or your contact|Finish the microphone|This call|Your contact needs|A device is no longer|The connection was)/.test(
    error.message,
  )
    ? error.message
    : fallback;
}
const Context = createContext<{
  active: boolean;
  available: boolean | null;
  start: (conversationId: string, name: string, kind: CallKind) => Promise<void>;
} | null>(null);
async function callRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      response.status === 409 && typeof body?.message === "string"
        ? body.message
        : response.status === 403
          ? "Your call access changed. Check your account and device approval."
          : "We couldn’t connect the call. Please try again.",
    );
  return body as T;
}
function StreamVideo({
  stream,
  muted = false,
  label,
  audioOnly = false,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  audioOnly?: boolean;
}) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => setBlocked(true));
    return () => {
      video.srcObject = null;
    };
  }, [stream]);
  return (
    <div className={`call-video${muted ? " call-video--self" : ""}`}>
      {audioOnly ? (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: Live private calls do not have a transcript track. */}
          <audio
            ref={(node) => {
              ref.current = node;
            }}
            autoPlay
            aria-label="Call audio"
          />
          <div className="call-avatar">
            <Phone size={46} aria-hidden="true" />
          </div>
        </>
      ) : (
        <video
          ref={(node) => {
            ref.current = node;
          }}
          autoPlay
          playsInline
          muted={muted}
          aria-label={label}
        />
      )}
      {blocked ? (
        <button
          type="button"
          className="feature-button"
          onClick={() =>
            void ref.current
              ?.play()
              .then(() => setBlocked(false))
              .catch(() => {})
          }
        >
          Play call audio
        </button>
      ) : null}
    </div>
  );
}
export function CallProvider({ children }: { children: ReactNode }) {
  const messaging = useMessagingDevice();
  const messagingRef = useRef(messaging);
  messagingRef.current = messaging;
  const [current, setCurrent] = useState<Current | null>(null);
  const currentRef = useRef<Current | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connectionPolicy, setConnectionPolicy] = useState<RTCIceTransportPolicy | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const availableRef = useRef<boolean | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const pendingMedia = useRef(false);
  const ignoredIncoming = useRef("");
  const lastHeartbeat = useRef(0);
  const lastSignalAt = useRef(0);
  const connectedAt = useRef(0);
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polling = useRef(false);
  function update(next: Current | null) {
    currentRef.current = next;
    setCurrent(next);
  }
  function cleanup() {
    generation.current++;
    lastHeartbeat.current = 0;
    lastSignalAt.current = 0;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    streamRef.current = null;
    remoteRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    remoteRef.current = null;
    if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
    if (connectTimer.current) clearTimeout(connectTimer.current);
    setLocal(null);
    setRemote(null);
    setMuted(false);
    setCameraOff(false);
    setUsingFallback(false);
    setConnectionPolicy(null);
    setSeconds(0);
    update(null);
    setMinimized(false);
    connectedAt.current = 0;
    window.dispatchEvent(new CustomEvent("untold-call-active", { detail: false }));
  }
  async function action(
    actionName: string,
    call: CallSnapshot,
    description?: CallDescription,
    keepalive = false,
  ) {
    const device = messagingRef.current.device;
    if (!device) return;
    return callRequest<{ ok: true }>("/api/calls", {
      method: "POST",
      keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: actionName,
        id: call.id,
        deviceId: device.deviceId,
        description,
      }),
    });
  }
  async function end(message = "Call ended") {
    const call = currentRef.current?.call;
    cleanup();
    setNotice(message);
    if (call) await action("end", call).catch(() => {});
  }
  async function trusted(description: CallDescription, call: CallSnapshot) {
    const localDevice = messagingRef.current.device;
    if (!localDevice) throw new Error("Approve this device in Settings before calling.");
    const raw = await fetchConversationDevices(call.conversationId);
    const directory = await classifyDeviceTrust(localDevice.accountId, raw);
    const sender = directory.find(
      (d) =>
        d.deviceId === description.deviceId &&
        d.userId !== localDevice.accountId &&
        d.approved &&
        !d.revoked &&
        d.trust === "verified",
    );
    if (
      !sender ||
      description.callId !== call.id ||
      description.conversationId !== call.conversationId ||
      description.kind !== call.kind ||
      !(await verifyCallDescription(description, sender))
    )
      throw new Error("Compare your contact’s safety code in the chat’s Details before calling.");
  }
  async function configuration(token: number): Promise<CallConfiguration> {
    const device = messagingRef.current.device;
    if (!device || !messagingRef.current.approved)
      throw new Error("Approve this device in Settings before calling.");
    const response = await fetch(`/api/ice?deviceId=${encodeURIComponent(device.deviceId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(25_000),
    });
    const body = await response.json().catch(() => null);
    if (token !== generation.current) throw new Error("Call cancelled");
    const policy = response.headers.get("X-Untold-ICE-Policy") === "all" ? "all" : "relay";
    setConnectionPolicy(policy);
    setUsingFallback(false);
    if (!response.ok) {
      // Only a validated relay outage can use the STUN fallback. Login, device,
      // membership, and local rate-limit failures never bypass access checks.
      if (
        (response.status === 429 || response.status === 503) &&
        body?.code === "relay_unavailable" &&
        policy === "all"
      ) {
        setUsingFallback(true);
        return { enabled: true, iceServers: fallbackIceServers, iceTransportPolicy: "all" };
      }
      if (response.status === 401 || response.status === 403)
        throw new Error("Your call access changed. Check your account and device approval.");
      if (response.status === 429)
        throw new Error("Call connections are busy right now. Please try again later.");
      throw new Error(
        "The call connection service is unavailable. Please try again in a few minutes.",
      );
    }
    if (!Array.isArray(body) || !body.length || body.length > 16)
      throw new Error(
        "The call connection service is unavailable. Please try again in a few minutes.",
      );
    return { enabled: true, iceServers: body as RTCIceServer[], iceTransportPolicy: policy };
  }
  async function preparePeer(call: CallSnapshot, config: CallConfiguration, token: number) {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined")
      throw new Error("This browser can’t make calls. Try an up-to-date browser.");
    // Another camera/microphone prompt may still be outstanding after Cancel.
    if (pendingMedia.current)
      throw new Error("Finish the microphone permission request before trying again.");
    pendingMedia.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video:
          call.kind === "video"
            ? { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } }
            : false,
      });
    } catch {
      throw new Error(
        call.kind === "video"
          ? "Allow camera and microphone access to join the video call."
          : "Allow microphone access to join the call.",
      );
    } finally {
      pendingMedia.current = false;
    }
    if (token !== generation.current || document.visibilityState !== "visible") {
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      throw new Error("Call cancelled");
    }
    streamRef.current = stream;
    setLocal(stream);
    const pc = new RTCPeerConnection({
      iceServers: config.iceServers,
      iceTransportPolicy: config.iceTransportPolicy,
      bundlePolicy: "max-bundle",
    });
    pcRef.current = pc;
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    const receiving = new MediaStream();
    remoteRef.current = receiving;
    setRemote(receiving);
    pc.ontrack = (event) => {
      receiving.addTrack(event.track);
      setRemote(new MediaStream(receiving.getTracks()));
    };
    pc.onconnectionstatechange = () => {
      if (pc !== pcRef.current) return;
      if (pc.connectionState === "connected") {
        if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
        if (connectTimer.current) clearTimeout(connectTimer.current);
        if (!connectedAt.current) connectedAt.current = Date.now();
        const now = currentRef.current;
        if (now) update({ ...now, phase: "connected" });
      } else if (pc.connectionState === "failed") {
        setError("The connection was lost. Please call again.");
        void end("Call disconnected");
      } else if (pc.connectionState === "disconnected") {
        const now = currentRef.current;
        if (now) update({ ...now, phase: "connecting" });
        if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
        disconnectTimer.current = setTimeout(() => {
          if (pc === pcRef.current && pc.connectionState !== "connected")
            void end("Connection lost. Please call again.");
        }, 15_000);
      }
    };
    return pc;
  }
  async function gatheredDescription(pc: RTCPeerConnection, token: number) {
    return gatherCallDescription(pc, () => token === generation.current && pc === pcRef.current);
  }
  function connectionTimeout() {
    if (connectTimer.current) clearTimeout(connectTimer.current);
    connectTimer.current = setTimeout(() => {
      if (currentRef.current?.phase !== "connected")
        void end("The call couldn’t connect. Please try again.");
    }, 35_000);
  }
  async function start(conversationId: string, name: string, kind: CallKind) {
    if (currentRef.current) return;
    if (document.documentElement.dataset.voiceRecording === "true") {
      setError("Finish or discard your voice recording before calling.");
      return;
    }
    const device = messagingRef.current.device;
    if (!device || !messagingRef.current.approved) return;
    const call: CallSnapshot = {
      id: crypto.randomUUID(),
      conversationId,
      callerId: device.accountId,
      calleeId: "",
      callerDeviceId: device.deviceId,
      calleeDeviceId: null,
      kind,
      status: "ringing",
      offer: null,
      answer: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 75_000).toISOString(),
      peerName: name,
    };
    setError("");
    setNotice("");
    setMinimized(false);
    update({ call, phase: "preparing" });
    window.dispatchEvent(new CustomEvent("untold-call-active", { detail: true }));
    const token = ++generation.current;
    let submitted = false;
    try {
      const raw = await fetchConversationDevices(conversationId);
      const directory = await classifyDeviceTrust(device.accountId, raw);
      if (
        !directory.some((d) => d.userId !== device.accountId && d.approved && !d.revoked) ||
        directory.some((d) => d.approved && !d.revoked && d.trust !== "verified")
      )
        throw new Error("Compare your contact’s safety code in the chat’s Details before calling.");
      const config = await configuration(token);
      if (token !== generation.current) return;
      const pc = await preparePeer(call, config, token);
      await pc.setLocalDescription(await pc.createOffer());
      const offer = await signCallDescription(
        device,
        call.id,
        conversationId,
        kind,
        await gatheredDescription(pc, token),
      );
      if (token !== generation.current) return;
      await action("start", call, offer);
      submitted = true;
      lastSignalAt.current = Date.now();
      if (token !== generation.current) {
        await action("end", call).catch(() => {});
        return;
      }
      update({
        call: { ...call, offer, expiresAt: new Date(Date.now() + 75_000).toISOString() },
        phase: "outgoing",
      });
    } catch (caught) {
      if (token === generation.current) {
        cleanup();
        setError(callError(caught, "We couldn’t start the call. Please try again."));
      }
      if (submitted) await action("end", call).catch(() => {});
    }
  }
  async function accept() {
    const incoming = currentRef.current;
    const device = messagingRef.current.device;
    if (incoming?.phase !== "incoming" || !incoming.call.offer || !device) return;
    if (document.documentElement.dataset.voiceRecording === "true") {
      setError("Finish or discard your voice recording before answering.");
      return;
    }
    const call = incoming.call;
    const offer = incoming.call.offer;
    setError("");
    update({ call, phase: "preparing" });
    const token = ++generation.current;
    let answered = false;
    try {
      await trusted(offer, call);
      const config = await configuration(token);
      if (token !== generation.current) return;
      const pc = await preparePeer(call, config, token);
      await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      const answer = await signCallDescription(
        device,
        call.id,
        call.conversationId,
        call.kind,
        await gatheredDescription(pc, token),
      );
      if (token !== generation.current) return;
      await action("answer", call, answer);
      answered = true;
      lastSignalAt.current = Date.now();
      if (token !== generation.current) {
        await action("end", call).catch(() => {});
        return;
      }
      update({
        call: { ...call, status: "active", calleeDeviceId: device.deviceId, answer },
        phase: pc.connectionState === "connected" ? "connected" : "connecting",
      });
      connectionTimeout();
    } catch (caught) {
      if (token === generation.current) {
        ignoredIncoming.current = call.id;
        cleanup();
        setError(callError(caught, "We couldn’t answer the call. Please try again."));
      }
      if (answered) await action("end", call).catch(() => {});
    }
  }
  const pollRef = useRef<() => Promise<void>>(async () => {});
  pollRef.current = async () => {
    const device = messagingRef.current.device;
    if (
      !device ||
      !messagingRef.current.approved ||
      polling.current ||
      (document.visibilityState !== "visible" && !currentRef.current)
    )
      return;
    const mine = currentRef.current;
    if (mine?.phase === "preparing") return;
    polling.current = true;
    try {
      const result = await callRequest<{ call: CallSnapshot | null; enabled: boolean }>(
        `/api/calls?deviceId=${device.deviceId}${mine ? `&id=${mine.call.id}` : ""}`,
      );
      if (
        messagingRef.current.device?.deviceId !== device.deviceId ||
        currentRef.current?.call.id !== mine?.call.id
      )
        return;
      availableRef.current = result.enabled;
      setAvailable(result.enabled);
      lastSignalAt.current = Date.now();
      const call = result.call;
      if (mine) {
        if (!call || call.status === "ended") {
          cleanup();
          setNotice(mine.phase === "outgoing" ? "Call ended or wasn’t answered" : "Call ended");
          return;
        }
        if (
          mine.phase === "outgoing" &&
          call.answer &&
          pcRef.current &&
          !pcRef.current.remoteDescription
        ) {
          await trusted(call.answer, call);
          if (currentRef.current?.call.id !== call.id || !pcRef.current) return;
          const pc = pcRef.current;
          await pc.setRemoteDescription({ type: "answer", sdp: call.answer.sdp });
          if (currentRef.current?.call.id !== call.id || pcRef.current !== pc) return;
          update({ call, phase: pc.connectionState === "connected" ? "connected" : "connecting" });
          connectionTimeout();
        }
        if (
          (call.status === "active" || call.callerId === device.accountId) &&
          Date.now() - lastHeartbeat.current > 15_000
        ) {
          lastHeartbeat.current = Date.now();
          await action("heartbeat", call);
        }
      } else if (
        call?.status === "ringing" &&
        call.calleeId === device.accountId &&
        call.id !== ignoredIncoming.current
      ) {
        update({ call, phase: "incoming" });
        setError("");
        setNotice("");
        setMinimized(false);
        window.dispatchEvent(new CustomEvent("untold-call-active", { detail: true }));
      }
    } catch (caught) {
      if (mine && caught instanceof Error && /safety code|access changed/.test(caught.message)) {
        setError(caught.message);
        await end("Call ended");
      }
      // Network interruptions retry while WebRTC may still be connected.
    } finally {
      polling.current = false;
    }
  };
  useEffect(() => {
    const deviceId = messaging.device?.deviceId;
    if (!deviceId || !messaging.approved) return;
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      if (currentRef.current || tick % (availableRef.current === false ? 24 : 3) === 0)
        void pollRef.current();
    }, 2500);
    const visible = () => void pollRef.current();
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    const pushed = (event: MessageEvent) => {
      if (event.data?.type === "untold-call-available") void pollRef.current();
    };
    navigator.serviceWorker?.addEventListener("message", pushed);
    void pollRef.current();
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
      navigator.serviceWorker?.removeEventListener("message", pushed);
    };
  }, [messaging.device?.deviceId, messaging.approved]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The device change triggers teardown; methods read current resources from refs.
  useEffect(() => {
    const leave = () => {
      const call = currentRef.current?.call;
      if (call) void action("end", call, undefined, true).catch(() => {});
      cleanup();
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [messaging.device?.deviceId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Approval changes stop the current call through live refs.
  useEffect(() => {
    if (!messaging.approved && currentRef.current) {
      void end("Device approval changed");
    }
  }, [messaging.approved]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (current && !minimized && dialog && !dialog.open) dialog.showModal();
    else if ((!current || minimized) && dialog?.open) dialog.close();
  }, [current, minimized]);
  const isActive = Boolean(current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The timer uses live call refs; end reads the same refs.
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setSeconds(connectedAt.current ? Math.floor((Date.now() - connectedAt.current) / 1000) : 0);
      const latest = currentRef.current;
      if (!latest || latest.phase === "preparing") return;
      if (
        (latest.phase === "outgoing" || latest.phase === "incoming") &&
        Date.parse(latest.call.expiresAt) <= Date.now()
      ) {
        void end("Call wasn’t answered");
        return;
      }
      if (
        (lastSignalAt.current && Date.now() - lastSignalAt.current > 60_000) ||
        Date.now() - Date.parse(latest.call.createdAt) >= maxCallDurationMs
      )
        void end("Call ended. Open a new call to reconnect.");
    }, 1000);
    return () => clearInterval(timer);
  }, [isActive]);
  const phaseLabel = !current
    ? ""
    : current.phase === "incoming"
      ? `Incoming ${current.call.kind === "video" ? "video" : "voice"} call`
      : current.phase === "preparing"
        ? "Getting ready…"
        : current.phase === "outgoing"
          ? "Calling…"
          : current.phase === "connecting"
            ? "Connecting…"
            : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <Context.Provider value={{ active: Boolean(current), available, start }}>
      {children}
      {error || notice ? (
        <div className="call-toast" role="status">
          <span>{error || notice}</span>
          <button
            aria-label="Dismiss call status"
            type="button"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      {current && minimized ? (
        <button
          className="call-mini feature-button"
          type="button"
          onClick={() => setMinimized(false)}
        >
          <Phone size={16} />
          {current.call.peerName} · {phaseLabel}
        </button>
      ) : null}
      <dialog
        className="call-dialog"
        ref={dialogRef}
        aria-label={current ? `Call with ${current.call.peerName}` : "Call"}
        onCancel={(event) => {
          event.preventDefault();
          setMinimized(true);
        }}
      >
        {current ? (
          <>
            <header>
              <span>{current.call.kind === "video" ? "Video call" : "Voice call"}</span>
              <button aria-label="Minimize call" type="button" onClick={() => setMinimized(true)}>
                <Minimize2 size={18} />
              </button>
            </header>
            <h2>{current.call.peerName}</h2>
            <p className="call-phase" role="status">
              {phaseLabel}
            </p>
            <div
              className={`call-stage${current.call.kind === "voice" ? " call-stage--voice" : ""}`}
            >
              {remote ? (
                <StreamVideo
                  stream={remote}
                  label="Your contact"
                  audioOnly={current.call.kind === "voice"}
                />
              ) : (
                <div className="call-avatar">
                  {current.call.kind === "video" ? <Video size={46} /> : <Phone size={46} />}
                </div>
              )}
              {local && current.call.kind === "video" ? (
                <StreamVideo stream={local} muted label="Your camera preview" />
              ) : null}
            </div>
            <div className="call-controls">
              {current.phase === "incoming" ? (
                <button
                  className="call-control call-control--accept"
                  type="button"
                  onClick={() => void accept()}
                >
                  <Phone size={22} />
                  <span>Answer</span>
                </button>
              ) : (
                <>
                  {local ? (
                    <button
                      className="call-control"
                      type="button"
                      aria-pressed={muted}
                      onClick={() => {
                        const next = !muted;
                        streamRef.current?.getAudioTracks().forEach((t) => {
                          t.enabled = !next;
                        });
                        setMuted(next);
                      }}
                    >
                      {muted ? <MicOff size={22} /> : <Mic size={22} />}
                      <span>{muted ? "Unmute" : "Mute"}</span>
                    </button>
                  ) : null}
                  {local && current.call.kind === "video" ? (
                    <button
                      className="call-control"
                      aria-pressed={cameraOff}
                      type="button"
                      onClick={() => {
                        const next = !cameraOff;
                        streamRef.current?.getVideoTracks().forEach((t) => {
                          t.enabled = !next;
                        });
                        setCameraOff(next);
                      }}
                    >
                      {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
                      <span>{cameraOff ? "Camera on" : "Camera off"}</span>
                    </button>
                  ) : null}
                </>
              )}
              <button
                className="call-control call-control--end"
                type="button"
                onClick={() =>
                  void end(current.phase === "incoming" ? "Call declined" : "Call ended")
                }
              >
                <PhoneOff size={22} />
                <span>{current.phase === "incoming" ? "Decline" : "End call"}</span>
              </button>
            </div>
            <p className="call-note">
              {usingFallback
                ? "Trying a direct connection. It may not work on every network. "
                : ""}
              {connectionPolicy === "all"
                ? "Direct connections can share your network address with your contact. "
                : connectionPolicy === "relay"
                  ? "Direct connections are disabled. "
                  : ""}
              Keep Untold open. Calls can last up to 55 minutes.
            </p>
          </>
        ) : null}
      </dialog>
    </Context.Provider>
  );
}
export function useCalls() {
  const value = useContext(Context);
  if (!value) throw new Error("Calls require CallProvider");
  return value;
}
