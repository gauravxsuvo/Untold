"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Headphones, RefreshCw, Settings2 } from "lucide-react";

type Preferences = { microphone: string; camera: string; output: string };
type Output = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
type ContextValue = {
  preferences: Preferences;
  preferencesRef: { current: Preferences };
  devices: MediaDeviceInfo[];
  error: string;
  blocked: boolean;
  outputSupported: boolean;
  refresh: () => Promise<void>;
  rememberInput: (kind: "audio" | "video", id: string) => void;
  selectOutput: (id: string) => Promise<void>;
  chooseOutput: () => Promise<void>;
  attachOutput: (element: HTMLMediaElement, onBlocked: () => void) => () => void;
};
const Context = createContext<ContextValue | null>(null);
export function CallDevicesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>({
    microphone: "",
    camera: "",
    output: "",
  });
  const preferencesRef = useRef(preferences);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);
  const outputs = useRef(new Map<Output, () => void>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const [outputSupported, setOutputSupported] = useState(false);
  const updateBlocked = useCallback((value: boolean) => {
    blockedRef.current = value;
    if (mounted.current) setBlocked(value);
  }, []);
  const pause = useCallback(() => {
    for (const node of outputs.current.keys()) {
      node.dataset.callOutputBlocked = "true";
      node.pause();
    }
  }, []);
  const play = useCallback((node: Output) => {
    if (!outputs.current.has(node) || blockedRef.current) return;
    if (typeof node.setSinkId === "function" && node.sinkId !== preferencesRef.current.output)
      return;
    delete node.dataset.callOutputBlocked;
    void node.play().catch(() => outputs.current.get(node)?.());
  }, []);
  const work = useCallback((task: () => Promise<void>) => {
    const next = queue.current.catch(() => {}).then(task);
    queue.current = next;
    return next;
  }, []);
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const result = await navigator.mediaDevices.enumerateDevices();
      if (!mounted.current) return;
      setDevices(result);
      const output = preferencesRef.current.output;
      // Never change a disconnected headset to loudspeakers without consent.
      if (
        output &&
        result.length &&
        !result.some((device) => device.kind === "audiooutput" && device.deviceId === output)
      ) {
        pause();
        updateBlocked(true);
        setError("Your audio output disconnected. Choose an output to hear the call.");
      }
    } catch {
      /* Hidden documents can be denied enumeration; retain the last known list. */
    }
  }, [pause, updateBlocked]);
  const selectOutput = useCallback(
    async (id: string) => {
      pause();
      return work(async () => {
        const previous = preferencesRef.current.output;
        try {
          const applied = await Promise.allSettled(
            [...outputs.current.keys()].map(async (node) => {
              if (typeof node.setSinkId === "function") await node.setSinkId(id);
              else if (id) throw new Error();
            }),
          );
          if (applied.some((result) => result.status === "rejected")) throw new Error();
          if (!mounted.current) return;
          preferencesRef.current = { ...preferencesRef.current, output: id };
          setPreferences(preferencesRef.current);
          updateBlocked(false);
          setError("");
          for (const node of outputs.current.keys()) play(node);
        } catch {
          const rollback = await Promise.allSettled(
            [...outputs.current.keys()].map(async (node) => {
              if (typeof node.setSinkId === "function") await node.setSinkId(previous);
            }),
          );
          if (!mounted.current) return;
          const failed = rollback.some((result) => result.status === "rejected");
          updateBlocked(failed || blockedRef.current);
          if (!blockedRef.current) for (const node of outputs.current.keys()) play(node);
          setError(
            "That output couldn’t be selected. Check its connection and browser permission, then try again.",
          );
          throw new Error("Audio output selection failed");
        }
      });
    },
    [pause, work, updateBlocked, play],
  );
  const chooseOutput = useCallback(async () => {
    const media = navigator.mediaDevices as MediaDevices & {
      selectAudioOutput?: () => Promise<MediaDeviceInfo>;
    };
    if (!media?.selectAudioOutput) return;
    try {
      const selected = await media.selectAudioOutput();
      await selectOutput(selected.deviceId);
      await refresh();
    } catch {
      if (mounted.current) setError("Choose an audio output and allow access to use it.");
    }
  }, [selectOutput, refresh]);
  const attachOutput = useCallback(
    (element: HTMLMediaElement, onBlocked: () => void) => {
      const node = element as Output;
      outputs.current.set(node, onBlocked);
      node.dataset.callOutputBlocked = "true";
      void work(async () => {
        if (!outputs.current.has(node)) return;
        try {
          if (typeof node.setSinkId === "function")
            await node.setSinkId(preferencesRef.current.output);
          play(node);
        } catch {
          if (outputs.current.has(node)) {
            pause();
            updateBlocked(true);
            if (mounted.current) setError("Choose an audio output to hear the call.");
          }
        }
      });
      return () => {
        outputs.current.delete(node);
        node.pause();
      };
    },
    [work, play, pause, updateBlocked],
  );
  const rememberInput = useCallback((kind: "audio" | "video", id: string) => {
    preferencesRef.current = {
      ...preferencesRef.current,
      [kind === "audio" ? "microphone" : "camera"]: id,
    };
    setPreferences(preferencesRef.current);
  }, []);
  useEffect(() => {
    mounted.current = true;
    setOutputSupported(typeof HTMLMediaElement.prototype.setSinkId === "function");
    return () => {
      mounted.current = false;
      outputs.current.clear();
    };
  }, []);
  return (
    <Context.Provider
      value={{
        preferences,
        preferencesRef,
        devices,
        error,
        blocked,
        outputSupported,
        refresh,
        rememberInput,
        selectOutput,
        chooseOutput,
        attachOutput,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCallDevices() {
  const context = useContext(Context);
  if (!context) throw new Error("Call devices require CallDevicesProvider");
  return context;
}

export function CallDeviceSettings({
  stream,
  video,
  sharing,
  onInputChange,
  disabled = false,
}: {
  stream?: MediaStream | null;
  video: boolean;
  sharing: boolean;
  disabled?: boolean;
  onInputChange?: (kind: "audio" | "video", id: string) => Promise<void>;
}) {
  const devices = useCallDevices();
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const [busy, setBusy] = useState(false);
  const switching = useRef(false);
  const [message, setMessage] = useState("");
  const id = useId();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => void devicesRef.current.refresh();
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      mounted.current = false;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    void stream;
    void devicesRef.current.refresh();
  }, [stream]);
  useEffect(() => {
    if (!stream) return;
    const ended = () => {
      setMessage("A call device disconnected. Choose another microphone or camera.");
      void devicesRef.current.refresh();
    };
    const tracks = stream.getTracks();
    for (const track of tracks) track.addEventListener("ended", ended);
    return () => {
      for (const track of tracks) track.removeEventListener("ended", ended);
    };
  }, [stream]);
  async function changeInput(kind: "audio" | "video", value: string) {
    if (switching.current) return;
    switching.current = true;
    setBusy(true);
    setMessage("");
    try {
      await onInputChange?.(kind, value);
      if (mounted.current) {
        devicesRef.current.rememberInput(kind, value);
        await devicesRef.current.refresh();
      }
    } catch {
      if (mounted.current)
        setMessage(
          "That device couldn’t be selected. Check its connection and permission, then try again.",
        );
    } finally {
      switching.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const hasOutputChooser =
    typeof navigator !== "undefined" &&
    typeof (navigator.mediaDevices as MediaDevices & { selectAudioOutput?: unknown })
      ?.selectAudioOutput === "function";
  function options(kind: MediaDeviceKind, selected: string) {
    const available = devices.devices.filter(
      (device) => device.kind === kind && device.deviceId && device.deviceId !== "default",
    );
    return (
      <>
        <option value="">System default</option>
        {selected && !available.some((d) => d.deviceId === selected) ? (
          <option value={selected}>Selected device (unavailable)</option>
        ) : null}
        {available.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label ||
              `${kind === "audioinput" ? "Microphone" : kind === "videoinput" ? "Camera" : "Output"} ${index + 1}`}
          </option>
        ))}
      </>
    );
  }
  return (
    <details className="call-device-settings">
      <summary>
        <Settings2 size={16} aria-hidden="true" />
        Audio and video devices
        {devices.blocked ? " · Choose output" : message ? " · Check devices" : ""}
      </summary>
      <div className="call-device-settings__fields">
        <label htmlFor={`${id}-mic`}>Microphone</label>
        <select
          id={`${id}-mic`}
          value={devices.preferences.microphone}
          disabled={busy || disabled}
          onChange={(event) => void changeInput("audio", event.target.value)}
        >
          {options("audioinput", devices.preferences.microphone)}
        </select>
        {video ? (
          <>
            <label htmlFor={`${id}-camera`}>Camera</label>
            <select
              id={`${id}-camera`}
              value={devices.preferences.camera}
              disabled={busy || sharing || disabled}
              onChange={(event) => void changeInput("video", event.target.value)}
            >
              {options("videoinput", devices.preferences.camera)}
            </select>
            {sharing ? <p>Stop sharing before changing the camera.</p> : null}
          </>
        ) : null}
        <label htmlFor={`${id}-output`}>Speakers or headphones</label>
        <select
          id={`${id}-output`}
          value={devices.preferences.output}
          disabled={!devices.outputSupported || busy || disabled}
          onChange={(event) => void devices.selectOutput(event.target.value).catch(() => {})}
        >
          {options("audiooutput", devices.preferences.output)}
        </select>
        {devices.outputSupported && hasOutputChooser ? (
          <button
            className="feature-button"
            type="button"
            disabled={disabled}
            onClick={() => void devices.chooseOutput()}
          >
            <Headphones size={16} />
            Choose another output
          </button>
        ) : null}
        {!devices.outputSupported ? (
          <p>Choose your audio output in your device’s sound settings.</p>
        ) : null}
        <button className="feature-button" type="button" onClick={() => void devices.refresh()}>
          <RefreshCw size={15} />
          Refresh devices
        </button>
        {busy || message || devices.error ? (
          <p role="status">{busy ? "Switching device…" : message || devices.error}</p>
        ) : null}
      </div>
    </details>
  );
}
