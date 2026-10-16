"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Phone,
  PhoneOff,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { useMessagingDevice } from "./messaging-device-provider";
import { CallWindow } from "./call-window";
import { CallMediaView } from "./call-media-view";
import { CallDeviceSettings, useCallDevices } from "./call-devices";
import { callInputConstraints, switchCallInput } from "@/lib/messaging/call-input";
import { classifyDeviceTrust } from "@/crypto/src/protocol";
import { fetchConversationDevices } from "@/lib/messaging/api-client";
import {
  chooseCallScreen,
  constrainCallScreen,
  limitCallSenders,
  preferSpeechCodec,
  screenShareError,
} from "@/lib/messaging/call-media";
import { fallbackIceServers, maxCallDurationMs } from "@/lib/messaging/call-policy";
import { gatherCallDescription } from "@/lib/messaging/call-ice";
import {
  signGroupCallDescription,
  verifyGroupCallDescription,
} from "@/lib/messaging/group-call-signatures";
import type { CallConfiguration, CallKind } from "@/lib/messaging/call-types";
import type {
  GroupCallDescription,
  GroupCallLink,
  GroupCallSnapshot,
} from "@/lib/messaging/group-call-types";

type Current = {
  room: GroupCallSnapshot | null;
  name: string;
  phase: "incoming" | "preparing" | "joined";
  resume?: boolean;
};
type Peer = {
  id: string;
  userId: string;
  deviceId: string;
  pc: RTCPeerConnection;
  stream: MediaStream;
  state: "connecting" | "connected" | "failed";
  busy: boolean;
  sent: boolean;
  sends: Promise<void>;
  timer: ReturnType<typeof setTimeout> | null;
  disconnect: ReturnType<typeof setTimeout> | null;
};
const Context = createContext<{
  active: boolean;
  start: (id: string, name: string, kind: CallKind, roomId?: string) => Promise<void>;
} | null>(null);
async function request<T>(url: string, body?: object, keepalive = false): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
    keepalive,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      response.status === 409 && typeof result?.message === "string"
        ? result.message
        : response.status === 403 &&
            result?.message === "Join the next group call. This call started before you were added."
          ? result.message
          : response.status === 403 || response.status === 401
            ? "Your call access changed. Check your account and device approval."
            : response.status === 404 || response.status === 410
              ? "This call is no longer available."
              : response.status === 429
                ? "Call connections are busy. Please wait before trying again."
                : "We couldn’t connect the group call. Please try again.",
    );
  return result as T;
}
function safeError(error: unknown, fallback: string) {
  return error instanceof Error &&
    /^(?:Compare |Allow |Approve |Join the next group call\.|Your call |Call connections |The call |This call |You’re already |A group member |We couldn’t |Calls aren’t |Finish |An? (?:audio|voice|video) group call)/.test(
      error.message,
    )
    ? error.message
    : fallback;
}
function MediaTile({
  stream,
  name,
  audioOnly,
  local = false,
  status,
  sharing = false,
  cameraOff = false,
}: {
  stream: MediaStream | null;
  name: string;
  audioOnly: boolean;
  local?: boolean;
  status: string;
  sharing?: boolean;
  cameraOff?: boolean;
}) {
  const [pinned, setPinned] = useState(false);
  return (
    <div
      className={`group-call-tile${sharing ? " group-call-tile--sharing" : ""}${pinned ? " group-call-tile--pinned" : ""}`}
    >
      <CallMediaView
        stream={stream}
        muted={local}
        label={sharing ? `${name}'s shared screen` : name}
        audioOnly={audioOnly}
        videoOff={cameraOff && !sharing}
      />
      <div className="group-call-tile__caption">
        <strong>{name}</strong>
        <span>{sharing ? "Sharing screen" : status}</span>
        {!audioOnly ? (
          <button
            type="button"
            className="group-call-pin"
            aria-pressed={pinned}
            onClick={() => setPinned(!pinned)}
          >
            {pinned ? "Unpin" : "Pin"}
            <span className="sr-only"> {name}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
export function GroupCallProvider({ children }: { children: ReactNode }) {
  const devices = useCallDevices();
  const messaging = useMessagingDevice();
  const messagingRef = useRef(messaging);
  messagingRef.current = messaging;
  const [current, setCurrent] = useState<Current | null>(null);
  const currentRef = useRef<Current | null>(null);
  const [message, setMessage] = useState("");
  const [policy, setPolicy] = useState<RTCIceTransportPolicy | null>(null);
  const [fallback, setFallback] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const screenPending = useRef(false);
  const [screenBusy, setScreenBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [cameraOff, setCameraOff] = useState(false);
  const cameraOffRef = useRef(false);
  const [peersView, setPeersView] = useState<Peer[]>([]);
  const peers = useRef(new Map<string, Peer>());
  const configuration = useRef<CallConfiguration | null>(null);
  const generation = useRef(0);
  const instance = useRef("");
  const mediaPending = useRef(false);
  const polling = useRef(false);
  const ignored = useRef("");
  const heartbeatAt = useRef(0);
  const lastSignal = useRef(0);
  const allowed = useRef<boolean | null>(null);
  const directoryAt = useRef(0);
  const trustedDirectory = useRef<Awaited<ReturnType<typeof classifyDeviceTrust>>>([]);
  const budgetPeers = useRef(0);
  const refreshView = () => setPeersView([...peers.current.values()]);
  function update(value: Current | null) {
    currentRef.current = value;
    setCurrent(value);
  }
  function busy() {
    document.documentElement.dataset.liveCall = "group";
    window.dispatchEvent(new CustomEvent("untold-call-active", { detail: true }));
  }
  function closePeer(peer: Peer) {
    if (peer.timer) clearTimeout(peer.timer);
    if (peer.disconnect) clearTimeout(peer.disconnect);
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.stream.getTracks().forEach((track) => {
      track.stop();
    });
  }
  function cleanup() {
    generation.current++;
    for (const p of peers.current.values()) closePeer(p);
    peers.current.clear();
    setPeersView([]);
    stream.current?.getTracks().forEach((track) => {
      track.stop();
    });
    stream.current = null;
    setLocal(null);
    screenRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    screenRef.current = null;
    setScreen(null);
    configuration.current = null;
    setPolicy(null);
    setFallback(false);
    mutedRef.current = false;
    setMuted(false);
    cameraOffRef.current = false;
    setCameraOff(false);
    setScreenBusy(false);
    setMinimized(false);
    heartbeatAt.current = 0;
    lastSignal.current = 0;
    budgetPeers.current = 0;
    trustedDirectory.current = [];
    directoryAt.current = 0;
    update(null);
    if (document.documentElement.dataset.liveCall === "group") {
      delete document.documentElement.dataset.liveCall;
      window.dispatchEvent(new CustomEvent("untold-call-active", { detail: false }));
    }
  }
  function action(actionName: string, roomId: string, extra: object = {}, keepalive = false) {
    return request<{ room: GroupCallSnapshot | null; enabled: boolean }>(
      "/api/group-calls",
      {
        action: actionName,
        id: roomId,
        deviceId: messagingRef.current.device?.deviceId,
        instanceId: instance.current,
        ...extra,
      },
      keepalive,
    ).then((result) => {
      window.dispatchEvent(new Event("untold-call-history-refresh"));
      return result;
    });
  }
  async function leave(note = "You left the group call", decline = false) {
    const room = currentRef.current?.room;
    const ownInstance = currentRef.current?.resume
      ? room?.participants.find((p) => p.userId === messagingRef.current.device?.accountId)
          ?.instanceId
      : instance.current;
    if (room) ignored.current = room.id;
    cleanup();
    setMessage(note);
    if (room)
      await action(decline ? "decline" : "leave", room.id, { instanceId: ownInstance }).catch(
        () => {},
      );
  }
  function peerCount() {
    const me = messagingRef.current.device?.accountId;
    return Math.max(
      1,
      currentRef.current?.room?.participants.filter((p) => p.status === "joined" && p.userId !== me)
        .length ?? 1,
    );
  }
  function sendWork(peer: Peer, task: () => Promise<void>) {
    const next = peer.sends
      .catch(() => {})
      .then(async () => {
        if (peers.current.get(peer.id) !== peer || peer.pc.signalingState === "closed") return;
        await task();
      });
    peer.sends = next;
    return next;
  }
  function limit(peer: Peer) {
    return sendWork(peer, () => limitCallSenders(peer.pc, Boolean(screenRef.current), peerCount()));
  }
  async function loadDirectory(room: GroupCallSnapshot, token: number) {
    const localDevice = messagingRef.current.device;
    if (!localDevice) throw new Error("Approve this device in Settings before calling.");
    const raw = await fetchConversationDevices(room.conversationId);
    const directory = await classifyDeviceTrust(localDevice.accountId, raw);
    if (token !== generation.current) throw new Error("Call cancelled");
    trustedDirectory.current = directory;
    directoryAt.current = Date.now();
    return directory;
  }
  async function verify(
    d: GroupCallDescription,
    room: GroupCallSnapshot,
    link: GroupCallLink,
    peer: Peer,
    token: number,
  ) {
    const me = messagingRef.current.device;
    if (!me) throw new Error("Approve this device in Settings before calling.");
    if (Date.now() - directoryAt.current > 15_000) await loadDirectory(room, token);
    const device = trustedDirectory.current.find(
      (p) =>
        p.userId === peer.userId &&
        p.deviceId === peer.deviceId &&
        p.approved &&
        !p.revoked &&
        p.trust === "verified" &&
        p.conversationMember !== false,
    );
    if (
      !device ||
      d.roomId !== room.id ||
      d.linkId !== link.id ||
      d.conversationId !== room.conversationId ||
      d.kind !== room.kind ||
      d.type !== (d.senderId === link.lowerUserId ? "offer" : "answer") ||
      d.senderId !== peer.userId ||
      d.deviceId !== peer.deviceId ||
      d.targetUserId !== me.accountId ||
      d.targetDeviceId !== me.deviceId ||
      !(await verifyGroupCallDescription(d, device))
    )
      throw new Error("Compare group members’ safety codes in Details before calling.");
    if (token !== generation.current) throw new Error("Call cancelled");
  }
  function failPeer(peer: Peer, note = "Connection lost. Leave and rejoin to reconnect.") {
    if (peers.current.get(peer.id) !== peer) return;
    closePeer(peer);
    peer.state = "failed";
    refreshView();
    setMessage(note);
  }
  function createPeer(link: GroupCallLink, peerId: string, deviceId: string) {
    const config = configuration.current;
    if (!config || !stream.current) throw new Error("Call cancelled");
    const pc = new RTCPeerConnection({
      iceServers: config.iceServers,
      iceTransportPolicy: config.iceTransportPolicy,
      bundlePolicy: "max-bundle",
    });
    const peer: Peer = {
      id: link.id,
      userId: peerId,
      deviceId,
      pc,
      stream: new MediaStream(),
      state: "connecting",
      busy: false,
      sent: false,
      sends: Promise.resolve(),
      timer: null,
      disconnect: null,
    };
    peers.current.set(link.id, peer);
    for (const track of stream.current.getTracks()) {
      const source =
        track.kind === "video" ? (screenRef.current?.getVideoTracks()[0] ?? track) : track;
      pc.addTrack(
        source,
        source.kind === "video" && screenRef.current ? screenRef.current : stream.current,
      );
    }
    try {
      preferSpeechCodec(pc);
    } catch {
      closePeer(peer);
      peers.current.delete(link.id);
      throw new Error("Call setup unavailable");
    }
    pc.ontrack = (event) => {
      peer.stream.addTrack(event.track);
      refreshView();
    };
    pc.onconnectionstatechange = () => {
      if (peers.current.get(peer.id) !== peer) return;
      if (pc.connectionState === "connected") {
        void limit(peer).catch(() =>
          failPeer(
            peer,
            "This browser couldn’t prepare the connection. Please rejoin from an up-to-date browser.",
          ),
        );
        if (peer.timer) clearTimeout(peer.timer);
        if (peer.disconnect) clearTimeout(peer.disconnect);
        peer.state = "connected";
        heartbeatAt.current = 0;
        refreshView();
      } else if (pc.connectionState === "failed") failPeer(peer);
      else if (pc.connectionState === "disconnected") {
        peer.state = "connecting";
        refreshView();
        if (peer.disconnect) clearTimeout(peer.disconnect);
        peer.disconnect = setTimeout(() => {
          if (pc.connectionState !== "connected") failPeer(peer);
        }, 15_000);
      }
    };
    peer.timer = setTimeout(() => {
      if (peer.state !== "connected")
        failPeer(peer, "One person couldn’t connect. Leave and rejoin to try again.");
    }, 55_000);
    refreshView();
    return peer;
  }
  async function exchange(peer: Peer, link: GroupCallLink, room: GroupCallSnapshot, token: number) {
    if (peer.busy || peer.state === "failed") return;
    peer.busy = true;
    try {
      const me = messagingRef.current.device;
      if (!me) return;
      const pc = peer.pc;
      const fields = {
        roomId: room.id,
        linkId: link.id,
        conversationId: room.conversationId,
        targetUserId: peer.userId,
        targetDeviceId: peer.deviceId,
        kind: room.kind,
      };
      const isCurrent = () => token === generation.current && peers.current.get(peer.id) === peer;
      if (link.lowerUserId === me.accountId) {
        if (!peer.sent) {
          await pc.setLocalDescription(await pc.createOffer());
          await limit(peer);
          const description = await signGroupCallDescription(
            me,
            fields,
            await gatherCallDescription(pc, isCurrent),
          );
          if (!isCurrent()) return;
          await action("signal", room.id, { description });
          if (!isCurrent()) return;
          peer.sent = true;
        }
        if (link.answer && !pc.remoteDescription) {
          await verify(link.answer, room, link, peer, token);
          if (!isCurrent()) return;
          await pc.setRemoteDescription({ type: "answer", sdp: link.answer.sdp });
          await limit(peer);
        }
      } else if (link.offer && !peer.sent) {
        await verify(link.offer, room, link, peer, token);
        if (!isCurrent()) return;
        await pc.setRemoteDescription({ type: "offer", sdp: link.offer.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await limit(peer);
        const description = await signGroupCallDescription(
          me,
          fields,
          await gatherCallDescription(pc, isCurrent),
        );
        if (!isCurrent()) return;
        await action("signal", room.id, { description });
        if (!isCurrent()) return;
        peer.sent = true;
      }
    } catch (error) {
      if (token === generation.current && peers.current.get(peer.id) === peer)
        failPeer(
          peer,
          safeError(
            error,
            "One connection couldn’t start. Leave and rejoin the call to try again.",
          ),
        );
    } finally {
      peer.busy = false;
    }
  }
  function reconcile(room: GroupCallSnapshot) {
    const me = messagingRef.current.device;
    if (!me || currentRef.current?.phase !== "joined") return;
    const token = generation.current;
    for (const [id, peer] of peers.current) {
      if (
        !room.links.some((link) => link.id === id) ||
        !room.participants.some(
          (p) => p.userId === peer.userId && p.deviceId === peer.deviceId && p.status === "joined",
        )
      ) {
        closePeer(peer);
        peers.current.delete(id);
        refreshView();
      }
    }
    for (const link of room.links) {
      const id = link.lowerUserId === me.accountId ? link.upperUserId : link.lowerUserId;
      const participant = room.participants.find((p) => p.userId === id && p.status === "joined");
      if (!participant?.deviceId) continue;
      const trusted = trustedDirectory.current.some(
        (d) =>
          d.userId === id &&
          d.deviceId === participant.deviceId &&
          d.approved &&
          !d.revoked &&
          d.trust === "verified" &&
          d.conversationMember !== false,
      );
      if (!trusted) {
        setMessage("Compare group members’ safety codes in Details before calling.");
        continue;
      }
      const peer = peers.current.get(link.id) ?? createPeer(link, id, participant.deviceId);
      void exchange(peer, link, room, token);
    }
    const count = peerCount();
    if (budgetPeers.current !== count) {
      budgetPeers.current = count;
      for (const peer of peers.current.values())
        if (peer.pc.signalingState === "stable") void limit(peer).catch(() => failPeer(peer));
    }
  }
  async function ice(deviceId: string, token: number): Promise<CallConfiguration> {
    const response = await fetch(`/api/ice?deviceId=${encodeURIComponent(deviceId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(25_000),
    });
    const body = await response.json().catch(() => null);
    if (token !== generation.current) throw new Error("Call cancelled");
    const mode = response.headers.get("X-Untold-ICE-Policy") === "all" ? "all" : "relay";
    setPolicy(mode);
    if (
      (response.status === 429 || response.status === 503) &&
      body?.code === "relay_unavailable" &&
      mode === "all"
    ) {
      setFallback(true);
      return { enabled: true, iceServers: fallbackIceServers, iceTransportPolicy: mode };
    }
    if (!response.ok || !Array.isArray(body) || !body.length || body.length > 16)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Your call access changed. Check your account and device approval."
          : "The call connection service is unavailable. Please try again later.",
      );
    return { enabled: true, iceServers: body as RTCIceServer[], iceTransportPolicy: mode };
  }
  async function join(
    conversationId: string,
    name: string,
    kind: CallKind,
    incoming?: GroupCallSnapshot,
    expectedRoomId?: string,
  ) {
    if (
      document.documentElement.dataset.liveCall === "direct" ||
      (currentRef.current && currentRef.current.phase !== "incoming")
    )
      return;
    if (document.documentElement.dataset.voiceRecording === "true") {
      setMessage("Finish or discard your voice recording before joining.");
      return;
    }
    const me = messagingRef.current.device;
    if (!me || !messagingRef.current.approved) return;
    if (mediaPending.current || document.documentElement.dataset.callMediaPending) {
      setMessage("Finish the microphone permission request before trying again.");
      return;
    }
    busy();
    setMessage("");
    setMinimized(false);
    update({ room: incoming ?? null, name, phase: "preparing" });
    const token = ++generation.current;
    const joinInstance = crypto.randomUUID();
    instance.current = joinInstance;
    let joinedRoom: GroupCallSnapshot | null = null;
    let acquired: MediaStream | null = null;
    try {
      const found =
        incoming ??
        (
          await request<{ room: GroupCallSnapshot | null }>(
            `/api/group-calls?deviceId=${encodeURIComponent(me.deviceId)}&conversationId=${encodeURIComponent(conversationId)}${expectedRoomId ? `&id=${encodeURIComponent(expectedRoomId)}` : ""}`,
          )
        ).room;
      if (token !== generation.current) return;
      if (expectedRoomId && (!found || found.id !== expectedRoomId || found.status !== "active"))
        throw new Error("This call has ended. Start a new call from the group chat.");
      const actualKind = found?.kind ?? kind;
      const raw = await fetchConversationDevices(conversationId);
      const directory = await classifyDeviceTrust(me.accountId, raw);
      if (token !== generation.current) return;
      if (
        directory.some(
          (d) =>
            d.userId !== me.accountId &&
            d.conversationMember !== false &&
            d.approved &&
            !d.revoked &&
            d.trust !== "verified",
        )
      )
        throw new Error("Compare group members’ safety codes in Details before calling.");
      trustedDirectory.current = directory;
      directoryAt.current = Date.now();
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined")
        throw new Error();
      mediaPending.current = true;
      document.documentElement.dataset.callMediaPending = "group";
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          audio: callInputConstraints("audio", devices.preferencesRef.current.microphone),
          video:
            actualKind === "video"
              ? callInputConstraints("video", devices.preferencesRef.current.camera)
              : false,
        });
      } catch {
        throw new Error(
          actualKind === "video"
            ? "Allow camera and microphone access to join the video call."
            : "Allow microphone access to join the call.",
        );
      } finally {
        mediaPending.current = false;
        if (document.documentElement.dataset.callMediaPending === "group")
          delete document.documentElement.dataset.callMediaPending;
      }
      if (token !== generation.current || document.visibilityState !== "visible") return;
      stream.current = acquired;
      setLocal(acquired);
      configuration.current = await ice(me.deviceId, token);
      if (token !== generation.current) return;
      const result = found
        ? await action("join", found.id, { instanceId: joinInstance })
        : await request<{ room: GroupCallSnapshot | null }>("/api/group-calls", {
            action: "start",
            conversationId,
            deviceId: me.deviceId,
            instanceId: joinInstance,
            kind: actualKind,
          });
      joinedRoom = result.room;
      if (token !== generation.current) {
        if (joinedRoom)
          await action("leave", joinedRoom.id, { instanceId: joinInstance }).catch(() => {});
        return;
      }
      if (joinedRoom?.status !== "active") throw new Error("This call has ended.");
      lastSignal.current = Date.now();
      update({ room: joinedRoom, name: joinedRoom.name, phase: "joined" });
      reconcile(joinedRoom);
    } catch (error) {
      if (token === generation.current) {
        cleanup();
        setMessage(safeError(error, "We couldn’t join the group call. Please try again."));
      }
      if (joinedRoom)
        await action("leave", joinedRoom.id, { instanceId: joinInstance }).catch(() => {});
    } finally {
      if (acquired && stream.current !== acquired)
        acquired.getTracks().forEach((track) => {
          track.stop();
        });
      if (token === generation.current && currentRef.current?.phase === "preparing") cleanup();
    }
  }
  async function changeInput(kind: "audio" | "video", id: string) {
    const token = generation.current;
    if (screenPending.current) throw new Error("Wait for screen selection to finish");
    if (kind === "video" && screenRef.current)
      throw new Error("Stop sharing before changing camera");
    await switchCallInput(kind, id, {
      getStream: () => stream.current,
      setStream: (next) => {
        stream.current = next;
        setLocal(next);
      },
      isCurrent: () => token === generation.current && currentRef.current?.phase === "joined",
      enabled: () => (kind === "audio" ? !mutedRef.current : !cameraOffRef.current),
      targets: () =>
        [...peers.current.values()]
          .filter((peer) => peer.state !== "failed")
          .map((peer) => ({
            replace: (track) =>
              sendWork(peer, async () => {
                const sender = peer.pc.getSenders().find((s) => s.track?.kind === kind);
                if (!sender) throw new Error("Call sender unavailable");
                await sender.replaceTrack(track);
                await limitCallSenders(peer.pc, Boolean(screenRef.current), peerCount());
              }),
            disconnect: () =>
              failPeer(peer, "The device couldn’t switch for one person. Rejoin to reconnect."),
          })),
    });
  }
  async function stopScreen() {
    const capture = screenRef.current;
    if (!capture) return;
    screenRef.current = null;
    setScreen(null);
    capture.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    const camera = stream.current?.getVideoTracks()[0] ?? null;
    if (camera) camera.enabled = !cameraOffRef.current;
    await Promise.all(
      [...peers.current.values()]
        .filter((p) => p.state !== "failed")
        .map((peer) =>
          sendWork(peer, async () => {
            const sender = peer.pc.getSenders().find((s) => s.track?.kind === "video");
            if (sender) await sender.replaceTrack(camera);
            await limitCallSenders(peer.pc, false, peerCount());
          }).catch(() => failPeer(peer)),
        ),
    );
    heartbeatAt.current = 0;
  }
  async function shareScreen(context: Window | null) {
    if (screenPending.current || currentRef.current?.phase !== "joined") return;
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
      setMessage("This browser can watch shared screens but can’t share one.");
      return;
    }
    if (document.documentElement.dataset.callMediaPending === "switch") {
      setMessage("Wait for the device change to finish before sharing your screen.");
      return;
    }
    screenPending.current = true;
    setScreenBusy(true);
    const token = generation.current;
    let capture: MediaStream | null = null;
    try {
      capture = await chooseCallScreen(context ?? window);
      const track = await constrainCallScreen(capture);
      if (token !== generation.current) return;
      if (track.readyState !== "live") return;
      screenRef.current = capture;
      track.onended = () => void stopScreen();
      await Promise.all(
        [...peers.current.values()]
          .filter((p) => p.state !== "failed")
          .map((peer) =>
            sendWork(peer, async () => {
              const sender = peer.pc.getSenders().find((s) => s.track?.kind === "video");
              if (!sender) throw new Error("Video sender unavailable");
              await sender.replaceTrack(track);
              await limitCallSenders(peer.pc, true, peerCount());
            }),
          ),
      );
      if (token !== generation.current || screenRef.current !== capture) return;
      stream.current?.getVideoTracks().forEach((camera) => {
        camera.enabled = false;
      });
      setScreen(capture);
      heartbeatAt.current = 0;
    } catch (error) {
      if (token === generation.current) {
        await stopScreen();
        setMessage(screenShareError(error));
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
  const pollRef = useRef<() => Promise<void>>(async () => {});
  pollRef.current = async () => {
    const me = messagingRef.current.device;
    const mine = currentRef.current;
    if (
      !me ||
      !messagingRef.current.approved ||
      polling.current ||
      mine?.phase === "preparing" ||
      document.documentElement.dataset.liveCall === "direct" ||
      (!mine && document.visibilityState !== "visible")
    )
      return;
    const token = generation.current;
    polling.current = true;
    try {
      const result = await request<{ room: GroupCallSnapshot | null; enabled: boolean }>(
        `/api/group-calls?deviceId=${encodeURIComponent(me.deviceId)}&instanceId=${encodeURIComponent(instance.current)}${mine?.room ? `&id=${mine.room.id}` : ""}`,
      );
      if (
        token !== generation.current ||
        messagingRef.current.device?.deviceId !== me.deviceId ||
        document.documentElement.dataset.liveCall === "direct"
      )
        return;
      allowed.current = result.enabled;
      const room = result.room;
      lastSignal.current = Date.now();
      if (mine) {
        const own = room?.participants.find((p) => p.userId === me.accountId);
        if (
          !room ||
          room.status === "ended" ||
          !own ||
          (mine.phase === "joined" &&
            (own.status !== "joined" ||
              own.deviceId !== me.deviceId ||
              own.instanceId !== instance.current))
        ) {
          cleanup();
          setMessage("Group call ended or was opened in another window or device");
          return;
        }
        if (
          mine.phase === "incoming" &&
          own.status !== "invited" &&
          !(mine.resume && own.status === "joined" && own.deviceId === me.deviceId)
        ) {
          cleanup();
          return;
        }
        update({ ...mine, room, name: room.name });
        if (mine.phase === "joined") {
          if (Date.now() - heartbeatAt.current >= 10_000) {
            heartbeatAt.current = Date.now();
            await action("heartbeat", room.id, {
              sharing: Boolean(screenRef.current),
              muted: mutedRef.current,
              cameraOff: cameraOffRef.current,
              connected: [...peers.current.values()].some(
                (peer) => peer.pc.connectionState === "connected",
              ),
            });
          }
          if (Date.now() - directoryAt.current > 15_000) await loadDirectory(room, token);
          if (token !== generation.current) return;
          for (const peer of peers.current.values())
            if (
              !trustedDirectory.current.some(
                (d) =>
                  d.userId === peer.userId &&
                  d.deviceId === peer.deviceId &&
                  d.trust === "verified" &&
                  d.approved &&
                  !d.revoked &&
                  d.conversationMember !== false,
              )
            )
              failPeer(peer, "A member’s safety code changed. Check Details before rejoining.");
          reconcile(room);
        }
      } else if (
        room &&
        room.id !== ignored.current &&
        room.status === "active" &&
        room.participants.some(
          (p) => p.userId === me.accountId && p.status === "joined" && p.deviceId === me.deviceId,
        )
      ) {
        busy();
        setMessage("");
        setMinimized(false);
        update({ room, name: room.name, phase: "incoming", resume: true });
      } else if (
        room &&
        room.id !== ignored.current &&
        room.status === "active" &&
        room.participants.some((p) => p.userId === me.accountId && p.status === "invited") &&
        Date.parse(room.ringUntil) > Date.now()
      ) {
        busy();
        setMessage("");
        setMinimized(false);
        update({ room, name: room.name, phase: "incoming" });
      }
    } catch (error) {
      if (
        token === generation.current &&
        mine &&
        error instanceof Error &&
        /^(?:Your call access|This call)/.test(error.message)
      )
        await leave(error.message);
    } finally {
      polling.current = false;
    }
  };
  useEffect(() => {
    if (!messaging.device?.deviceId || !messaging.approved) return;
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      if (currentRef.current || tick % (allowed.current === false ? 24 : 3) === 0)
        void pollRef.current();
    }, 2500);
    const visible = () => void pollRef.current();
    const pushed = (event: MessageEvent) => {
      if (event.data?.type === "untold-call-available") void pollRef.current();
    };
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: Resources and actions read current refs; device changes tear them down.
  useEffect(() => {
    const exit = () => {
      const room = currentRef.current?.phase === "joined" ? currentRef.current.room : null;
      if (room) void action("leave", room.id, {}, true).catch(() => {});
      cleanup();
    };
    window.addEventListener("pagehide", exit);
    return () => {
      window.removeEventListener("pagehide", exit);
      exit();
    };
  }, [messaging.device?.deviceId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Approval changes end a call through current refs.
  useEffect(() => {
    if (!messaging.approved && currentRef.current) void leave("Your call access changed.");
  }, [messaging.approved]);
  const active = Boolean(current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The expiry timer reads live refs.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const now = currentRef.current;
      if (!now?.room || now.phase === "preparing") return;
      if (now.phase === "incoming" && !now.resume && Date.parse(now.room.ringUntil) <= Date.now()) {
        cleanup();
        return;
      }
      if (
        Date.parse(now.room.expiresAt) <= Date.now() ||
        Date.now() - Date.parse(now.room.createdAt) >= maxCallDurationMs ||
        (lastSignal.current && Date.now() - lastSignal.current >= 60_000)
      )
        void leave("Group call ended. Start a new call to reconnect.");
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  const joined = current?.room?.participants.filter((p) => p.status === "joined") ?? [];
  const me = messaging.device?.accountId;
  return (
    <Context.Provider
      value={{ active, start: (id, name, kind, roomId) => join(id, name, kind, undefined, roomId) }}
    >
      {children}
      {!current && message ? (
        <div className="call-toast" role="status">
          <span>{message}</span>
          <button type="button" aria-label="Dismiss call status" onClick={() => setMessage("")}>
            <X size={16} />
          </button>
        </div>
      ) : null}
      {current ? (
        <CallWindow
          title={`Group call: ${current.name}`}
          group
          live={current.phase === "joined"}
          minimized={minimized}
          onMinimize={setMinimized}
          muted={muted}
          onEnd={() =>
            void leave("You left the group call", current.phase === "incoming" && !current.resume)
          }
          onMute={
            local
              ? () => {
                  const next = !mutedRef.current;
                  mutedRef.current = next;
                  stream.current?.getAudioTracks().forEach((track) => {
                    track.enabled = !next;
                  });
                  setMuted(next);
                  heartbeatAt.current = 0;
                }
              : undefined
          }
        >
          <h2>{current.name}</h2>
          <p className="call-phase" role="status">
            {current.phase === "preparing"
              ? "Getting ready…"
              : current.phase === "incoming"
                ? current.resume
                  ? "Rejoin your call"
                  : "You’re invited"
                : joined.length < 2
                  ? "Waiting for others to join…"
                  : `${joined.length} people in this call`}
          </p>
          {message || devices.blocked ? (
            <p className="call-window__message" role="status">
              {devices.blocked
                ? devices.error || "Choose an audio output in More options to hear the call."
                : message}
            </p>
          ) : null}
          <div className="group-call-grid">
            {current.phase === "joined" ? (
              joined.map((person) => {
                const own = person.userId === me;
                const peer = peersView.find((p) => p.userId === person.userId);
                return (
                  <MediaTile
                    key={person.userId}
                    stream={own ? (screen ?? local) : (peer?.stream ?? null)}
                    name={own ? "You" : person.name}
                    local={own}
                    audioOnly={current.room?.kind === "voice"}
                    sharing={own ? Boolean(screen) : person.sharing}
                    cameraOff={own ? cameraOff : person.cameraOff}
                    status={
                      own
                        ? muted
                          ? "Microphone muted"
                          : cameraOff
                            ? "Camera off"
                            : "Connected"
                        : peer?.state === "connected"
                          ? person.muted
                            ? "Microphone muted"
                            : person.cameraOff
                              ? "Camera off"
                              : "Connected"
                          : peer?.state === "failed"
                            ? "Couldn’t connect"
                            : "Connecting…"
                    }
                  />
                );
              })
            ) : (
              <div className="call-avatar">
                <Users size={48} />
              </div>
            )}
          </div>
          <div className="call-controls">
            {current.phase === "incoming" && current.room ? (
              <button
                type="button"
                className="call-control call-control--accept"
                onClick={() => {
                  const room = currentRef.current?.room;
                  if (room) void join(room.conversationId, room.name, room.kind, room);
                }}
              >
                <Phone size={22} />
                <span>{current.resume ? "Rejoin call" : "Join call"}</span>
              </button>
            ) : null}
            {current.phase === "joined" ? (
              <>
                <button
                  type="button"
                  className="call-control"
                  aria-pressed={muted}
                  onClick={() => {
                    mutedRef.current = !mutedRef.current;
                    stream.current?.getAudioTracks().forEach((t) => {
                      t.enabled = !mutedRef.current;
                    });
                    setMuted(mutedRef.current);
                    heartbeatAt.current = 0;
                  }}
                >
                  {muted ? <MicOff size={22} /> : <Mic size={22} />}
                  <span>{muted ? "Unmute" : "Mute"}</span>
                </button>
                {current.room?.kind === "video" ? (
                  <>
                    <button
                      type="button"
                      className="call-control"
                      disabled={Boolean(screen) || screenBusy}
                      aria-pressed={cameraOff}
                      onClick={() => {
                        cameraOffRef.current = !cameraOffRef.current;
                        stream.current?.getVideoTracks().forEach((t) => {
                          t.enabled = !cameraOffRef.current;
                        });
                        setCameraOff(cameraOffRef.current);
                        heartbeatAt.current = 0;
                      }}
                    >
                      {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
                      <span>{cameraOff ? "Camera on" : "Camera off"}</span>
                    </button>
                    {typeof navigator.mediaDevices?.getDisplayMedia === "function" ? (
                      <button
                        type="button"
                        className="call-control"
                        disabled={screenBusy}
                        aria-pressed={Boolean(screen)}
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
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              className="call-control call-control--end"
              onClick={() =>
                void leave(
                  current.phase === "incoming" && !current.resume
                    ? "Group call declined"
                    : "You left the group call",
                  current.phase === "incoming" && !current.resume,
                )
              }
            >
              <PhoneOff size={22} />
              <span>
                {current.phase === "incoming" && !current.resume ? "Decline" : "Leave call"}
              </span>
            </button>
          </div>
          <details className="call-more">
            <summary>More options</summary>
            {local && current.phase === "joined" ? (
              <CallDeviceSettings
                stream={local}
                video={current.room?.kind === "video"}
                sharing={Boolean(screen)}
                onInputChange={changeInput}
              />
            ) : null}
            <p className="call-note">
              {typeof navigator.mediaDevices?.getDisplayMedia !== "function"
                ? "This browser can view shared screens but cannot start a screen share. "
                : ""}
              {screen ? "You’re sharing your screen. " : ""}
              {fallback ? "Trying direct connections. They may not work on every network. " : ""}
              {policy === "all"
                ? "Direct connections can share your network address with other participants. "
                : policy === "relay"
                  ? "Direct connections are disabled. "
                  : ""}
              Camera up to 720p at 30 fps. Screen sharing up to 720p at 60 fps. Quality adjusts to
              your connection and group size. Keep Untold open. Calls can last up to 55 minutes.
            </p>
          </details>
        </CallWindow>
      ) : null}
    </Context.Provider>
  );
}
export function useGroupCalls() {
  const context = useContext(Context);
  if (!context) throw new Error("Group calls require GroupCallProvider");
  return context;
}
