"use client";

import { useEffect, useRef, type RefObject } from "react";
import { acknowledgeMessages } from "@/lib/messaging/api-client";
import type { ThreadMessage } from "@/components/messaging/use-messaging";

export function useMessageReceipts(
  conversationId: string | null,
  viewerId: string,
  messages: ThreadMessage[],
  historyRef: RefObject<HTMLOListElement | null>,
) {
  const confirmed = useRef({ key: "", received: new Set<string>(), read: new Set<string>() });

  useEffect(() => {
    if (!conversationId || !viewerId) return;
    const targetId = conversationId;
    const key = `${viewerId}:${targetId}`;
    if (confirmed.current.key !== key) {
      confirmed.current = { key, received: new Set(), read: new Set() };
    }
    const saved = confirmed.current;
    const incoming = messages.filter(
      (message) => message.senderId !== viewerId && message.delivery === "sent",
    );
    const pendingRead = new Set<string>();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sending = false;

    function schedule(delay = 300) {
      if (controller.signal.aborted || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, delay);
    }

    async function flush() {
      if (sending || controller.signal.aborted) return;
      const receivedIds = incoming.filter(({ id }) => !saved.received.has(id)).map(({ id }) => id);
      const readIds = [...pendingRead].filter((id) => !saved.read.has(id));
      if (receivedIds.length === 0 && readIds.length === 0) return;
      sending = true;
      try {
        await acknowledgeMessages(targetId, receivedIds, readIds, controller.signal);
        if (controller.signal.aborted) return;
        for (const id of [...receivedIds, ...readIds]) saved.received.add(id);
        for (const id of readIds) {
          saved.read.add(id);
          pendingRead.delete(id);
        }
        if (pendingRead.size) schedule();
      } catch {
        // Status updates are best effort and idempotent. Retry without interrupting a conversation.
        schedule(5_000);
      } finally {
        sending = false;
      }
    }

    function canRead() {
      return document.visibilityState === "visible" && document.hasFocus();
    }

    function markRead(element: Element) {
      const id = element.getAttribute("data-receipt-id");
      if (id && !saved.read.has(id)) {
        pendingRead.add(id);
        schedule();
      }
    }

    const history = historyRef.current;
    const elements = Array.from(history?.querySelectorAll("[data-receipt-id]") ?? []);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (!canRead()) return;
              for (const entry of entries) {
                if (
                  entry.isIntersecting &&
                  (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= 80)
                )
                  markRead(entry.target);
              }
            },
            { threshold: [0, 0.5, 1] },
          );
    for (const element of elements) observer?.observe(element);

    function checkVisible() {
      if (!canRead() || !history || history.getClientRects().length === 0) return;
      const bounds = history.getBoundingClientRect();
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        const height =
          Math.min(rect.bottom, bounds.bottom, window.innerHeight) -
          Math.max(rect.top, bounds.top, 0);
        const width =
          Math.min(rect.right, bounds.right, window.innerWidth) -
          Math.max(rect.left, bounds.left, 0);
        if (width > 0 && rect.height > 0 && height >= Math.min(rect.height * 0.5, 80))
          markRead(element);
      }
    }

    schedule();
    checkVisible();
    window.addEventListener("focus", checkVisible);
    document.addEventListener("visibilitychange", checkVisible);
    history?.addEventListener("scroll", checkVisible, { passive: true });
    return () => {
      controller.abort();
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("focus", checkVisible);
      document.removeEventListener("visibilitychange", checkVisible);
      history?.removeEventListener("scroll", checkVisible);
    };
  }, [conversationId, viewerId, messages, historyRef]);
}
