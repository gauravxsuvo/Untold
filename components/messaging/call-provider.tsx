"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { useMessagingDevice } from "./messaging-device-provider";
import { classifyDeviceTrust } from "@/crypto/src/protocol";
import { fetchConversationDevices } from "@/lib/messaging/api-client";
import { signCallDescription, verifyCallDescription } from "@/lib/messaging/call-signatures";
import { fallbackIceServers, maxCallDurationMs } from "@/lib/messaging/call-policy";
import { gatherCallDescription } from "@/lib/messaging/call-ice";
import {
  chooseCallScreen,
  constrainCallScreen,
  limitCallSenders,
  preferSpeechCodec,
  screenShareError,
} from "@/lib/messaging/call-media";
import { useGroupCalls } from "./group-call-provider";
import { CallWindow } from "./call-window";
import { CallMediaView } from "./call-media-view";
import { CallDeviceSettings, useCallDevices } from "./call-devices";
import { callInputConstraints, switchCallInput } from "@/lib/messaging/call-input";
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
  start: (
    conversationId: string,
    name: string,
    kind: CallKind,
    group?: boolean,
    roomId?: string,
  ) => Promise<void>;
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
  sharing = false,
  videoOff = false,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  audioOnly?: boolean;
  sharing?: boolean;
  videoOff?: boolean;
}) {
  return (
    <div
      className={`call-video${muted ? " call-video--self" : ""}${sharing ? " call-video--sharing" : ""}`}
    >
      <CallMediaView
        stream={stream}
        muted={muted}
        label={label}
        audioOnly={audioOnly}
        videoOff={videoOff}
      />
    </div>
  );
}
export function CallProvider({ children }: { children: ReactNode }) {
  const groups = useGroupCalls();
  const devices = useCallDevices();
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
  const mutedRef = useRef(false);
  const [cameraOff, setCameraOff] = useState(false);
  const cameraOffRef = useRef(false);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const [screenBusy, setScreenBusy] = useState(false);
  const screenPending = useRef(false);
  const senderUpdates = useRef<Promise<void>>(Promise.resolve());
  const [minimized, setMinimized] = useState(false);
  const [seconds, setSeconds] = useState(0);
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
    senderUpdates.current = Promise.resolve();
    streamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    streamRef.current = null;
    screenRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    screenRef.current = null;
    setScreen(null);
    lastHeartbeat.current = 0;
    setScreenBusy(false);
    remoteRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    remoteRef.current = null;
    if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
    if (connectTimer.current) clearTimeout(connectTimer.current);
    setLocal(null);
    setRemote(null);
    setMuted(false);
    mutedRef.current = false;
    setCameraOff(false);
    cameraOffRef.current = false;
    setUsingFallback(false);
    setConnectionPolicy(null);
    setSeconds(0);
    update(null);
    setMinimized(false);
    connectedAt.current = 0;
    if (document.documentElement.dataset.liveCall === "direct") {
      delete document.documentElement.dataset.liveCall;
      window.dispatchEvent(new CustomEvent("untold-call-active", { detail: false }));
    }
  }
  async function action(
    actionName: string,
    call: CallSnapshot,
    description?: CallDescription,
    keepalive = false,
    endReason?: string,
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
        connected: pcRef.current?.connectionState === "connected",
        cameraOff: cameraOffRef.current,
        sharing: Boolean(screenRef.current),
        endReason,
      }),
    }).then((result) => {
      window.dispatchEvent(new Event("untold-call-history-refresh"));
      return result;
    });
  }
  async function end(message = "Call ended") {
    const call = currentRef.current?.call;
    cleanup();
    setNotice(message);
    if (call)
      await action(
        "end",
        call,
        undefined,
        false,
        /lost|disconnected/i.test(message)
          ? "disconnected"
          : /couldn’t|failed|connect/i.test(message)
            ? "failed"
            : undefined,
      ).catch(() => {});
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
    if (pendingMedia.current || document.documentElement.dataset.callMediaPending)
      throw new Error("Finish the microphone permission request before trying again.");
    pendingMedia.current = true;
    document.documentElement.dataset.callMediaPending = "direct";
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: callInputConstraints("audio", devices.preferencesRef.current.microphone),
        video:
          call.kind === "video"
            ? callInputConstraints("video", devices.preferencesRef.current.camera)
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
      if (document.documentElement.dataset.callMediaPending === "direct")
        delete document.documentElement.dataset.callMediaPending;
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
    preferSpeechCodec(pc);
    const receiving = new MediaStream();
    remoteRef.current = receiving;
    setRemote(receiving);
    pc.ontrack = (event) => {
      receiving.addTrack(event.track);
    };
    pc.onconnectionstatechange = () => {
      if (pc !== pcRef.current) return;
      if (pc.connectionState === "connected") {
        void updateSenders(pc, () => limitCallSenders(pc, Boolean(screenRef.current))).catch(() => {
          if (pc === pcRef.current)
            void end("This browser couldn’t prepare the call. Please try an up-to-date browser.");
        });
        if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
        if (connectTimer.current) clearTimeout(connectTimer.current);
        if (!connectedAt.current) connectedAt.current = Date.now();
        const now = currentRef.current;
        if (now) {
          update({ ...now, phase: "connected" });
          lastHeartbeat.current = 0;
        }
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
  async function changeInput(kind: "audio" | "video", id: string) {
    const token = generation.current;
    const pc = pcRef.current;
    if (!pc || screenPending.current || (kind === "video" && screenRef.current))
      throw new Error("Call device unavailable");
    await switchCallInput(kind, id, {
      getStream: () => streamRef.current,
      setStream: (next) => {
        streamRef.current = next;
        setLocal(next);
      },
      isCurrent: () => token === generation.current && pcRef.current === pc,
      enabled: () => (kind === "audio" ? !mutedRef.current : !cameraOffRef.current),
      targets: () => [
        {
          replace: (track) =>
            updateSenders(pc, async () => {
              const sender = pc.getSenders().find((s) => s.track?.kind === kind);
              if (!sender) throw new Error("Call sender unavailable");
              await sender.replaceTrack(track);
              await limitCallSenders(pc, Boolean(screenRef.current));
            }),
          disconnect: () => {
            if (pcRef.current === pc) void end("The device couldn’t switch. Please call again.");
          },
        },
      ],
    });
  }
  async function stopScreen() {
    const capture = screenRef.current;
    if (!capture) return;
    screenRef.current = null;
    capture.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    setScreen(null);
    const pc = pcRef.current;
    const camera = streamRef.current?.getVideoTracks()[0] ?? null;
    if (camera) camera.enabled = !cameraOffRef.current;
    if (!pc || pc.signalingState === "closed") return;
    try {
      await updateSenders(pc, async () => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(camera);
        await limitCallSenders(pc, false);
      });
    } catch {
      if (pc === pcRef.current) void end("The camera couldn’t resume. Please call again.");
    }
  }
  function updateSenders(pc: RTCPeerConnection, task: () => Promise<void>) {
    const next = senderUpdates.current
      .catch(() => {})
      .then(async () => {
        if (pc === pcRef.current && pc.signalingState !== "closed") await task();
      });
    senderUpdates.current = next;
    return next;
  }
  async function shareScreen(context: Window | null) {
    const pc = pcRef.current;
    if (!pc || currentRef.current?.phase !== "connected" || screenPending.current) return;
    if (screenRef.current) {
      screenPending.current = true;
      setScreenBusy(true);
      const token = generation.current;
      try {
        await stopScreen();
      } finally {
        screenPending.current = false;
        if (token === generation.current) setScreenBusy(false);
      }
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice(
        "Screen sharing isn’t supported in this browser. You can still watch a shared screen.",
      );
      return;
    }
    if (document.documentElement.dataset.callMediaPending === "switch") {
      setNotice("Wait for the device change to finish before sharing your screen.");
      return;
    }
    screenPending.current = true;
    setScreenBusy(true);
    const token = generation.current;
    let capture: MediaStream | null = null;
    try {
      capture = await chooseCallScreen(context ?? window);
      const track = await constrainCallScreen(capture);
      if (token !== generation.current || pc !== pcRef.current) return;
      if (track.readyState !== "live") return;
      screenRef.current = capture;
      track.onended = () => void stopScreen();
      await updateSenders(pc, async () => {
        if (screenRef.current !== capture) return;
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (!sender) throw new Error();
        await sender.replaceTrack(track);
        await limitCallSenders(pc, true);
      });
      if (token !== generation.current || pc !== pcRef.current || screenRef.current !== capture)
        return;
      streamRef.current?.getVideoTracks().forEach((camera) => {
        camera.enabled = false;
      });
      setScreen(capture);
      lastHeartbeat.current = 0;
    } catch (caught) {
      if (token === generation.current) {
        if (capture && screenRef.current === capture) await stopScreen();
        setNotice(screenShareError(caught));
      }
    } finally {
      if (capture && screenRef.current !== capture)
        capture.getTracks().forEach((track) => {
          track.stop();
        });
      screenPending.current = false;
      if (token === generation.current) setScreenBusy(false);
    }
  }
  async function start(
    conversationId: string,
    name: string,
    kind: CallKind,
    group = false,
    roomId?: string,
  ) {
    if (currentRef.current || groups.active || document.documentElement.dataset.liveCall) return;
    if (group) {
      await groups.start(conversationId, name, kind, roomId);
      return;
    }
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
    document.documentElement.dataset.liveCall = "direct";
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
      await updateSenders(pc, () => limitCallSenders(pc, false));
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
      await updateSenders(pc, () => limitCallSenders(pc, false));
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
      (document.visibilityState !== "visible" && !currentRef.current) ||
      document.documentElement.dataset.liveCall === "group"
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
      if (document.documentElement.dataset.liveCall === "group") return;
      lastSignalAt.current = Date.now();
      const call = result.call;
      if (mine) {
        if (!call || call.status === "ended") {
          cleanup();
          setNotice(mine.phase === "outgoing" ? "Call ended or wasn’t answered" : "Call ended");
          return;
        }
        update({ ...mine, call });
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
          await updateSenders(pc, () => limitCallSenders(pc, Boolean(screenRef.current)));
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
        document.documentElement.dataset.liveCall = "direct";
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
    <Context.Provider value={{ active: Boolean(current) || groups.active, available, start }}>
      {children}
      {!current && (error || notice) ? (
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
      {current ? (
        <CallWindow
          title={`Call with ${current.call.peerName}`}
          live={Boolean(local)}
          minimized={minimized}
          onMinimize={setMinimized}
          muted={muted}
          duration={
            current.phase === "connected"
              ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
              : undefined
          }
          onEnd={() => void end(current.phase === "incoming" ? "Call declined" : "Call ended")}
          onMute={
            local
              ? () => {
                  const next = !mutedRef.current;
                  mutedRef.current = next;
                  streamRef.current?.getAudioTracks().forEach((track) => {
                    track.enabled = !next;
                  });
                  setMuted(next);
                }
              : undefined
          }
        >
          <h2>{current.call.peerName}</h2>
          <p className="call-phase" role="status">
            {phaseLabel}
          </p>
          {error || notice || devices.blocked ? (
            <p className="call-window__message" role="status">
              {devices.blocked
                ? devices.error || "Choose an audio output in More options to hear the call."
                : error || notice}
            </p>
          ) : null}
          <div className={`call-stage${current.call.kind === "voice" ? " call-stage--voice" : ""}`}>
            {remote ? (
              <StreamVideo
                stream={remote}
                label="Your contact"
                audioOnly={current.call.kind === "voice"}
                videoOff={
                  current.call.callerId === messaging.device?.accountId
                    ? current.call.calleeCameraOff && !current.call.calleeSharing
                    : current.call.callerCameraOff && !current.call.callerSharing
                }
              />
            ) : (
              <div className="call-avatar">
                {current.call.kind === "video" ? <Video size={46} /> : <Phone size={46} />}
              </div>
            )}
            {local && current.call.kind === "video" ? (
              <StreamVideo
                stream={screen ?? local}
                muted
                sharing={Boolean(screen)}
                videoOff={cameraOff && !screen}
                label={screen ? "Your shared screen" : "Your camera preview"}
              />
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
                      mutedRef.current = next;
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
                    disabled={Boolean(screen) || screenBusy}
                    type="button"
                    onClick={() => {
                      const next = !cameraOff;
                      cameraOffRef.current = next;
                      streamRef.current?.getVideoTracks().forEach((t) => {
                        t.enabled = !next;
                      });
                      setCameraOff(next);
                      lastHeartbeat.current = 0;
                    }}
                  >
                    {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
                    <span>{cameraOff ? "Camera on" : "Camera off"}</span>
                  </button>
                ) : null}
                {local &&
                current.call.kind === "video" &&
                current.phase === "connected" &&
                typeof navigator.mediaDevices?.getDisplayMedia === "function" ? (
                  <button
                    className="call-control"
                    type="button"
                    aria-pressed={Boolean(screen)}
                    disabled={screenBusy}
                    onClick={(event) =>
                      void shareScreen(event.currentTarget.ownerDocument.defaultView)
                    }
                  >
                    {screen ? <MonitorX size={22} /> : <MonitorUp size={22} />}
                    <span>
                      {screen ? "Stop sharing" : screenBusy ? "Choosing…" : "Share screen"}
                    </span>
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
          <details className="call-more">
            <summary>More options</summary>
            {local ? (
              <CallDeviceSettings
                stream={local}
                video={current.call.kind === "video"}
                sharing={Boolean(screen)}
                onInputChange={changeInput}
              />
            ) : null}
            <p className="call-note">
              {typeof navigator.mediaDevices?.getDisplayMedia !== "function"
                ? "This browser can view shared screens but cannot start a screen share. "
                : ""}
              {screen ? "You’re sharing your screen. " : ""}
              Camera up to 720p at 30 fps. Screen sharing up to 720p at 60 fps. Quality adjusts to
              your connection.{" "}
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
          </details>
        </CallWindow>
      ) : null}
    </Context.Provider>
  );
}
export function useCalls() {
  const value = useContext(Context);
  if (!value) throw new Error("Calls require CallProvider");
  return value;
}
