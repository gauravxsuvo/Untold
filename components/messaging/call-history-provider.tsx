"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useMessagingDevice } from "./messaging-device-provider";

const Context = createContext({ missedCount: 0, refresh: () => {} });
export function CallHistoryProvider({ children }: { children: ReactNode }) {
  const { device, approved } = useMessagingDevice();
  const [missedCount, setMissedCount] = useState(0);
  const refresh = useCallback(() => {
    window.dispatchEvent(new Event("untold-call-history-refresh"));
  }, []);
  useEffect(() => {
    if (!device || !approved) {
      setMissedCount(0);
      return;
    }
    let disposed = false;
    let busy = false;
    const controller = new AbortController();
    const update = async () => {
      if (busy || disposed || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const response = await fetch(`/api/call-history?count=true&deviceId=${device.deviceId}`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if ((response.status === 401 || response.status === 403) && !disposed) setMissedCount(0);
        if (!response.ok) return;
        const data = await response.json();
        if (!disposed) setMissedCount(data.missedCount ?? 0);
      } catch {
        /* Keep the last badge through transient network errors. */
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void update(), 15000);
    window.addEventListener("untold-call-history-refresh", update);
    window.addEventListener("untold-call-active", update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    void update();
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("untold-call-history-refresh", update);
      window.removeEventListener("untold-call-active", update);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [device, approved]);
  return <Context.Provider value={{ missedCount, refresh }}>{children}</Context.Provider>;
}
export function useCallHistoryStatus() {
  return useContext(Context);
}
