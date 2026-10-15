"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  fontSizeCookie,
  zoomCookie,
  isFontSize,
  isInterfaceZoom,
  type FontSize,
  type InterfaceZoom,
} from "@/lib/ui/readability";

type Preferences = { fontSize: FontSize; zoom: InterfaceZoom };
const Context = createContext<(Preferences & { update: (value: Preferences) => void }) | null>(
  null,
);

export function ReadabilityProvider({
  initial,
  children,
}: {
  initial: Preferences;
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState(initial);
  const update = useCallback((value: Preferences) => {
    if (!isFontSize(value.fontSize) || !isInterfaceZoom(value.zoom)) return;
    setPreferences(value);
    document.documentElement.dataset.fontSize = value.fontSize;
    document.documentElement.dataset.interfaceZoom = value.zoom;
    for (const [key, setting] of [
      [fontSizeCookie, value.fontSize],
      [zoomCookie, value.zoom],
    ]) {
      // biome-ignore lint/suspicious/noDocumentCookie: Saved visual preferences are rendered by the server, including on Safari without Cookie Store.
      document.cookie = `${key}=${setting}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      try {
        localStorage.setItem(key, setting);
      } catch {
        /* Storage may be unavailable. */
      }
    }
  }, []);
  useEffect(() => {
    const change = (event: StorageEvent) => {
      if (event.key !== fontSizeCookie && event.key !== zoomCookie) return;
      try {
        const fontSize = localStorage.getItem(fontSizeCookie);
        const zoom = localStorage.getItem(zoomCookie);
        update({
          fontSize: isFontSize(fontSize) ? fontSize : "default",
          zoom: isInterfaceZoom(zoom) ? zoom : "100",
        });
      } catch {
        /* Keep current preferences. */
      }
    };
    window.addEventListener("storage", change);
    return () => window.removeEventListener("storage", change);
  }, [update]);
  return <Context.Provider value={{ ...preferences, update }}>{children}</Context.Provider>;
}
export function useReadability() {
  const value = useContext(Context);
  if (!value) throw new Error("ReadabilityProvider is required");
  return value;
}
