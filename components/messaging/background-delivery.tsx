"use client";

import { useEffect } from "react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { syncDelivery } from "@/lib/messaging/sync-delivery";

export function BackgroundDelivery() {
  const { session } = useAccountSession();
  const viewerId = session?.id;
  useEffect(() => {
    if (!viewerId) return;
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || controller.signal.aborted || document.visibilityState !== "visible") return;
      busy = true;
      try {
        for (let page = 0; page < 4 && !controller.signal.aborted; page++) {
          const count = await syncDelivery(
            viewerId as string,
            AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          );
          if (count < 100) break;
        }
      } catch {
        /* A later poll retries safely. Read status is handled inside each chat. */
      } finally {
        busy = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    const resume = () => {
      void refresh();
    };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [viewerId]);
  return null;
}
