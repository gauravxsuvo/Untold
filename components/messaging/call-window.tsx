"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownLeft,
  GripHorizontal,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  RotateCcw,
  ExternalLink,
  Mic,
  MicOff,
  PhoneOff,
} from "lucide-react";

type PictureWindow = Window & {
  documentPictureInPicture?: {
    requestWindow: (options: { width: number; height: number }) => Promise<Window>;
  };
};
function copyAppearance(target: Document) {
  for (const name of [
    "class",
    "style",
    "data-theme",
    "data-font-size",
    "data-interface-zoom",
    "lang",
    "dir",
  ]) {
    const value = document.documentElement.getAttribute(name);
    if (value === null) target.documentElement.removeAttribute(name);
    else target.documentElement.setAttribute(name, value);
  }
  target.body.className = `${document.body.className} call-popout-body`;
  for (const node of target.head.querySelectorAll("[data-call-styles]")) node.remove();
  for (const node of document.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
    'link[rel="stylesheet"], style',
  )) {
    const clone = node.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
    if (node instanceof HTMLLinkElement) (clone as HTMLLinkElement).href = node.href;
    if (node.nonce) clone.nonce = node.nonce;
    clone.dataset.callStyles = "true";
    target.head.append(clone);
  }
}

export function CallWindow({
  title,
  group = false,
  live,
  minimized,
  onMinimize,
  children,
  onEnd,
  onMute,
  muted = false,
  duration,
}: {
  title: string;
  group?: boolean;
  live: boolean;
  minimized: boolean;
  onMinimize: (value: boolean) => void;
  children: ReactNode;
  onEnd?: () => void;
  onMute?: () => void;
  muted?: boolean;
  duration?: string;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [external, setExternal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState("");
  const [autoFloat, setAutoFloat] = useState(true);
  const [canAutoFloat, setCanAutoFloat] = useState(false);
  const [canFloat, setCanFloat] = useState(false);
  const nativeVideo = useRef<HTMLVideoElement | null>(null);
  const externalWindow = useRef<Window | null>(null);
  const active = useRef(true);
  const openingRef = useRef(false);
  const appearanceObserver = useRef<MutationObserver | null>(null);
  const generation = useRef(0);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
    zoom: number;
  } | null>(null);
  const propsRef = useRef({ onMinimize, live });
  propsRef.current = { onMinimize, live };
  const hostRef = useRef<HTMLDivElement | null>(null);
  const externalResizeCleanup = useRef<(() => void) | null>(null);
  const clampRef = useRef<() => void>(() => {});
  function constrain(x: number, y: number) {
    const box = panel.current?.getBoundingClientRect();
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) / zoom;
    const top = (viewport?.offsetTop ?? 0) / zoom;
    const width = (viewport?.width ?? window.innerWidth) / zoom;
    const height = (viewport?.height ?? window.innerHeight) / zoom;
    return {
      x: Math.max(
        left + 8,
        Math.min(x, left + width - Math.min((box?.width ?? 480) / zoom, width - 16) - 8),
      ),
      y: Math.max(
        top + 8,
        Math.min(y, top + height - Math.min((box?.height ?? 560) / zoom, height - 16) - 8),
      ),
    };
  }
  function center() {
    const box = panel.current?.getBoundingClientRect();
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    setPosition(
      constrain(
        (window.innerWidth - (box?.width ?? 480)) / 2 / zoom,
        (window.innerHeight - (box?.height ?? 560)) / 2 / zoom,
      ),
    );
  }
  function restore() {
    externalResizeCleanup.current?.();
    externalResizeCleanup.current = null;
    const current = externalWindow.current;
    externalWindow.current = null;
    appearanceObserver.current?.disconnect();
    appearanceObserver.current = null;
    if (hostRef.current && active.current) {
      document.body.append(hostRef.current);
      window.dispatchEvent(new Event("untold-call-windowchange"));
      window.dispatchEvent(new Event("resize"));
    }
    if (active.current) {
      setExternal(false);
      setMessage("");
      propsRef.current.onMinimize(false);
    }
    try {
      current?.close();
    } catch {
      /* The browser may already have closed it. */
    }
  }
  async function float(automatic = false, popup = false) {
    const container = hostRef.current;
    if (!container || !active.current || !propsRef.current.live || openingRef.current) return;
    if (externalWindow.current && !externalWindow.current.closed) {
      if (!automatic) externalWindow.current.focus();
      return;
    }
    openingRef.current = true;
    setOpening(true);
    setMessage("");
    const token = ++generation.current;
    let child: Window | null = null;
    try {
      const api = !popup && (window as PictureWindow).documentPictureInPicture;
      if (api) child = await api.requestWindow({ width: group ? 640 : 480, height: 640 });
      else {
        if (automatic) return;
        const media = container.querySelector<HTMLVideoElement>('video[data-call-remote="true"]');
        if (!popup && document.pictureInPictureEnabled && media?.requestPictureInPicture) {
          if (document.pictureInPictureElement === media) {
            await document.exitPictureInPicture();
            return;
          }
          await media.requestPictureInPicture();
          if (!active.current || token !== generation.current) {
            if (document.pictureInPictureElement === media)
              await document.exitPictureInPicture().catch(() => {});
            return;
          }
          nativeVideo.current = media;
          setMessage("Video is floating. Use this call window for microphone and hangup controls.");
          return;
        }
        child = window.open("about:blank", "_blank", "popup=yes,width=520,height=640");
        if (!child) throw new Error();
        child.opener = null;
      }
      if (!active.current || token !== generation.current || !propsRef.current.live) {
        child.close();
        return;
      }
      child.document.title = "Untold call";
      copyAppearance(child.document);
      const owned = child;
      externalWindow.current = owned;
      const resizeExternal = () => {
        const zoom =
          Number.parseFloat(owned.getComputedStyle(owned.document.documentElement).zoom) || 1;
        container.style.setProperty("--call-vh", `${owned.innerHeight / zoom}px`);
        container.style.setProperty("--call-vw", `${owned.innerWidth / zoom}px`);
      };
      resizeExternal();
      owned.addEventListener("resize", resizeExternal);
      externalResizeCleanup.current = () => owned.removeEventListener("resize", resizeExternal);
      const observer = new MutationObserver(() => {
        if (!owned.closed) {
          try {
            copyAppearance(owned.document);
            resizeExternal();
          } catch {
            restore();
          }
        }
      });
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.head, { childList: true });
      appearanceObserver.current = observer;
      owned.addEventListener(
        "pagehide",
        () => {
          if (externalWindow.current === owned) restore();
        },
        { once: true },
      );
      owned.document.body.append(container);
      window.dispatchEvent(new Event("untold-call-windowchange"));
      setExternal(true);
      propsRef.current.onMinimize(false);
      if (!api)
        setMessage("This browser opens a separate window. It may not stay above other apps.");
      // Existing media elements and their output routing move with the controls.
    } catch {
      try {
        child?.close();
      } catch {
        /* Already closed. */
      }
      if (active.current)
        setMessage(
          automatic
            ? "Automatic floating is unavailable. Open a floating window from the call controls."
            : "The floating window couldn’t open. Try Open separate window, or allow picture-in-picture in your browser.",
        );
    } finally {
      openingRef.current = false;
      if (active.current) setOpening(false);
    }
  }
  const floatRef = useRef(float);
  floatRef.current = float;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => {
    active.current = true;
    setCanAutoFloat(
      Boolean((window as PictureWindow).documentPictureInPicture && navigator.mediaSession),
    );
    setCanFloat(
      Boolean(
        (window as PictureWindow).documentPictureInPicture ||
          document.pictureInPictureEnabled ||
          window.matchMedia("(pointer: fine)").matches,
      ),
    );
    const container = document.createElement("div");
    container.className = "call-window-host";
    hostRef.current = container;
    document.body.append(container);
    setHost(container);
    const resized = () => {
      if (externalWindow.current) return;
      const viewport = window.visualViewport;
      if (viewport && viewport.scale > 1.05) return;
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      container.dataset.compactControls = String(
        (viewport?.width ?? window.innerWidth) / zoom < 700 &&
          Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--text-scale"),
          ) >= 1.5,
      );
      container.style.setProperty(
        "--call-vh",
        `${(viewport?.height ?? window.innerHeight) / zoom}px`,
      );
      container.style.setProperty(
        "--call-vw",
        `${(viewport?.width ?? window.innerWidth) / zoom}px`,
      );
      container.style.setProperty("--call-top", `${(viewport?.offsetTop ?? 0) / zoom}px`);
      clampRef.current();
    };
    resized();
    window.addEventListener("resize", resized);
    window.visualViewport?.addEventListener("resize", resized);
    window.visualViewport?.addEventListener("scroll", resized);
    const preferences = new MutationObserver(resized);
    preferences.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-interface-zoom", "data-font-size"],
    });
    const close = () => {
      generation.current++;
      restoreRef.current();
    };
    window.addEventListener("pagehide", close);
    return () => {
      active.current = false;
      externalResizeCleanup.current?.();
      preferences.disconnect();
      generation.current++;
      appearanceObserver.current?.disconnect();
      externalWindow.current?.close();
      if (nativeVideo.current && document.pictureInPictureElement === nativeVideo.current)
        void document.exitPictureInPicture().catch(() => {});
      externalWindow.current = null;
      container.remove();
      hostRef.current = null;
      window.removeEventListener("pagehide", close);
      window.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("scroll", resized);
    };
  }, []);
  useEffect(() => {
    if (!minimized) {
      window.dispatchEvent(new Event("untold-call-windowchange"));
      panel.current?.focus();
    } else hostRef.current?.querySelector<HTMLButtonElement>(".call-mini__return")?.focus();
  }, [minimized]);
  clampRef.current = () => {
    if (!externalWindow.current && !expanded)
      setPosition((current) => (current ? constrain(current.x, current.y) : null));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Center only when the portal is first attached; dragging is retained on updates.
  useEffect(() => {
    if (host) center();
  }, [host]);
  useEffect(() => {
    const node = panel.current;
    if (!node || !host || external) return;
    const observer = new ResizeObserver(() => clampRef.current());
    observer.observe(node);
    return () => observer.disconnect();
  }, [host, external]);
  useEffect(() => {
    if (
      !live ||
      !autoFloat ||
      !(window as PictureWindow).documentPictureInPicture ||
      !navigator.mediaSession
    )
      return;
    try {
      navigator.mediaSession.playbackState = "playing";
      if (typeof MediaMetadata !== "undefined")
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "Untold call",
          artist: "Call in progress",
        });
      navigator.mediaSession.setActionHandler(
        "enterpictureinpicture" as MediaSessionAction,
        () => void floatRef.current(true),
      );
    } catch {
      return;
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler(
          "enterpictureinpicture" as MediaSessionAction,
          null,
        );
        navigator.mediaSession.playbackState = "none";
        navigator.mediaSession.metadata = null;
      } catch {
        /* Unsupported action. */
      }
    };
  }, [live, autoFloat]);
  if (!host) return null;
  return createPortal(
    <>
      {minimized && !external ? (
        <aside className="call-mini" aria-label="Ongoing call">
          <button type="button" className="call-mini__return" onClick={() => onMinimize(false)}>
            <PictureInPicture2 size={17} />
            <span>
              {title}
              {duration ? ` · ${duration}` : ""}
            </span>
          </button>
          {onMute ? (
            <button
              type="button"
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={muted}
              onClick={onMute}
            >
              {muted ? <MicOff size={19} /> : <Mic size={19} />}
            </button>
          ) : null}
          {onEnd ? (
            <button
              type="button"
              className="call-mini__end"
              aria-label={group ? "Leave call" : "End call"}
              onClick={onEnd}
            >
              <PhoneOff size={19} />
            </button>
          ) : null}
        </aside>
      ) : null}
      <section
        ref={panel}
        role="dialog"
        tabIndex={-1}
        aria-label={title}
        hidden={minimized && !external}
        className={`call-dialog call-window${group ? " group-call-dialog" : ""}${external ? " call-window--external" : ""}${expanded ? " call-window--expanded" : ""}`}
        style={
          !external && !expanded
            ? position
              ? {
                  left: `var(--call-left, ${position.x}px)`,
                  top: `var(--call-position-top, ${position.y}px)`,
                }
              : { visibility: "hidden" }
            : undefined
        }
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !(event.target as HTMLElement).closest(".call-media--expanded") &&
            !event.currentTarget.ownerDocument.fullscreenElement
          ) {
            event.stopPropagation();
            if (expanded) setExpanded(false);
            else if (!external) onMinimize(true);
          }
        }}
      >
        <header className="call-window__header">
          <button
            type="button"
            className="call-window__drag"
            aria-label="Move call window. Use arrow keys to move, or Home to center."
            disabled={external || expanded}
            onPointerDown={(event) => {
              if (event.button !== 0 || external || expanded) return;
              const box = panel.current?.getBoundingClientRect();
              if (!box) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                left:
                  box.left /
                  (Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1),
                top:
                  box.top /
                  (Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1),
                zoom: Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1,
              };
            }}
            onPointerMove={(event) => {
              const moving = drag.current;
              if (moving?.id === event.pointerId)
                setPosition(
                  constrain(
                    moving.left + (event.clientX - moving.x) / moving.zoom,
                    moving.top + (event.clientY - moving.y) / moving.zoom,
                  ),
                );
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 40 : 10;
              const offset: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              if (event.key === "Home") {
                event.preventDefault();
                center();
              } else if (offset[event.key]) {
                event.preventDefault();
                const box = panel.current?.getBoundingClientRect();
                if (box)
                  setPosition(
                    constrain(
                      box.left /
                        (Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1) +
                        offset[event.key][0],
                      box.top /
                        (Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1) +
                        offset[event.key][1],
                    ),
                  );
              }
            }}
          >
            <GripHorizontal size={18} aria-hidden="true" />
            <span>{title}</span>
          </button>
          <div className="call-window__actions">
            {!external ? (
              <button
                type="button"
                title="Center call window"
                aria-label="Center call window"
                disabled={expanded}
                onClick={center}
              >
                <RotateCcw size={16} />
              </button>
            ) : null}
            {!external ? (
              <button
                type="button"
                title={expanded ? "Restore window size" : "Expand call"}
                aria-label={expanded ? "Restore window size" : "Expand call"}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
            ) : null}
            {live && (canFloat || external) ? (
              <button
                type="button"
                disabled={opening}
                title={external ? "Return call to app" : "Open floating call"}
                aria-label={external ? "Return call to app" : "Open floating call"}
                onClick={() => (external ? restore() : void float())}
              >
                {external ? <ArrowDownLeft size={18} /> : <PictureInPicture2 size={18} />}
              </button>
            ) : null}
            {!external ? (
              <button
                type="button"
                title="Minimize call"
                aria-label="Minimize call"
                onClick={() => onMinimize(true)}
              >
                <Minimize2 size={18} />
              </button>
            ) : null}
          </div>
        </header>
        {children}
        {message ? (
          <div className="call-window__message" role="status">
            {message}
            {!external && live ? (
              <button
                className="feature-button"
                type="button"
                onClick={() => void float(false, true)}
              >
                <ExternalLink size={16} />
                Open separate window
              </button>
            ) : null}
          </div>
        ) : null}
        {live && canAutoFloat ? (
          <label className="call-window__automatic">
            <input
              type="checkbox"
              checked={autoFloat}
              onChange={(event) => setAutoFloat(event.target.checked)}
            />
            Float when I switch apps, if my browser allows it
          </label>
        ) : null}
      </section>
    </>,
    host,
  );
}
