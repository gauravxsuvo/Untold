"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { ContactAvatar } from "@/components/messaging/contact-avatar";
import { StartConversationForm } from "@/components/messaging/start-conversation-form";
import {
  useConversationList,
  useConversationThread,
  type ThreadMessage,
} from "@/components/messaging/use-messaging";
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
  onSelect,
}: {
  conversation: ConversationSummary;
  viewerId: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [person] = otherMembers(conversation, viewerId);
  const last = conversation.lastMessage;
  const preview = last
    ? `${last.senderId === viewerId ? "You: " : ""}${last.text ?? "Unsupported message"}`
    : "No messages yet";
  const activityAt = conversationActivityAt(conversation);

  return (
    <li>
      <button
        aria-pressed={isSelected}
        className={`conversation-row${isSelected ? " is-selected" : ""}`}
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

function MessageBubble({
  message,
  isOutgoing,
  onRetry,
}: {
  message: ThreadMessage;
  isOutgoing: boolean;
  onRetry: () => void;
}) {
  return (
    <li className={`message-row${isOutgoing ? " message-row--outgoing" : " message-row--incoming"}`}>
      <article className="message-bubble">
        <p>{message.text ?? "This message uses a format this version of Untold can't show."}</p>
        <footer>
          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
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
}: {
  conversation: ConversationSummary;
  viewerId: string;
  isRealtimeConnected: boolean;
}) {
  return (
    <details className="conversation-details">
      <summary>Details</summary>
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
            <dt>Privacy</dt>
            <dd>Sent over HTTPS · stored on the server · not end-to-end encrypted</dd>
          </div>
        </dl>
      </div>
    </details>
  );
}

export function ConversationWorkspace({ initialSelectedId }: { initialSelectedId: string | null }) {
  const router = useRouter();
  const { session } = useAccountSession();
  const viewerId = session?.id ?? "";
  const searchId = useId();
  const composerId = useId();
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const threadHeadingRef = useRef<HTMLHeadingElement>(null);
  const historyRef = useRef<HTMLOListElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(initialSelectedId));
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const refreshThreadRef = useRef<() => void>(() => undefined);

  const list = useConversationList((conversationId) => {
    if (conversationId === selectedIdRef.current) refreshThreadRef.current();
  });
  const thread = useConversationThread(selectedId, viewerId, list.isRealtimeConnected);
  refreshThreadRef.current = () => void thread.refresh();

  const visibleConversations = useMemo(
    () => searchConversations(list.conversations, searchQuery, viewerId),
    [list.conversations, searchQuery, viewerId],
  );
  const selectedConversation = list.conversations.find(({ id }) => id === selectedId);

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

  const selectedTitle = selectedConversation
    ? conversationTitle(selectedConversation, viewerId)
    : "";
  const [selectedPerson] = selectedConversation ? otherMembers(selectedConversation, viewerId) : [];

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

        {list.conversations.length > 0 ? (
          <label className="conversation-search" htmlFor={searchId}>
            <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
              <circle cx="8.7" cy="8.7" r="5.6" stroke="currentColor" strokeWidth="1.5" />
              <path d="m13 13 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
            </svg>
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
          {list.isRealtimeConnected ? "Live updates on" : "Refreshes automatically"} · not
          end-to-end encrypted
        </p>
      </aside>

      {selectedConversation ? (
        <section aria-label={`Conversation with ${selectedTitle}`} className="conversation-panel">
          <header className="conversation-header">
            <button className="conversation-back" onClick={returnToConversationList} type="button">
              <span aria-hidden="true">←</span> All conversations
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
              conversation={selectedConversation}
              isRealtimeConnected={list.isRealtimeConnected}
              viewerId={viewerId}
            />
          </header>

          <p className="conversation-disclaimer">
            <span>Not end-to-end encrypted</span>
            Messages are sent over HTTPS and stored on Untold’s server.
          </p>

          {thread.state === "loading" ? (
            <div className="message-history__empty" role="status">
              <p>Loading messages…</p>
            </div>
          ) : thread.state === "error" ? (
            <div className="message-history__empty" role="alert">
              <p>{thread.error}</p>
            </div>
          ) : thread.messages.length > 0 ? (
            <ol aria-label={`Messages with ${selectedTitle}`} className="message-history" ref={historyRef}>
              {thread.messages.map((message) => (
                <MessageBubble
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

          {thread.state === "ready" && thread.error ? (
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
            <div className="message-composer__footer">
              <span>Enter to send · Shift+Enter for a new line</span>
              <div>
                <span className="message-composer__count">
                  {draft.length}/{maxMessageLength}
                </span>
                <button disabled={normalizeMessageText(draft) === null} type="submit">
                  Send <span aria-hidden="true">↑</span>
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
