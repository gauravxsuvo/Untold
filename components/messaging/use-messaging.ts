"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  fetchConversations,
  fetchMessages,
  sendMessage as postMessage,
} from "@/lib/messaging/api-client";
import {
  mergeMessages,
  sortByActivity,
  type ConversationMessage,
  type ConversationSummary,
} from "@/lib/messaging/people";

type LoadState = "loading" | "ready" | "error";

// Polling keeps conversations current when Ably is not configured or not connected.
const pollIntervals = { thread: 3000, list: 8000, withRealtime: 30000 };

function usePolling(callback: () => void, intervalMs: number | null) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (intervalMs === null) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") callbackRef.current();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") callbackRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}

/** Subscribes to Ably message notifications. Returns false when realtime is unavailable. */
function useRealtimeNotifications(
  conversationIds: string[],
  onMessageAvailable: (conversationId: string) => void,
): boolean {
  const [isConnected, setIsConnected] = useState(false);
  const handlerRef = useRef(onMessageAvailable);
  handlerRef.current = onMessageAvailable;
  const idsKey = conversationIds.slice(0, 25).sort().join(",");

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) return;

    let cancelled = false;
    let client: { close: () => void } | null = null;

    async function requestToken() {
      const response = await fetch("/api/realtime/token", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: ids }),
      });
      if (!response.ok) throw new ApiError("Realtime is unavailable.", response.status);
      return response.json();
    }

    (async () => {
      // Probe first, so an unconfigured Ably key falls back to polling without retry loops.
      let firstToken: unknown;
      try {
        firstToken = await requestToken();
      } catch {
        return;
      }

      const Ably = await import("ably");
      if (cancelled) return;

      let hasUsedFirstToken = false;
      const realtime = new Ably.Realtime({
        authCallback: (_params, callback) => {
          if (!hasUsedFirstToken) {
            hasUsedFirstToken = true;
            callback(null, firstToken as Parameters<typeof callback>[1]);
            return;
          }
          requestToken().then(
            (token) => callback(null, token),
            (error: unknown) => callback(error instanceof Error ? error.message : "Token failed", null),
          );
        },
      });
      client = realtime;

      realtime.connection.on((change) => {
        if (!cancelled) setIsConnected(change.current === "connected");
      });
      for (const id of ids) {
        realtime.channels
          .get(`untold:conversation:${id}`)
          .subscribe("message-available", () => handlerRef.current(id))
          .catch(() => undefined);
      }
    })();

    return () => {
      cancelled = true;
      client?.close();
      setIsConnected(false);
    };
  }, [idsKey]);

  return isConnected;
}

export function useConversationList(
  onMessageAvailable?: (conversationId: string) => void,
) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await fetchConversations();
      setConversations(sortByActivity(next));
      setState("ready");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversations could not load.");
      setState((current) => (current === "ready" ? "ready" : "error"));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isRealtimeConnected = useRealtimeNotifications(
    conversations.map(({ id }) => id),
    (conversationId) => {
      void refresh();
      onMessageAvailable?.(conversationId);
    },
  );
  usePolling(() => void refresh(), isRealtimeConnected ? pollIntervals.withRealtime : pollIntervals.list);

  const upsert = useCallback((conversation: ConversationSummary) => {
    setConversations((current) =>
      sortByActivity([conversation, ...current.filter(({ id }) => id !== conversation.id)]),
    );
  }, []);

  return { conversations, state, error, refresh, upsert, isRealtimeConnected };
}

export type ThreadMessage = ConversationMessage & { delivery: "sent" | "sending" | "failed" };

export function useConversationThread(
  conversationId: string | null,
  viewerId: string,
  isRealtimeConnected: boolean,
) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const activeIdRef = useRef(conversationId);
  activeIdRef.current = conversationId;

  const refresh = useCallback(async () => {
    const requestedId = activeIdRef.current;
    if (!requestedId) return;
    try {
      const fetched = await fetchMessages(requestedId);
      if (activeIdRef.current !== requestedId) return;
      setMessages((current) => {
        const confirmedIds = new Set(fetched.map(({ clientMessageId }) => clientMessageId));
        const pending = current.filter(
          (message) => message.delivery !== "sent" && !confirmedIds.has(message.clientMessageId),
        );
        return mergeMessages<ThreadMessage>(
          pending,
          fetched.map((message) => ({ ...message, delivery: "sent" })),
        );
      });
      setState("ready");
      setError("");
    } catch (caught) {
      if (activeIdRef.current !== requestedId) return;
      setError(caught instanceof Error ? caught.message : "Messages could not load.");
      setState((current) => (current === "ready" ? "ready" : "error"));
    }
  }, []);

  useEffect(() => {
    setMessages([]);
    setError("");
    setState("loading");
    if (conversationId) void refresh();
  }, [conversationId, refresh]);

  usePolling(
    () => void refresh(),
    conversationId ? (isRealtimeConnected ? pollIntervals.withRealtime : pollIntervals.thread) : null,
  );

  const deliver = useCallback(async (targetId: string, pending: ThreadMessage) => {
    try {
      const saved = await postMessage(targetId, pending.text ?? "", pending.clientMessageId);
      if (activeIdRef.current !== targetId) return;
      setMessages((current) =>
        mergeMessages<ThreadMessage>(
          current.filter(({ clientMessageId }) => clientMessageId !== pending.clientMessageId),
          [{ ...saved, delivery: "sent" }],
        ),
      );
    } catch (caught) {
      if (activeIdRef.current !== targetId) return;
      setMessages((current) =>
        current.map((message) =>
          message.clientMessageId === pending.clientMessageId
            ? { ...message, delivery: "failed" }
            : message,
        ),
      );
      setError(caught instanceof Error ? caught.message : "Your message was not sent.");
    }
  }, []);

  const send = useCallback(
    (text: string) => {
      if (!conversationId) return;
      const clientMessageId = crypto.randomUUID();
      const pending: ThreadMessage = {
        id: `pending-${clientMessageId}`,
        senderId: viewerId,
        clientMessageId,
        text,
        createdAt: new Date().toISOString(),
        delivery: "sending",
      };
      setMessages((current) => [...current, pending]);
      setError("");
      void deliver(conversationId, pending);
    },
    [conversationId, deliver, viewerId],
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      if (!conversationId) return;
      const failed = messages.find((message) => message.clientMessageId === clientMessageId);
      if (!failed) return;
      const pending = { ...failed, delivery: "sending" as const };
      setMessages((current) =>
        current.map((message) => (message.clientMessageId === clientMessageId ? pending : message)),
      );
      setError("");
      void deliver(conversationId, pending);
    },
    [conversationId, deliver, messages],
  );

  return { messages, state, error, refresh, send, retry };
}
