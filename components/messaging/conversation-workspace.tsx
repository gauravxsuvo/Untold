"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  appendPreviewMessage,
  initialConversations,
  searchConversations,
  type MockContact,
  type MockConversation,
  type MockMessage,
} from "@/lib/messaging/mock-data";

type ConversationWorkspaceProps = {
  initialSelectedId: string | null;
};

function ContactAvatar({ contact, large = false }: { contact: MockContact; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`contact-avatar contact-avatar--${contact.tone}${large ? " contact-avatar--large" : ""}`}
    >
      {contact.initials}
    </span>
  );
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function ConversationRow({
  conversation,
  isSelected,
  onSelect,
}: {
  conversation: MockConversation;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const preview =
    conversation.lastSender === "you"
      ? `You: ${conversation.lastMessage}`
      : conversation.lastMessage;

  return (
    <li>
      <button
        aria-pressed={isSelected}
        className={`conversation-row${isSelected ? " is-selected" : ""}`}
        onClick={onSelect}
        type="button"
      >
        <ContactAvatar contact={conversation.contact} />
        <span className="conversation-row__body">
          <span className="conversation-row__topline">
            <strong>{conversation.contact.name}</strong>
            <time dateTime={conversation.updatedAt}>
              {formatMessageTime(conversation.updatedAt)}
            </time>
          </span>
          <span className="conversation-row__preview">{preview}</span>
        </span>
      </button>
    </li>
  );
}

function MessageBubble({ message }: { message: MockMessage }) {
  const isOutgoing = message.sender === "you";

  return (
    <li
      className={`message-row${isOutgoing ? " message-row--outgoing" : " message-row--incoming"}`}
    >
      <article className="message-bubble">
        <p>{message.body}</p>
        <footer>
          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
          {isOutgoing ? <span className="message-bubble__local-status">Local only</span> : null}
        </footer>
      </article>
    </li>
  );
}

function ConversationDetails({ contact }: { contact: MockContact }) {
  return (
    <details className="conversation-details">
      <summary>Details</summary>
      <div className="conversation-details__popover">
        <h3>About this conversation</h3>
        <dl>
          <div className="conversation-details__row">
            <dt>Contact</dt>
            <dd>
              {contact.name} · {contact.relationship}
            </dd>
          </div>
          <div className="conversation-details__row">
            <dt>Identity</dt>
            <dd>Demo contact · not verified</dd>
          </div>
          <div className="conversation-details__row">
            <dt>Privacy</dt>
            <dd>Prototype only · not encrypted</dd>
          </div>
        </dl>
      </div>
    </details>
  );
}

export function ConversationWorkspace({ initialSelectedId }: ConversationWorkspaceProps) {
  const router = useRouter();
  const searchId = useId();
  const composerId = useId();
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const threadHeadingRef = useRef<HTMLHeadingElement>(null);
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(
    initialSelectedId ?? initialConversations[0]?.id ?? null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sendFeedback, setSendFeedback] = useState("");
  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(initialSelectedId));

  const visibleConversations = useMemo(
    () => searchConversations(conversations, searchQuery),
    [conversations, searchQuery],
  );
  const selectedConversation = conversations.find(({ id }) => id === selectedId);

  function selectConversation(conversationId: string) {
    setSelectedId(conversationId);
    setMobileThreadOpen(true);
    setDraft("");
    setSendFeedback("");
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

  function sendPreviewMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversation || !draft.trim()) {
      return;
    }

    const createdAt = new Date().toISOString();
    setConversations((current) =>
      current
        .map((conversation) =>
          conversation.id === selectedConversation.id
            ? appendPreviewMessage(conversation, draft, createdAt)
            : conversation,
        )
        .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)),
    );
    setDraft("");
    setSendFeedback("Added to this preview only. Nothing was delivered or saved.");
  }

  return (
    <section
      aria-label="Mock messaging workspace"
      className={`messaging-workspace${mobileThreadOpen ? " is-thread-open" : ""}`}
    >
      <aside aria-label="Conversation list" className="conversation-list-panel">
        <header className="conversation-list-panel__header">
          <div>
            <p className="messaging-kicker">Sample conversations</p>
            <h2 ref={listHeadingRef} tabIndex={-1}>
              Messages
            </h2>
          </div>
          <span className="conversation-count">{conversations.length}</span>
        </header>

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

        {visibleConversations.length > 0 ? (
          <ul aria-label="Matching conversations" className="conversation-list">
            {visibleConversations.map((conversation) => (
              <ConversationRow
                conversation={conversation}
                isSelected={conversation.id === selectedId}
                key={conversation.id}
                onSelect={() => selectConversation(conversation.id)}
              />
            ))}
          </ul>
        ) : (
          <div aria-live="polite" className="conversation-list__empty" role="status">
            <strong>No conversations found</strong>
            <span>Try another name or word.</span>
          </div>
        )}

        <p className="conversation-list-panel__note">Demo content · no real conversations</p>
      </aside>

      {selectedConversation ? (
        <section
          aria-label={`Conversation with ${selectedConversation.contact.name}`}
          className="conversation-panel"
        >
          <header className="conversation-header">
            <button className="conversation-back" onClick={returnToConversationList} type="button">
              <span aria-hidden="true">←</span> All conversations
            </button>
            <div className="conversation-header__person">
              <ContactAvatar contact={selectedConversation.contact} large />
              <div>
                <p className="messaging-kicker">Demo contact</p>
                <h2 ref={threadHeadingRef} tabIndex={-1}>
                  {selectedConversation.contact.name}
                </h2>
              </div>
            </div>
            <ConversationDetails contact={selectedConversation.contact} />
          </header>

          <p className="conversation-disclaimer">
            <span>Preview only</span>
            Example messages. New text stays here; nothing is sent or encrypted.
          </p>

          {selectedConversation.messages.length > 0 ? (
            <ol
              aria-label={`Messages with ${selectedConversation.contact.name}`}
              className="message-history"
            >
              {selectedConversation.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </ol>
          ) : (
            <div className="message-history__empty">
              <p>This conversation is just getting started.</p>
            </div>
          )}

          <form className="message-composer" onSubmit={sendPreviewMessage}>
            <label className="sr-only" htmlFor={composerId}>
              Write a message
            </label>
            <textarea
              id={composerId}
              maxLength={500}
              onChange={(event) => {
                setDraft(event.target.value);
                setSendFeedback("");
              }}
              placeholder="Write a message…"
              rows={2}
              value={draft}
            />
            <div className="message-composer__footer">
              <span>Local preview · not delivered</span>
              <div>
                <span aria-live="polite" className="message-composer__feedback">
                  {sendFeedback}
                </span>
                <span className="message-composer__count">{draft.length}/500</span>
                <button disabled={!draft.trim()} type="submit">
                  Send <span aria-hidden="true">↑</span>
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : (
        <section className="conversation-panel conversation-panel--empty">
          <p>Select a conversation to view its messages.</p>
        </section>
      )}
    </section>
  );
}
