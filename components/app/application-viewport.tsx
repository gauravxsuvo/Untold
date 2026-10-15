"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function ApplicationViewport({ children }: { children: ReactNode }) {
  const messaging = usePathname() === "/app/conversations";
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (!messaging || !element) return;
    const viewport = window.visualViewport;
    let frame = 0;
    let fullHeight = window.innerHeight;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Preserve ordinary pinch zoom instead of reflowing under the user's fingers.
        if (viewport && viewport.scale > 1.05) return;
        const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const height = viewport?.height ?? window.innerHeight;
        const focused = document.activeElement;
        const editing =
          focused instanceof HTMLTextAreaElement ||
          focused instanceof HTMLInputElement ||
          (focused instanceof HTMLElement && focused.isContentEditable);
        if (!editing) fullHeight = Math.max(fullHeight, window.innerHeight, height);
        element.style.setProperty("--conversation-viewport-height", `${height / zoom}px`);
        element.style.setProperty(
          "--conversation-viewport-top",
          `${(viewport?.offsetTop ?? 0) / zoom}px`,
        );
        element.dataset.keyboardOpen = String(
          editing && (fullHeight - height > 100 || height < 450),
        );
      });
    };
    function rotate() {
      fullHeight = window.innerHeight;
      resize();
    }
    const preferences = new MutationObserver(resize);
    preferences.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-interface-zoom", "data-font-size"],
    });
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", rotate);
    document.addEventListener("focusin", resize);
    document.addEventListener("focusout", resize);
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      preferences.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", rotate);
      document.removeEventListener("focusin", resize);
      document.removeEventListener("focusout", resize);
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      element.style.removeProperty("--conversation-viewport-height");
      element.style.removeProperty("--conversation-viewport-top");
      delete element.dataset.keyboardOpen;
    };
  }, [messaging]);
  return (
    <div className={`app-shell${messaging ? " app-shell--messaging" : ""}`} ref={container}>
      {children}
    </div>
  );
}
