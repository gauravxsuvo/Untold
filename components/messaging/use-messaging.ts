"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  userFacingError,
  fetchConversations,
  fetchConversationDevices,
  fetchMessageSnapshot,
  uploadEncryptedAttachment,
  discardEncryptedAttachment,
  registerDevice,
  sendMessage as postMessage,
} from "@/lib/messaging/api-client";
import {
  classifyDeviceTrust,
  decryptMessageForDevice,
  encryptAttachmentBytes,
  encryptMessageForDevices,
  loadOrCreateLocalDevice,
  maxAttachmentBytes,
  readEnvelopeSenderDeviceId,
  verifyDeviceFingerprint,
  type DeviceTrust,
  type LocalDevice,
  type PublicDevice,
} from "@/crypto/src/protocol";
import {
  encodeAttachmentMessage,
  openMessageContent,
  sanitizeAttachmentName,
  type AttachmentManifest,
} from "@/lib/messaging/attachments";
import { prepareAttachment } from "@/lib/messaging/prepare-attachment";
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
          .subscribe(["message-available", "receipts-updated"], () => handlerRef.current(id))
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
      setError(userFacingError(caught, "Conversations could not load."));
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

export type ThreadMessage = ConversationMessage & {
  envelope: string;
  text: string | null;
  attachment?: AttachmentManifest;
  attachmentSenderDeviceId?: string;
  encryption: "encrypted" | "unverified" | "unavailable";
  issue?: string;
  delivery: "sent" | "sending" | "failed";
};

type ThreadReadCache = {
  key: string;
  etag: string | null;
  messages: Map<string, ThreadMessage>;
  controller: AbortController | null;
  inFlight: boolean;
  queued: boolean;
};

export type AttachmentUploadStatus = {
  conversationId: string;
  fileName: string;
  progress: number;
  phase: "optimizing" | "preparing" | "uploading" | "failed";
  error?: string;
  retryable?: boolean;
};

type AttachmentRetryData = {
  targetId: string;
  context: { conversationId: string; messageId: string; senderId: string };
  attachmentId: string;
  manifest: AttachmentManifest;
  ciphertext: Uint8Array<ArrayBuffer>;
  deviceId: string;
};

export function useLocalMessagingDevice(accountId: string) {
  const [device, setDevice] = useState<LocalDevice | null>(null);
  const [state, setState] = useState<LoadState>(accountId ? "loading" : "ready");
  const [error, setError] = useState("");

  const initialize = useCallback(async () => {
    if (!accountId) {
      setDevice(null);
      setState("ready");
      setError("");
      return;
    }
    setState("loading");
    setError("");
    try {
      const local = await loadOrCreateLocalDevice(accountId);
      setDevice(local);
      await registerDevice({
        deviceId: local.deviceId,
        name: "This browser",
        agreementKey: local.agreementKey,
        signingKey: local.signingKey,
      });
      setState("ready");
    } catch (caught) {
      setError(userFacingError(caught, "We couldn’t get this browser ready. Refresh the page and try again."));
      setState("error");
    }
  }, [accountId]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return {
    device: device?.accountId === accountId ? device : null,
    state: accountId && device?.accountId !== accountId && state === "ready" ? "loading" : state,
    error,
    retry: initialize,
  };
}

export function useConversationDeviceDirectory(
  conversationId: string | null,
  accountId: string,
  localDevice: LocalDevice | null,
) {
  const [devices, setDevices] = useState<DeviceTrust[] | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const activeConversationRef = useRef(conversationId);
  activeConversationRef.current = conversationId;

  const refresh = useCallback(async () => {
    if (!conversationId || !localDevice) {
      setDevices(null);
      setState(conversationId ? "loading" : "ready");
      setError("");
      return;
    }
    const requestedId = conversationId;
    setState((current) => current === "ready" ? "ready" : "loading");
    try {
      const publicDevices = await fetchConversationDevices(requestedId);
      const classified = await classifyDeviceTrust(accountId, publicDevices);
      if (activeConversationRef.current !== requestedId) return;
      setDevices(classified);
      setState("ready");
      setError("");
    } catch (caught) {
      if (activeConversationRef.current !== requestedId) return;
      setError(userFacingError(caught, "We couldn’t load the safety codes. Please try again."));
      setState("error");
    }
  }, [accountId, conversationId, localDevice]);

  useEffect(() => {
    setDevices(null);
    void refresh();
  }, [refresh]);

  const verify = useCallback(async (device: PublicDevice) => {
    await verifyDeviceFingerprint(accountId, device);
    await refresh();
  }, [accountId, refresh]);

  usePolling(() => void refresh(), state === "ready" ? 30_000 : null);

  return { devices, state, error, refresh, verify };
}

export function useConversationThread(
  conversationId: string | null,
  viewerId: string,
  isRealtimeConnected: boolean,
  localDevice: LocalDevice | null,
  deviceDirectory: DeviceTrust[] | null,
  memberUserIds: string[],
  refreshDeviceDirectory: () => void,
) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [attachmentUpload, setAttachmentUpload] = useState<AttachmentUploadStatus | null>(null);
  const messagesConversationRef = useRef(conversationId);
  const attachmentRetryRef = useRef<AttachmentRetryData | null>(null);
  const attachmentPreparationRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    attachmentPreparationRef.current?.abort();
    attachmentRetryRef.current?.ciphertext.fill(0);
  }, []);
  const activeIdRef = useRef(conversationId);
  activeIdRef.current = conversationId;
  const localDeviceRef = useRef(localDevice);
  localDeviceRef.current = localDevice;
  const deviceDirectoryRef = useRef(deviceDirectory);
  deviceDirectoryRef.current = deviceDirectory;
  const directoryKey = deviceDirectory ? JSON.stringify(deviceDirectory.map((device) => [
    device.userId, device.deviceId, device.agreementKey, device.signingKey, device.trust, device.revoked,
  ]).sort((first, second) => String(first[1]).localeCompare(String(second[1])))) : "";
  const readCacheKey = JSON.stringify([viewerId, conversationId, localDevice?.deviceId, localDevice?.agreementKey, localDevice?.signingKey, directoryKey]);
  const readCacheKeyRef = useRef(readCacheKey);
  readCacheKeyRef.current = readCacheKey;
  const readCacheRef = useRef<ThreadReadCache | null>(null);

  const decryptFetched = useCallback(async (
    message: ConversationMessage,
    targetId: string,
  ): Promise<ThreadMessage> => {
    const messageEnvelope = message.envelope ?? "";
    const messageWithEnvelope = { ...message, envelope: messageEnvelope };
    const local = localDeviceRef.current;
    const directory = deviceDirectoryRef.current;
    if (!local || !directory) {
      return { ...messageWithEnvelope, text: null, encryption: "unavailable", issue: "This browser is still getting ready. Try again in a moment.", delivery: "sent" };
    }
    let senderDeviceId: string;
    try {
      senderDeviceId = readEnvelopeSenderDeviceId(messageEnvelope);
    } catch (caught) {
      return {
        ...messageWithEnvelope,
        text: null,
        encryption: "unavailable",
        issue: userFacingError(caught, "This message couldn’t be opened safely."),
        delivery: "sent",
      };
    }
    const senderDevice = directory.find(
      (device) => device.userId === message.senderId && device.deviceId === senderDeviceId,
    );
    if (senderDevice?.trust !== "verified") {
      return {
        ...messageWithEnvelope,
        text: null,
        encryption: "unverified",
        issue: senderDevice?.trust === "changed"
          ? "The sender’s safety code has changed. Compare it with them before opening this message."
          : "Compare the sender’s safety code with them before opening this message.",
        delivery: "sent",
      };
    }
    try {
      const cleartext = await decryptMessageForDevice(
        messageEnvelope,
        { conversationId: targetId, messageId: message.clientMessageId, senderId: message.senderId },
        local,
        senderDevice,
      );
      const opened = openMessageContent(cleartext, message.attachmentId);
      if (opened.kind === "invalid-attachment") {
        return {
          ...messageWithEnvelope,
          text: null,
          encryption: "unavailable",
          issue: "Attachment details could not be verified.",
          delivery: "sent",
        };
      }
      if (opened.kind === "attachment") {
        return {
          ...messageWithEnvelope,
          text: null,
          attachment: opened.attachment,
          attachmentSenderDeviceId: senderDeviceId,
          encryption: "encrypted",
          delivery: "sent",
        };
      }
      return { ...messageWithEnvelope, text: opened.text, encryption: "encrypted", delivery: "sent" };
    } catch (caught) {
      return {
        ...messageWithEnvelope,
        text: null,
        encryption: "unavailable",
        issue: userFacingError(caught, "This message can’t be opened on this device. Try the browser you used before."),
        delivery: "sent",
      };
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const requestedId = activeIdRef.current;
    if (!requestedId || !deviceDirectoryRef.current || !localDeviceRef.current) return;
    const key = readCacheKeyRef.current;
    let cache = readCacheRef.current;
    if (!cache || cache.key !== key) {
      cache?.controller?.abort();
      cache = { key, etag: null, messages: new Map(), controller: null, inFlight: false, queued: false };
      readCacheRef.current = cache;
    }
    if (cache.inFlight) { cache.queued = true; return; }
    const snapshot = cache;
    snapshot.inFlight = true;
    const controller = new AbortController();
    snapshot.controller = controller;
    const isCurrent = () => !controller.signal.aborted && activeIdRef.current === requestedId && readCacheKeyRef.current === key && readCacheRef.current === snapshot;
    try {
      const knownIds = [...snapshot.messages.values()].filter((message) => message.encryption !== "unavailable").map(({ id }) => id);
      const fetched = await fetchMessageSnapshot(requestedId, knownIds, snapshot.etag,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (!isCurrent()) return;
      if (fetched === null) { setState("ready"); setError(""); return; }
      const decrypted = await Promise.all(fetched.messages.map(async (message) => {
        const previous = snapshot.messages.get(message.id);
        if (previous && previous.encryption !== "unavailable" && (!message.envelope || message.envelope === previous.envelope)) {
          // Reuse plaintext only in this hook, with the same account, device, and trust state.
          return { ...previous, ...message, envelope: previous.envelope,
            receivedAt: previous.receivedAt ?? message.receivedAt, readAt: previous.readAt ?? message.readAt };
        }
        return decryptFetched(message, requestedId);
      }));
      if (!isCurrent()) return;
      snapshot.messages = new Map(decrypted.map((message) => [message.id, message]));
      snapshot.etag = fetched.etag;
      setMessages((current) => {
        const confirmedIds = new Set(decrypted.map(({ clientMessageId }) => clientMessageId));
        const pending = current.filter((message) => message.delivery !== "sent" && !confirmedIds.has(message.clientMessageId));
        const withReceipts = decrypted.map((message) => {
          const existing = current.find(({ id }) => id === message.id);
          return { ...message, receivedAt: existing?.receivedAt ?? message.receivedAt, readAt: existing?.readAt ?? message.readAt };
        });
        return mergeMessages<ThreadMessage>(pending, withReceipts);
      });
      setState("ready"); setError("");
    } catch (caught) {
      if (!isCurrent()) return;
      setError(userFacingError(caught, "Messages could not load."));
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) {
        snapshot.messages.clear(); snapshot.etag = null;
        setMessages([]); setState("error");
        return;
      }
      setState((current) => current === "ready" ? "ready" : "error");
    } finally {
      snapshot.inFlight = false;
      snapshot.controller = null;
      if (snapshot.queued && isCurrent()) { snapshot.queued = false; void refresh(); }
    }
  }, [decryptFetched]);

  useEffect(() => {
    messagesConversationRef.current = conversationId;
    setMessages([]); setError(""); setState("loading");
    void refresh();
    return () => {
      const cache = readCacheRef.current;
      if (cache?.key === readCacheKey) { cache.controller?.abort(); readCacheRef.current = null; }
    };
  }, [conversationId, readCacheKey, refresh]);

  usePolling(
    () => void refresh(),
    conversationId ? (isRealtimeConnected ? pollIntervals.withRealtime : pollIntervals.thread) : null,
  );

  const deliver = useCallback(async (targetId: string, pending: ThreadMessage) => {
    try {
      const saved = await postMessage(
        targetId,
        pending.envelope,
        pending.clientMessageId,
        pending.attachmentId ?? null,
      );
      if (activeIdRef.current !== targetId) return;
      setMessages((current) => {
        const existing = current.find(({ clientMessageId }) => clientMessageId === pending.clientMessageId);
        return mergeMessages<ThreadMessage>(
          current.filter(({ clientMessageId }) => clientMessageId !== pending.clientMessageId),
          [
            {
              ...saved,
              envelope: saved.envelope ?? pending.envelope,
              text: pending.text,
              attachment: pending.attachment,
              attachmentSenderDeviceId: pending.attachmentSenderDeviceId,
              encryption: "encrypted",
              delivery: "sent",
              receivedAt: existing?.receivedAt ?? saved.receivedAt,
              readAt: existing?.readAt ?? saved.readAt,
            },
          ],
        );
      });
    } catch (caught) {
      if (activeIdRef.current !== targetId) return;
      setMessages((current) =>
        current.map((message) =>
          message.clientMessageId === pending.clientMessageId
            ? { ...message, delivery: "failed" }
            : message,
        ),
      );
      setError(userFacingError(caught, "Your message was not sent."));
      if (caught instanceof ApiError && caught.status === 409) refreshDeviceDirectory();
    }
  }, [refreshDeviceDirectory]);

  const send = useCallback(
    async (text: string) => {
      if (!conversationId || !localDevice || !deviceDirectory) return;
      const missingMember = memberUserIds.find(
        (memberId) => !deviceDirectory.some((device) => device.userId === memberId && !device.revoked),
      );
      if (missingMember) {
        setError("Your contact needs to open Untold before you can send them messages.");
        return;
      }
      const activeDevices = deviceDirectory.filter(({ revoked }) => !revoked);
      const unverified = activeDevices.find(({ trust }) => trust !== "verified");
      if (unverified) {
        setError(
          unverified.trust === "changed"
            ? `The safety code for ${unverified.userName}'s device changed. Compare it with them before sending.`
            : `Verify the safety code for ${unverified.userName}'s device before sending.`,
        );
        return;
      }
      const clientMessageId = crypto.randomUUID();
      let envelope: string;
      try {
        envelope = await encryptMessageForDevices(
          text,
          { conversationId, messageId: clientMessageId, senderId: viewerId },
          localDevice,
          activeDevices,
        );
      } catch (caught) {
        setError(userFacingError(caught, "We couldn’t prepare your message safely. Please try again."));
        return;
      }
      const pending: ThreadMessage = {
        id: `pending-${clientMessageId}`,
        senderId: viewerId,
        clientMessageId,
        envelope,
        text,
        encryption: "encrypted",
        createdAt: new Date().toISOString(),
        delivery: "sending",
      };
      setMessages((current) => [...current, pending]);
      setError("");
      void deliver(conversationId, pending);
    },
    [conversationId, deliver, deviceDirectory, localDevice, memberUserIds, viewerId],
  );

  const queueAttachmentMessage = useCallback((data: AttachmentRetryData, envelope: string) => {
    const pending: ThreadMessage = {
      id: `pending-${data.context.messageId}`,
      senderId: data.context.senderId,
      clientMessageId: data.context.messageId,
      attachmentId: data.attachmentId,
      envelope,
      text: null,
      attachment: data.manifest,
      attachmentSenderDeviceId: data.deviceId,
      encryption: "encrypted",
      createdAt: new Date().toISOString(),
      delivery: "sending",
    };
    if (activeIdRef.current === data.targetId) {
      setMessages((current) => [...current, pending]);
    }
    setError("");
    void deliver(data.targetId, pending);
  }, [deliver]);

  const sendAttachment = useCallback(async (file: File): Promise<boolean> => {
    if (attachmentUpload || attachmentPreparationRef.current || !conversationId || !localDevice || !deviceDirectory) return false;
    if (file.size > maxAttachmentBytes) {
      setError(`${sanitizeAttachmentName(file.name)} is over the 20 MiB file limit.`);
      return false;
    }

    const missingMember = memberUserIds.find(
      (memberId) => !deviceDirectory.some((device) => device.userId === memberId && !device.revoked),
    );
    if (missingMember) {
      setError("Your contact needs to open Untold before you can send them messages.");
      return false;
    }
    const activeDevices = deviceDirectory.filter(({ revoked }) => !revoked);
    const unverified = activeDevices.find(({ trust }) => trust !== "verified");
    if (unverified) {
      setError(
        unverified.trust === "changed"
          ? `The safety code for ${unverified.userName}'s device changed. Compare it with them before sending.`
          : `Verify the safety code for ${unverified.userName}'s device before sending.`,
      );
      return false;
    }

    const targetId = conversationId;
    const messageId = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    const context = { conversationId: targetId, messageId, senderId: viewerId };
    setError("");
    const preparation = new AbortController();
    attachmentPreparationRef.current = preparation;
    setAttachmentUpload({ conversationId: targetId, fileName: sanitizeAttachmentName(file.name), progress: 0, phase: "optimizing" });

    let ciphertext: Uint8Array<ArrayBuffer> | null = null;
    try {
      const prepared = await prepareAttachment(file, {
        signal: preparation.signal,
        onProgress: (progress) => setAttachmentUpload({ conversationId: targetId, fileName: sanitizeAttachmentName(file.name), progress, phase: "optimizing" }),
      });
      const clearFile = prepared.bytes;
      let encryptedFile: Awaited<ReturnType<typeof encryptAttachmentBytes>>;
      try {
        preparation.signal.throwIfAborted();
        setAttachmentUpload({ conversationId: targetId, fileName: prepared.name, progress: 0, phase: "preparing" });
        encryptedFile = await encryptAttachmentBytes(clearFile, context, localDevice, attachmentId);
      } finally {
        clearFile.fill(0);
      }
      ciphertext = encryptedFile.ciphertext;
      const manifest: AttachmentManifest = {
        kind: "untold-attachment",
        version: prepared.compression ? 2 : 1,
        id: attachmentId,
        name: prepared.name,
        contentType: prepared.contentType,
        size: prepared.bytes.byteLength,
        ...(prepared.compression ? { compression: prepared.compression } : {}),
        key: encryptedFile.key,
        nonce: encryptedFile.nonce,
      };
      const envelope = await encryptMessageForDevices(
        encodeAttachmentMessage(manifest),
        context,
        localDevice,
        activeDevices,
      );
      preparation.signal.throwIfAborted();
      const retryData: AttachmentRetryData = {
        targetId,
        context,
        attachmentId,
        manifest,
        ciphertext,
        deviceId: localDevice.deviceId,
      };
      attachmentRetryRef.current = retryData;
      setAttachmentUpload({ conversationId: targetId, fileName: manifest.name, progress: 0, phase: "uploading" });
      await uploadEncryptedAttachment(
        targetId,
        attachmentId,
        localDevice.deviceId,
        ciphertext,
        (progress) => setAttachmentUpload({
          conversationId: targetId,
          fileName: manifest.name,
          progress,
          phase: "uploading",
        }),
        preparation.signal,
      );
      preparation.signal.throwIfAborted();
      queueAttachmentMessage(retryData, envelope);
      attachmentRetryRef.current = null;
      ciphertext.fill(0);
      ciphertext = null;
      setAttachmentUpload(null);
      return true;
    } catch (caught) {
      if (preparation.signal.aborted) {
        setAttachmentUpload(null);
        return false;
      }
      const message = userFacingError(caught, "The file couldn’t be sent. Please try again.");
      setError(message);
      setAttachmentUpload((current) => current?.conversationId === targetId
        ? { ...current, phase: "failed", error: message, retryable: Boolean(attachmentRetryRef.current) }
        : current);
      return false;
    } finally {
      if (attachmentPreparationRef.current === preparation) attachmentPreparationRef.current = null;
      if (ciphertext && attachmentRetryRef.current?.ciphertext !== ciphertext) ciphertext.fill(0);
    }
  }, [attachmentUpload, conversationId, deviceDirectory, localDevice, memberUserIds, queueAttachmentMessage, viewerId]);

  const retryAttachment = useCallback(async (): Promise<boolean> => {
    const retryData = attachmentRetryRef.current;
    const local = localDeviceRef.current;
    const directory = deviceDirectoryRef.current;
    if (!retryData || !local || !directory || conversationId !== retryData.targetId || attachmentPreparationRef.current) return false;
    if (local.deviceId !== retryData.deviceId) {
      setError("This browser’s encryption device changed. Select the file again to send it.");
      return false;
    }

    const activeDevices = directory.filter(({ revoked }) => !revoked);
    if (
      memberUserIds.some((memberId) => !activeDevices.some((device) => device.userId === memberId)) ||
      activeDevices.some(({ trust }) => trust !== "verified")
    ) {
      setError("Verify every conversation device before retrying this file.");
      return false;
    }

    setError("");
    setAttachmentUpload({ conversationId: retryData.targetId, fileName: retryData.manifest.name, progress: 0, phase: "uploading" });
    const preparation = new AbortController();
    attachmentPreparationRef.current = preparation;
    try {
      const envelope = await encryptMessageForDevices(
        encodeAttachmentMessage(retryData.manifest),
        retryData.context,
        local,
        activeDevices,
      );
      preparation.signal.throwIfAborted();
      await uploadEncryptedAttachment(
        retryData.targetId,
        retryData.attachmentId,
        local.deviceId,
        retryData.ciphertext,
        (progress) => setAttachmentUpload({
          conversationId: retryData.targetId,
          fileName: retryData.manifest.name,
          progress,
          phase: "uploading",
        }),
        preparation.signal,
      );
      preparation.signal.throwIfAborted();
      queueAttachmentMessage(retryData, envelope);
      attachmentRetryRef.current = null;
      retryData.ciphertext.fill(0);
      setAttachmentUpload(null);
      return true;
    } catch (caught) {
      if (preparation.signal.aborted) return false;
      const message = userFacingError(caught, "The file couldn’t be sent. Please try again.");
      setError(message);
      setAttachmentUpload({
        conversationId: retryData.targetId,
        fileName: retryData.manifest.name,
        progress: 0,
        phase: "failed",
        error: message,
        retryable: true,
      });
      return false;
    } finally {
      if (attachmentPreparationRef.current === preparation) attachmentPreparationRef.current = null;
    }
  }, [conversationId, memberUserIds, queueAttachmentMessage]);

  const discardAttachmentUpload = useCallback(async (): Promise<boolean> => {
    attachmentPreparationRef.current?.abort();
    const retryData = attachmentRetryRef.current;
    if (retryData && retryData.targetId === conversationId) {
      try {
        await discardEncryptedAttachment(retryData.targetId, retryData.attachmentId);
      } catch (caught) {
        setError(userFacingError(caught, "The unfinished upload could not be removed."));
        return false;
      }
      retryData.ciphertext.fill(0);
      attachmentRetryRef.current = null;
    }
    setAttachmentUpload(null);
    return true;
  }, [conversationId]);

  const retry = useCallback(
    async (clientMessageId: string) => {
      if (!conversationId || !localDeviceRef.current || !deviceDirectoryRef.current) return;
      const failed = messages.find((message) => message.clientMessageId === clientMessageId);
      if (!failed) return;
      const currentDevices = deviceDirectoryRef.current;
      const activeDevices = currentDevices.filter(({ revoked }) => !revoked);
      if (memberUserIds.some((memberId) => !activeDevices.some((device) => device.userId === memberId))) {
        setError("A conversation member has no active encryption device. Refresh the device list before retrying.");
        return;
      }
      if (activeDevices.some(({ trust }) => trust !== "verified")) {
        setError("Verify every conversation device before retrying this message.");
        return;
      }
      if (failed.attachment && failed.attachmentSenderDeviceId !== localDeviceRef.current.deviceId) {
        setError("This browser’s encryption device changed. Select the file again to send it.");
        return;
      }
      let envelope: string;
      try {
        envelope = await encryptMessageForDevices(
          failed.attachment ? encodeAttachmentMessage(failed.attachment) : failed.text ?? "",
          { conversationId, messageId: failed.clientMessageId, senderId: failed.senderId },
          localDeviceRef.current,
          activeDevices,
        );
      } catch (caught) {
        setError(userFacingError(caught, "We couldn’t prepare your message again. Please try again."));
        return;
      }
      const pending = { ...failed, envelope, delivery: "sending" as const };
      setMessages((current) =>
        current.map((message) => (message.clientMessageId === clientMessageId ? pending : message)),
      );
      setError("");
      void deliver(conversationId, pending);
    },
    [conversationId, deliver, memberUserIds, messages],
  );

  return {
    messages: messagesConversationRef.current === conversationId ? messages : [],
    state,
    error,
    refresh,
    send,
    sendAttachment,
    retryAttachment,
    discardAttachmentUpload,
    attachmentUpload,
    retry,
  };
}
