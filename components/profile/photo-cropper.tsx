"use client";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { RotateCcw } from "lucide-react";
type Rect = { x: number; y: number; size: number };
type Handle = "move" | "nw" | "ne" | "sw" | "se";
export function PhotoCropper({
  bitmap,
  output,
  disabled,
  onReady,
}: {
  bitmap: ImageBitmap;
  output: RefObject<HTMLCanvasElement | null>;
  disabled: boolean;
  onReady: (ready: boolean) => void;
}) {
  const preview = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const initial = () => {
    const size = Math.min(bitmap.width, bitmap.height) * 0.85;
    return { x: (bitmap.width - size) / 2, y: (bitmap.height - size) / 2, size };
  };
  const [rect, setRect] = useState<Rect>(initial);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const points = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ rect: Rect; x: number; y: number; handle: Handle; distance: number }>({
    rect,
    x: 0,
    y: 0,
    handle: "move",
    distance: 0,
  });
  const minimum = Math.min(bitmap.width, bitmap.height) * 0.1;
  function clamp(next: Rect) {
    const size = Math.max(minimum, Math.min(Math.min(bitmap.width, bitmap.height), next.size));
    return {
      x: Math.max(0, Math.min(bitmap.width - size, next.x)),
      y: Math.max(0, Math.min(bitmap.height - size, next.y)),
      size,
    };
  }
  function point(event: PointerEvent) {
    const bounds = frame.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - bounds.left) * bitmap.width) / bounds.width,
      y: ((event.clientY - bounds.top) * bitmap.height) / bounds.height,
    };
  }
  function start(event: PointerEvent<HTMLDivElement>, handle: Handle) {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    points.current.set(event.pointerId, p);
    const all = [...points.current.values()];
    gesture.current = {
      rect: rectRef.current,
      ...p,
      handle,
      distance: all.length > 1 ? Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y) : 0,
    };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (disabled || !points.current.has(event.pointerId)) return;
    const p = point(event);
    points.current.set(event.pointerId, p);
    const all = [...points.current.values()];
    const g = gesture.current,
      original = g.rect;
    if (all.length > 1 && g.distance > 0) {
      const distance = Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y);
      const size = Math.max(
        minimum,
        Math.min(Math.min(bitmap.width, bitmap.height), (original.size * distance) / g.distance),
      );
      setRect(
        clamp({
          x: original.x + (original.size - size) / 2,
          y: original.y + (original.size - size) / 2,
          size,
        }),
      );
      return;
    }
    const dx = p.x - g.x,
      dy = p.y - g.y;
    if (g.handle === "move") {
      setRect(clamp({ ...original, x: original.x + dx, y: original.y + dy }));
      return;
    }
    const west = g.handle.includes("w"),
      north = g.handle.includes("n");
    const anchorX = west ? original.x + original.size : original.x;
    const anchorY = north ? original.y + original.size : original.y;
    const change = ((west ? -dx : dx) + (north ? -dy : dy)) / 2;
    const max = Math.min(
      west ? anchorX : bitmap.width - anchorX,
      north ? anchorY : bitmap.height - anchorY,
    );
    const size = Math.max(minimum, Math.min(max, original.size + change));
    setRect(
      clamp({ x: west ? anchorX - size : anchorX, y: north ? anchorY - size : anchorY, size }),
    );
  }
  function release(event: PointerEvent<HTMLDivElement>) {
    points.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const p = [...points.current.values()][0];
    if (p) gesture.current = { rect: rectRef.current, ...p, handle: "move", distance: 0 };
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const step = Math.min(bitmap.width, bitmap.height) * (event.shiftKey ? 0.04 : 0.01);
    const direction = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (direction) {
      event.preventDefault();
      setRect((r) => clamp({ ...r, x: r.x + direction[0], y: r.y + direction[1] }));
    }
    if (event.key === "+" || event.key === "-" || event.key === "=") {
      event.preventDefault();
      const delta = event.key === "-" ? step : -step;
      setRect((r) => clamp({ x: r.x - delta / 2, y: r.y - delta / 2, size: r.size + delta }));
    }
  }
  useEffect(() => {
    const canvas = preview.current;
    if (!canvas) return;
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }, [bitmap]);
  useEffect(() => {
    const canvas = output.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      onReady(false);
      return;
    }
    canvas.width = 512;
    canvas.height = 512;
    context.clearRect(0, 0, 512, 512);
    context.drawImage(bitmap, rect.x, rect.y, rect.size, rect.size, 0, 0, 512, 512);
    onReady(true);
  }, [bitmap, output, rect, onReady]);
  return (
    <div className="photo-cropper">
      <p id="photo-crop-help">
        Drag the square to choose your crop. Drag a corner or pinch to resize. The circle shows how
        your photo will look.
      </p>
      <div
        className="photo-cropper__frame"
        ref={frame}
        style={{
          aspectRatio: `${bitmap.width} / ${bitmap.height}`,
          maxWidth: `${Math.min(440, (400 * bitmap.width) / bitmap.height)}px`,
        }}
      >
        <canvas ref={preview} role="img" aria-label="Original photo" />
        {/* biome-ignore lint/a11y/useSemanticElements: A two-dimensional crop selection has no equivalent native input. */}
        <div
          className="photo-cropper__selection"
          role="group"
          tabIndex={disabled ? -1 : 0}
          aria-label="Move crop with arrow keys. Use plus and minus to resize."
          aria-describedby="photo-crop-help"
          onKeyDown={keyboard}
          onPointerDown={(event) => start(event, "move")}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
          style={{
            left: `${(rect.x / bitmap.width) * 100}%`,
            top: `${(rect.y / bitmap.height) * 100}%`,
            width: `${(rect.size / bitmap.width) * 100}%`,
            height: `${(rect.size / bitmap.height) * 100}%`,
          }}
        >
          <span className="photo-cropper__circle" />
          <span className="photo-cropper__grid" />
          {(["nw", "ne", "sw", "se"] as const).map((handle) => (
            <div
              key={handle}
              className={`photo-cropper__handle photo-cropper__handle--${handle}`}
              aria-hidden="true"
              onPointerDown={(event) => start(event, handle)}
            />
          ))}
        </div>
      </div>
      <canvas ref={output} hidden />
      <div className="profile-photo-editor__actions">
        <button disabled={disabled} type="button" onClick={() => setRect(initial())}>
          <RotateCcw size={15} aria-hidden="true" />
          Reset crop
        </button>
      </div>
    </div>
  );
}
