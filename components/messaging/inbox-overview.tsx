"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { StartConversationForm } from "@/components/messaging/start-conversation-form";
import { Avatar } from "@/components/profile/avatar";
import { useConversationList } from "@/components/messaging/use-messaging";
import {
  conversationActivityAt,
  conversationTitle,
  formatMessageTime,
  otherMembers,
  toneFor,
  type ConversationSummary,
} from "@/lib/messaging/people";

function RecentConversation({
  conversation,
  viewerId,
}: {
  conversation: ConversationSummary;
  viewerId: string;
}) {
  const [person] = otherMembers(conversation, viewerId);
  const last = conversation.lastMessage;
  const preview = last
    ? `${last.senderId === viewerId ? "You: " : ""}${last.text ?? "Encrypted message"}`
    : "No messages yet";
  const title = conversationTitle(conversation, viewerId);
  const activityAt = conversationActivityAt(conversation);

  return (
    <li>
      <Link
        className={`inbox-conversation inbox-conversation--${toneFor(person?.id ?? conversation.id)}`}
        href={`/app/conversations?conversation=${encodeURIComponent(conversation.id)}`}
      >
        <Avatar className="inbox-conversation__avatar" id={person?.id ?? conversation.id} image={person?.image} name={title} />
        <span className="inbox-conversation__body">
          <span className="inbox-conversation__topline">
            <strong>{title}</strong>
            <time dateTime={activityAt}>{formatMessageTime(activityAt)}</time>
          </span>
          <span className="inbox-conversation__preview">{preview}</span>
        </span>
        <ArrowUpRight aria-hidden="true" className="inbox-conversation__arrow" size={17} strokeWidth={1.8} />
      </Link>
    </li>
  );
}

export function InboxOverview() {
  const router = useRouter();
  const { session } = useAccountSession();
  const viewerId = session?.id ?? "";
  const { conversations, state, error } = useConversationList();
  const recent = conversations.slice(0, 6);

  return (
    <section aria-labelledby="recent-conversations-title" className="inbox-overview">
      <header className="inbox-overview__header">
        <div>
          <p className="messaging-kicker">
            {session ? `Signed in as ${session.displayName}` : "Your space"}
          </p>
          <h2 id="recent-conversations-title">Recent conversations</h2>
        </div>
        <Link className="inbox-overview__all" href="/app/conversations">
          All conversations <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
        </Link>
      </header>

      {state === "loading" ? (
        <p className="inbox-overview__note" role="status">
          Loading conversations…
        </p>
      ) : state === "error" ? (
        <p className="inbox-overview__note messaging-error" role="alert">
          {error}
        </p>
      ) : recent.length > 0 ? (
        <ul className="inbox-overview__list">
          {recent.map((conversation) => (
            <RecentConversation conversation={conversation} key={conversation.id} viewerId={viewerId} />
          ))}
        </ul>
      ) : (
        <div className="contact-directory__start">
          <StartConversationForm
            onStarted={(conversation) =>
              router.push(`/app/conversations?conversation=${encodeURIComponent(conversation.id)}`)
            }
          />
        </div>
      )}

      <p className="inbox-overview__note">
        Open a conversation to read your messages. Compare safety codes before sharing anything sensitive.
      </p>
    </section>
  );
}
