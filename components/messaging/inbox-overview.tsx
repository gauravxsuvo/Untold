import Link from "next/link";
import { initialConversations, type MockConversation } from "@/lib/messaging/mock-data";

function formatUpdatedTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function RecentConversation({ conversation }: { conversation: MockConversation }) {
  const preview =
    conversation.lastSender === "you"
      ? `You: ${conversation.lastMessage}`
      : conversation.lastMessage;

  return (
    <li>
      <Link
        className={`inbox-conversation inbox-conversation--${conversation.contact.tone}`}
        href={`/app/conversations?conversation=${encodeURIComponent(conversation.id)}`}
      >
        <span aria-hidden="true" className="inbox-conversation__avatar">
          {conversation.contact.initials}
        </span>
        <span className="inbox-conversation__body">
          <span className="inbox-conversation__topline">
            <strong>{conversation.contact.name}</strong>
            <time dateTime={conversation.updatedAt}>
              {formatUpdatedTime(conversation.updatedAt)}
            </time>
          </span>
          <span className="inbox-conversation__preview">{preview}</span>
        </span>
        <span aria-hidden="true" className="inbox-conversation__arrow">
          ↗
        </span>
      </Link>
    </li>
  );
}

export function InboxOverview() {
  return (
    <section aria-labelledby="recent-conversations-title" className="inbox-overview">
      <header className="inbox-overview__header">
        <div>
          <p className="messaging-kicker">Demo data · examples only</p>
          <h2 id="recent-conversations-title">Recent conversations</h2>
        </div>
        <Link className="inbox-overview__all" href="/app/conversations">
          All conversations <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <ul className="inbox-overview__list">
        {initialConversations.map((conversation) => (
          <RecentConversation conversation={conversation} key={conversation.id} />
        ))}
      </ul>
      <p className="inbox-overview__note">
        These sample conversations are only here to show the interface. Nothing is sent or
        encrypted.
      </p>
    </section>
  );
}
