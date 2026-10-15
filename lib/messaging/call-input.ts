import { callMedia } from "./call-media";
type Target = { replace: (track: MediaStreamTrack) => Promise<void>; disconnect: () => void };
export function callInputConstraints(
  kind: "audio" | "video",
  deviceId: string,
): MediaTrackConstraints {
  return {
    ...(kind === "audio" ? callMedia.audio : callMedia.camera),
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}
export async function switchCallInput(
  kind: "audio" | "video",
  deviceId: string,
  options: {
    getStream: () => MediaStream | null;
    setStream: (stream: MediaStream) => void;
    isCurrent: () => boolean;
    enabled: () => boolean;
    targets: () => Target[];
  },
) {
  const original = options.getStream();
  const oldTrack = original?.getTracks().find((track) => track.kind === kind);
  if (!original || !oldTrack || !options.isCurrent()) throw new Error("Call cancelled");
  if (document.documentElement.dataset.callMediaPending)
    throw new Error("Media permission request pending");
  document.documentElement.dataset.callMediaPending = "switch";
  let acquired: MediaStream | null = null;
  let committed = false;
  try {
    const constraints = callInputConstraints(kind, deviceId);
    acquired = await navigator.mediaDevices.getUserMedia({
      audio: kind === "audio" ? constraints : false,
      video: kind === "video" ? constraints : false,
    });
    const track = acquired.getTracks().find((candidate) => candidate.kind === kind);
    if (!track || !options.isCurrent() || options.getStream() !== original)
      throw new Error("Call cancelled");
    track.enabled = options.enabled();
    const next = new MediaStream([
      ...original.getTracks().filter((candidate) => candidate !== oldTrack),
      track,
    ]);
    // Silence the old source during handoff so a concurrent Mute cannot leave
    // one group connection transmitting from an older microphone.
    oldTrack.enabled = false;
    options.setStream(next);
    const replaced = await Promise.allSettled(
      options.targets().map((target) => Promise.resolve().then(() => target.replace(track))),
    );
    if (!options.isCurrent() || options.getStream() !== next) {
      oldTrack.stop();
      throw new Error("Call cancelled");
    }
    if (track.readyState !== "live" || replaced.some((result) => result.status === "rejected")) {
      track.enabled = false;
      oldTrack.enabled = options.enabled();
      options.setStream(original);
      await Promise.all(
        options.targets().map(async (target) => {
          try {
            await target.replace(oldTrack);
          } catch {
            target.disconnect();
          }
        }),
      );
      throw new Error("Device switch failed");
    }
    committed = true;
    oldTrack.stop();
  } finally {
    if (!committed)
      acquired?.getTracks().forEach((track) => {
        track.stop();
      });
    if (document.documentElement.dataset.callMediaPending === "switch")
      delete document.documentElement.dataset.callMediaPending;
  }
}
