"use client";

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, ChevronDown, FileText, Paperclip, Search, Send } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { ContactAvatar } from "@/components/messaging/contact-avatar";
import { StartConversationForm } from "@/components/messaging/start-conversation-form";
import {
  deviceFingerprint,
  type DeviceTrust,
  type PublicDevice,
} from "@/crypto/src/protocol";
import {
  useConversationDeviceDirectory,
  useConversationList,
  useConversationThread,
  useLocalMessagingDevice,
  type ThreadMessage,
} from "@/components/messaging/use-messaging";
import {
  attachmentPreviewKind,
  formatAttachmentSize,
} from "@/lib/messaging/attachments";
import { fetchAttachmentDownloadUrl } from "@/lib/messaging/api-client";
import { decryptAttachmentBytes, maxAttachmentBytes } from "@/crypto/src/protocol";
import { decodeAttachmentBytes } from "@/lib/messaging/attachment-compression";
import { readBoundedStream } from "@/lib/messaging/bounded-stream";
import { validateAttachmentPreview } from "@/lib/messaging/prepare-attachment";
import {
  conversationActivityAt,
  conversationTitle,
  formatMessageTime,
  otherMembers,
  searchConversations,
  type ConversationSummary,
} from "@/lib/messaging/people";
import { maxMessageLength, normalizeMessageText } from "@/lib/messaging/text-envelope";

function ConversationRow({
  conversation,
  viewerId,
  isSelected,
  disabled,
  onSelect,
}: {
  conversation: ConversationSummary;
  viewerId: string;
  isSelected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const [person] = otherMembers(conversation, viewerId);
  const last = conversation.lastMessage;
  const preview = last
    ? `${last.senderId === viewerId ? "You: " : ""}${last.hasAttachment ? "Attachment" : last.text ?? "Encrypted message"}`
    : "No messages yet";
  const activityAt = conversationActivityAt(conversation);

  return (
    <li>
      <button
        aria-pressed={isSelected}
        className={`conversation-row${isSelected ? " is-selected" : ""}`}
        disabled={disabled}
        onClick={onSelect}
        type="button"
      >
        {person ? <ContactAvatar person={person} /> : null}
        <span className="conversation-row__body">
          <span className="conversation-row__topline">
            <strong>{conversationTitle(conversation, viewerId)}</strong>
            <time dateTime={activityAt}>{formatMessageTime(activityAt)}</time>
          </span>
          <span className="conversation-row__preview">{preview}</span>
        </span>
      </button>
    </li>
  );
}

function AttachmentMessage({
  conversationId,
  message,
}: {
  conversationId: string;
  message: ThreadMessage;
}) {
  const attachment = message.attachment;
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attachmentRef = useRef<HTMLDivElement>(null);
  const mediaUrlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const loadingRef = useRef(false);
  const operationRef = useRef<AbortController | null>(null);
  const previewKind = attachment ? attachmentPreviewKind(attachment.contentType) : null;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      operationRef.current?.abort();
      if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
    };
  }, []);

  async function decryptedBytes(): Promise<Uint8Array<ArrayBuffer>> {
    if (!attachment || !message.attachmentSenderDeviceId || !message.attachmentId) {
      throw new Error("Attachment details are unavailable.");
    }
    const url = await fetchAttachmentDownloadUrl(message.attachmentId);
    if (!aliveRef.current) throw new DOMException("File opening cancelled.", "AbortError");
    const controller = new AbortController();
    operationRef.current = controller;
    const response = await fetch(url, {
      cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]), redirect: "error",
    });
    if (!response.ok) throw new Error("The encrypted file could not be downloaded.");
    const expectedCiphertextBytes = attachment.size + 16;
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) !== expectedCiphertextBytes) {
      void response.body?.cancel();
      throw new Error("The encrypted file size does not match its message details.");
    }
    if (!response.body) throw new Error("The encrypted file could not be read.");
    const ciphertext = await readBoundedStream(response.body, {
      maxBytes: maxAttachmentBytes + 16, expectedBytes: expectedCiphertextBytes,
      signal: controller.signal, timeoutMs: 30_000,
    });
    try {
      const plaintext = await decryptAttachmentBytes(
        ciphertext,
        { conversationId, messageId: message.clientMessageId, senderId: message.senderId },
        message.attachmentSenderDeviceId,
        attachment.id,
        attachment.key,
        attachment.nonce,
        attachment.size,
      );
      return await decodeAttachmentBytes(plaintext, attachment, controller.signal);
    } finally {
      ciphertext.fill(0);
    }
  }

  async function loadMedia() {
    if (!attachment || !previewKind || loadingRef.current || mediaUrlRef.current) return;
    loadingRef.current = true;
    setBusy(true);
    setError("");
    let cleartext: Uint8Array<ArrayBuffer> | null = null;
    try {
      cleartext = await decryptedBytes();
      await validateAttachmentPreview(cleartext, attachment.contentType, operationRef.current?.signal);
      if (!aliveRef.current) return;
      const url = URL.createObjectURL(new Blob([cleartext.buffer], { type: attachment.contentType }));
      mediaUrlRef.current = url;
      setMediaUrl(url);
    } catch (caught) {
      if (aliveRef.current) setError(caught instanceof Error ? caught.message : "File could not be opened.");
    } finally {
      cleartext?.fill(0);
      loadingRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }

  if (!attachment) return null;

  async function download() {
    if (!attachment || busy || loadingRef.current) return;
    loadingRef.current = true;
    setBusy(true);
    setError("");
    let cleartext: Uint8Array<ArrayBuffer> | null = null;
    try {
      cleartext = await decryptedBytes();
      const url = URL.createObjectURL(
        new Blob([cleartext.buffer], { type: "application/octet-stream" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      if (aliveRef.current) setError(caught instanceof Error ? caught.message : "The file could not be downloaded.");
    } finally {
      cleartext?.fill(0);
      loadingRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }

  return (
    <div className="message-attachment" ref={attachmentRef}>
      {previewKind === "image" ? (
        mediaUrl ? (
          <Image
            alt={attachment.name}
            className="message-attachment__image"
            height={320}
            src={mediaUrl}
            unoptimized
            width={340}
          />
        ) : (
          <button className="message-attachment__preview-button" disabled={busy} onClick={() => void loadMedia()} type="button">
            {busy ? "Opening photo…" : "Load photo preview"}
          </button>
        )
      ) : null}
      {previewKind === "video" ? (
        mediaUrl ? (
          <>
            {/* biome-ignore lint/a11y/useMediaCaption: Arbitrary user videos may have no separate captions file; the UI states this limitation and keeps download available. */}
            <video aria-label={attachment.name} className="message-attachment__media" controls playsInline preload="none" src={mediaUrl} />
            <span className="message-attachment__caption-note">Captions depend on the shared video file.</span>
          </>
        ) : (
          <button className="message-attachment__preview-button" disabled={busy} onClick={() => void loadMedia()} type="button">
            {busy ? "Opening video…" : "Load video"}
          </button>
        )
      ) : null}
      {previewKind === "audio" ? (
        mediaUrl ? (
          <>
            {/* biome-ignore lint/a11y/useMediaCaption: Arbitrary user audio may have no transcript file; the UI states this limitation and keeps download available. */}
            <audio aria-label={attachment.name} className="message-attachment__media" controls preload="none" src={mediaUrl} />
            <span className="message-attachment__caption-note">A transcript may not be included with this audio file.</span>
          </>
        ) : (
          <button className="message-attachment__preview-button" disabled={busy} onClick={() => void loadMedia()} type="button">
            {busy ? "Opening audio…" : "Load audio"}
          </button>
        )
      ) : null}
      <div className="message-attachment__details">
        <span aria-hidden="true" className="message-attachment__icon">
          <FileText size={16} strokeWidth={1.8} />
        </span>
        <span className="message-attachment__name">
          <strong>{attachment.name}</strong>
          <small>
            {formatAttachmentSize(attachment.compression?.originalSize ?? attachment.size)}
            {attachment.compression ? ` · Compressed to ${formatAttachmentSize(attachment.size)}` : ""}
          </small>
        </span>
        <button disabled={busy} onClick={() => void download()} type="button">
          {busy ? "Preparing…" : "Download"}
        </button>
      </div>
      {error ? <p className="message-attachment__error" role="alert">{error}</p> : null}
    </div>
  );
}

function MessageBubble({
  message,
  isOutgoing,
  conversationId,
  onRetry,
}: {
  message: ThreadMessage;
  isOutgoing: boolean;
  conversationId: string;
  onRetry: () => void;
}) {
  return (
    <li className={`message-row${isOutgoing ? " message-row--outgoing" : " message-row--incoming"}`}>
      <article className="message-bubble">
        {message.attachment ? (
          <AttachmentMessage conversationId={conversationId} message={message} />
        ) : (
          <p>{message.text ?? message.issue ?? "This message cannot be opened on this device."}</p>
        )}
        <footer>
          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
          {message.delivery === "sent" ? (
            <span className={`message-bubble__encryption message-bubble__encryption--${message.encryption}`}>
              {message.encryption === "encrypted"
                ? "Encrypted"
                : message.encryption === "unverified"
                  ? "Unverified device"
                  : "Unavailable"}
            </span>
          ) : null}
          {message.delivery === "sending" ? (
            <span className="message-bubble__local-status">Sending…</span>
          ) : null}
          {message.delivery === "failed" ? (
            <span className="message-bubble__status--failed">
              Not sent
              <button onClick={onRetry} type="button">
                Retry
              </button>
            </span>
          ) : null}
        </footer>
      </article>
    </li>
  );
}

function ConversationDetails({
  conversation,
  viewerId,
  isRealtimeConnected,
  devices,
  onVerifyDevice,
}: {
  conversation: ConversationSummary;
  viewerId: string;
  isRealtimeConnected: boolean;
  devices: DeviceTrust[] | null;
  onVerifyDevice: (device: PublicDevice) => Promise<void>;
}) {
  return (
    <details className="conversation-details">
      <summary>
        <ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} />
        Details
      </summary>
      <div className="conversation-details__popover">
        <h3>About this conversation</h3>
        <dl>
          {otherMembers(conversation, viewerId).map((member) => (
            <div className="conversation-details__row" key={member.id}>
              <dt>Contact</dt>
              <dd>
                {member.name} · {member.email}
              </dd>
            </div>
          ))}
          <div className="conversation-details__row">
            <dt>Updates</dt>
            <dd>{isRealtimeConnected ? "Live" : "Refreshing every few seconds"}</dd>
          </div>
          <div className="conversation-details__row">
            <dt>Encryption devices</dt>
            <dd>
              <DeviceSafetyList devices={devices ?? []} onVerify={onVerifyDevice} />
            </dd>
          </div>
        </dl>
      </div>
    </details>
  );
}

function DeviceSafetyList({
  devices,
  onVerify,
}: {
  devices: DeviceTrust[];
  onVerify: (device: PublicDevice) => Promise<void>;
}) {
  if (devices.length === 0) return <span>No registered devices yet.</span>;
  return (
    <div className="device-safety-list">
      <p>Compare each new safety code with its owner over a separate trusted channel.</p>
      {devices.map((device) => (
        <DeviceSafetyCode device={device} key={device.deviceId} onVerify={onVerify} />
      ))}
    </div>
  );
}

function DeviceSafetyCode({
  device,
  onVerify,
}: {
  device: DeviceTrust;
  onVerify: (device: PublicDevice) => Promise<void>;
}) {
  const [fingerprint, setFingerprint] = useState("Calculating safety code…");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    let cancelled = false;
    void deviceFingerprint(device).then((value) => {
      if (!cancelled) setFingerprint(value);
    }).catch(() => {
      if (!cancelled) setFingerprint("Safety code unavailable");
    });
    return () => { cancelled = true; };
  }, [device]);

  async function copyFingerprint() {
    try {
      await navigator.clipboard.writeText(fingerprint);
      setFeedback("Copied");
    } catch {
      setFeedback("Select and copy the code");
    }
  }

  async function verify() {
    try {
      await onVerify(device);
      setFeedback("Device verified on this browser");
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "Device could not be verified.");
    }
  }

  return (
    <div className={`device-safety-card device-safety-card--${device.trust}`}>
      <div className="device-safety-card__heading">
        <strong>{device.userName} · {device.deviceName}</strong>
        <span>
          {device.revoked
            ? "Removed · history key"
            : device.trust === "verified"
              ? "Verified here"
              : device.trust === "changed"
                ? "Key changed"
                : "New device"}
        </span>
      </div>
      <code>{fingerprint}</code>
      <div className="device-safety-card__actions">
        <button onClick={copyFingerprint} type="button">Copy safety code</button>
        {device.trust === "new" ? (
          <button onClick={verify} type="button">I compared this code</button>
        ) : device.trust === "changed" ? (
          <span>Sending and reading are blocked for this changed key.</span>
        ) : null}
        {feedback ? <span aria-live="polite">{feedback}</span> : null}
      </div>
    </div>
  );
}

export function ConversationWorkspace({ initialSelectedId }: { initialSelectedId: string | null }) {
  const router = useRouter();
  const { session } = useAccountSession();
  const viewerId = session?.id ?? "";
  const localDevice = useLocalMessagingDevice(viewerId);
  const searchId = useId();
  const composerId = useId();
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const threadHeadingRef = useRef<HTMLHeadingElement>(null);
  const historyRef = useRef<HTMLOListElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentPickerId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(initialSelectedId));
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const refreshThreadRef = useRef<() => void>(() => undefined);

  const list = useConversationList((conversationId) => {
    if (conversationId === selectedIdRef.current) refreshThreadRef.current();
  });
  const visibleConversations = useMemo(
    () => searchConversations(list.conversations, searchQuery, viewerId),
    [list.conversations, searchQuery, viewerId],
  );
  const selectedConversation = list.conversations.find(({ id }) => id === selectedId);
  const directory = useConversationDeviceDirectory(selectedId, viewerId, localDevice.device);
  const trustedDevices = directory.state === "ready" ? directory.devices : null;
  const selectedMemberIds = selectedConversation?.members.map(({ id }) => id) ?? [];
  const missingMemberDevice = selectedConversation?.members.find(
    ({ id }) => !directory.devices?.some((device) => device.userId === id && !device.revoked),
  );
  const thread = useConversationThread(
    selectedId,
    viewerId,
    list.isRealtimeConnected,
    localDevice.device,
    trustedDevices,
    selectedMemberIds,
    () => void directory.refresh(),
  );
  refreshThreadRef.current = () => void thread.refresh();

  // On wide screens, open the most recent conversation once the list arrives.
  useEffect(() => {
    if (selectedId || list.conversations.length === 0) return;
    if (!window.matchMedia("(max-width: 680px)").matches) setSelectedId(list.conversations[0].id);
  }, [list.conversations, selectedId]);

  const lastMessageId = thread.messages.at(-1)?.id;
  useEffect(() => {
    if (!lastMessageId) return;
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [lastMessageId]);

  function selectConversation(conversationId: string) {
    if (thread.attachmentUpload) return;
    setSelectedId(conversationId);
    setMobileThreadOpen(true);
    setDraft("");
    if (window.matchMedia("(max-width: 680px)").matches) {
      window.requestAnimationFrame(() => threadHeadingRef.current?.focus());
    }
    router.replace(`/app/conversations?conversation=${encodeURIComponent(conversationId)}`, {
      scroll: false,
    });
  }

  function returnToConversationList() {
    if (thread.attachmentUpload) return;
    setMobileThreadOpen(false);
    if (window.matchMedia("(max-width: 680px)").matches) {
      window.requestAnimationFrame(() => listHeadingRef.current?.focus());
    }
    router.replace("/app/conversations", { scroll: false });
  }

  function submitMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = normalizeMessageText(draft);
    if (!selectedConversation || text === null) return;
    thread.send(text);
    setDraft("");
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitMessage();
    }
  }

  function handleAttachmentSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    setAttachmentNotice("");
    if (files.length > 5) {
      setAttachmentNotice("Choose up to 5 files at a time.");
      return;
    }
    void (async () => {
      for (const file of files) {
        if (!(await thread.sendAttachment(file))) break;
      }
    })();
  }

  const selectedTitle = selectedConversation
    ? conversationTitle(selectedConversation, viewerId)
    : "";
  const [selectedPerson] = selectedConversation ? otherMembers(selectedConversation, viewerId) : [];
  const currentAttachmentUpload = thread.attachmentUpload?.conversationId === selectedId
    ? thread.attachmentUpload
    : null;
  const canSend =
    directory.state === "ready" &&
    localDevice.state === "ready" &&
    Boolean(directory.devices?.length) &&
    !selectedMemberIds.some((memberId) => !directory.devices?.some((device) => device.userId === memberId)) &&
    !directory.devices?.some(({ trust, revoked }) => !revoked && trust !== "verified");

  return (
    <section
      aria-label="Messaging workspace"
      className={`messaging-workspace${mobileThreadOpen ? " is-thread-open" : ""}`}
    >
      <aside aria-label="Conversation list" className="conversation-list-panel">
        <header className="conversation-list-panel__header">
          <div>
            <p className="messaging-kicker">Your conversations</p>
            <h2 ref={listHeadingRef} tabIndex={-1}>
              Messages
            </h2>
          </div>
          <span className="conversation-count">{list.conversations.length}</span>
        </header>

        <StartConversationForm
          onStarted={(conversation) => {
            list.upsert(conversation);
            selectConversation(conversation.id);
          }}
        />

        {localDevice.state === "loading" ? (
          <p className="device-setup-note" role="status">Setting up this browser’s encryption keys…</p>
        ) : localDevice.state === "error" ? (
          <div className="device-setup-note device-setup-note--error" role="alert">
            <span>{localDevice.error}</span>
            <button onClick={() => void localDevice.retry()} type="button">Try again</button>
          </div>
        ) : null}

        {list.conversations.length > 0 ? (
          <label className="conversation-search" htmlFor={searchId}>
            <Search aria-hidden="true" size={16} strokeWidth={1.8} />
            <span className="sr-only">Search conversations</span>
            <input
              autoComplete="off"
              id={searchId}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search conversations"
              type="search"
              value={searchQuery}
            />
          </label>
        ) : null}

        {list.state === "loading" ? (
          <div aria-live="polite" className="conversation-list__empty" role="status">
            <strong>Loading conversations…</strong>
          </div>
        ) : list.state === "error" ? (
          <div className="conversation-list__empty" role="alert">
            <strong>Conversations could not load</strong>
            <span>{list.error}</span>
          </div>
        ) : visibleConversations.length > 0 ? (
          <ul aria-label="Conversations" className="conversation-list">
            {visibleConversations.map((conversation) => (
              <ConversationRow
                conversation={conversation}
                disabled={Boolean(thread.attachmentUpload)}
                isSelected={conversation.id === selectedId}
                key={conversation.id}
                onSelect={() => selectConversation(conversation.id)}
                viewerId={viewerId}
              />
            ))}
          </ul>
        ) : list.conversations.length > 0 ? (
          <div aria-live="polite" className="conversation-list__empty" role="status">
            <strong>No conversations found</strong>
            <span>Try another name or word.</span>
          </div>
        ) : (
          <div className="conversation-list__empty">
            <strong>No conversations yet</strong>
            <span>Enter a friend’s account email above to start one.</span>
          </div>
        )}

        <p className="conversation-list-panel__note">
          {list.isRealtimeConnected ? "Live updates on" : "Refreshes automatically"} · device encryption
        </p>
      </aside>

      {selectedConversation ? (
        <section aria-label={`Conversation with ${selectedTitle}`} className="conversation-panel">
          <header className="conversation-header">
            <button className="conversation-back" disabled={Boolean(thread.attachmentUpload)} onClick={returnToConversationList} type="button">
              <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
              All conversations
            </button>
            <div className="conversation-header__person">
              {selectedPerson ? <ContactAvatar large person={selectedPerson} /> : null}
              <div>
                <p className="messaging-kicker">{selectedPerson?.email}</p>
                <h2 ref={threadHeadingRef} tabIndex={-1}>
                  {selectedTitle}
                </h2>
              </div>
            </div>
            <ConversationDetails
              devices={directory.state === "ready" ? directory.devices : null}
              conversation={selectedConversation}
              isRealtimeConnected={list.isRealtimeConnected}
              onVerifyDevice={directory.verify}
              viewerId={viewerId}
            />
          </header>

          <p className="conversation-disclaimer">
            <span>Encrypted on devices</span>
            New messages and files are encrypted before storage. Verify each device safety code first.
            Protocol v1 has no forward secrecy or independent review. Someone who gains access to
            an unlocked device may be able to read its messages.
          </p>

          {directory.state === "loading" ? (
            <p className="messaging-device-status" role="status">Loading and checking conversation device keys…</p>
          ) : directory.state === "error" ? (
            <p className="messaging-error" role="alert">{directory.error}</p>
          ) : directory.devices?.some(({ trust, revoked }) => !revoked && trust !== "verified") ? (
            <p className="messaging-device-status messaging-device-status--warning">
              Verify every new safety code in Details before sending or opening messages from that device.
            </p>
          ) : missingMemberDevice ? (
            <p className="messaging-device-status messaging-device-status--warning">
              Ask {missingMemberDevice.name} to sign in on a browser once so Untold can register their encryption device.
            </p>
          ) : null}

          {thread.state === "loading" ? (
            <div
              className="message-history__empty"
              role={localDevice.error || directory.error ? "alert" : "status"}
            >
              <p>{localDevice.error || directory.error || "Loading messages…"}</p>
            </div>
          ) : thread.state === "error" ? (
            <div className="message-history__empty" role="alert">
              <p>{thread.error}</p>
            </div>
          ) : thread.messages.length > 0 ? (
            <ol aria-label={`Messages with ${selectedTitle}`} className="message-history" ref={historyRef}>
              {thread.messages.map((message) => (
                <MessageBubble
                  conversationId={selectedConversation.id}
                  isOutgoing={message.senderId === viewerId}
                  key={message.clientMessageId}
                  message={message}
                  onRetry={() => thread.retry(message.clientMessageId)}
                />
              ))}
            </ol>
          ) : (
            <div className="message-history__empty">
              <p>Say hello to {selectedTitle}.</p>
            </div>
          )}

          {thread.error ? (
            <p className="messaging-error" role="alert">
              {thread.error}
            </p>
          ) : null}

          <form className="message-composer" onSubmit={submitMessage}>
            <label className="sr-only" htmlFor={composerId}>
              Write a message
            </label>
            <textarea
              id={composerId}
              maxLength={maxMessageLength}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Write a message…"
              rows={2}
              value={draft}
            />
            {currentAttachmentUpload ? (
              <div aria-live="polite" className="message-composer__upload" role="status">
                <div>
                  <strong>{currentAttachmentUpload.fileName}</strong>
                  <span>
                    {currentAttachmentUpload.phase === "optimizing"
                      ? currentAttachmentUpload.progress > 0
                        ? `Optimizing video · ${currentAttachmentUpload.progress}% · Keep this tab open`
                        : "Optimizing file on this device…"
                      : currentAttachmentUpload.phase === "preparing"
                      ? "Encrypting on this device…"
                      : currentAttachmentUpload.phase === "failed"
                        ? currentAttachmentUpload.error ?? "Upload failed."
                        : `Uploading encrypted file · ${currentAttachmentUpload.progress}%`}
                  </span>
                </div>
                {currentAttachmentUpload.phase === "failed" ? (
                  <div className="message-composer__upload-actions">
                    {currentAttachmentUpload.retryable ? (
                      <button onClick={() => void thread.retryAttachment()} type="button">Retry upload</button>
                    ) : null}
                    <button onClick={() => void thread.discardAttachmentUpload()} type="button">Discard</button>
                  </div>
                ) : (
                  <div className="message-composer__upload-actions">
                    <progress max={100} value={currentAttachmentUpload.progress} />
                    {currentAttachmentUpload.phase === "optimizing" || currentAttachmentUpload.phase === "preparing" ? (
                      <button onClick={() => void thread.discardAttachmentUpload()} type="button">Cancel</button>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
            {attachmentNotice ? <p className="message-composer__notice" role="alert">{attachmentNotice}</p> : null}
            <input
              accept="*/*"
              className="sr-only"
              id={attachmentPickerId}
              multiple
              onChange={handleAttachmentSelection}
              ref={attachmentInputRef}
              tabIndex={-1}
              type="file"
            />
            <div className="message-composer__footer">
              <span>Enter to send · Shift+Enter for a new line · Files up to 20 MiB</span>
              <div>
                <span className="message-composer__count">
                  {draft.length}/{maxMessageLength}
                </span>
                <button
                  aria-label="Attach photos or files"
                  className="message-composer__attach"
                  disabled={!canSend || Boolean(currentAttachmentUpload)}
                  onClick={() => attachmentInputRef.current?.click()}
                  type="button"
                >
                  <Paperclip aria-hidden="true" size={17} strokeWidth={1.8} />
                </button>
              <button
                disabled={
                  normalizeMessageText(draft) === null ||
                  !canSend ||
                  Boolean(currentAttachmentUpload)
                }
                type="submit"
              >
                  Send <Send aria-hidden="true" size={15} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : (
        <section className="conversation-panel conversation-panel--empty">
          <p>
            {list.conversations.length > 0
              ? "Select a conversation to view its messages."
              : "Start a conversation with someone who has an Untold account."}
          </p>
        </section>
      )}
    </section>
  );
}
