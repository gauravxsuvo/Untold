"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import type { ThreadMessage } from "@/components/messaging/use-messaging";

export function useMessageScroll(
  historyRef: RefObject<HTMLOListElement | null>,
  conversationId: string | null,
  viewerId: string,
  messages: ThreadMessage[],
) {
  const position = useRef({ conversationId: "", lastId: "", following: true });
  useLayoutEffect(() => {
    if (!conversationId) return;
    if (position.current.conversationId !== conversationId) {
      position.current = { conversationId, lastId: "", following: true };
    }
    const history = historyRef.current;
    if (!history) return;
    const saved = position.current;
    const last = messages.at(-1);
    if (last && last.id !== saved.lastId && last.senderId === viewerId) saved.following = true;
    saved.lastId = last?.id ?? "";
    const follow = () => {
      if (saved.following && history.clientHeight > 0) history.scrollTop = history.scrollHeight;
    };
    const scrolled = () => {
      if (history.clientHeight > 0)
        saved.following = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
    };
    follow();
    history.addEventListener("scroll", scrolled, { passive: true });
    // Both a keyboard resize and late media previews can change the available
    // history size. Follow the bottom only when the reader was already there.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(follow);
    observer?.observe(history);
    for (const message of history.children) observer?.observe(message);
    return () => {
      observer?.disconnect();
      history.removeEventListener("scroll", scrolled);
    };
  }, [conversationId, viewerId, messages, historyRef]);
}
