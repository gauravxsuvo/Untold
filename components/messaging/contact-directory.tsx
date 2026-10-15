"use client";

import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { ContactAvatar } from "@/components/messaging/contact-avatar";
import { StartConversationForm } from "@/components/messaging/start-conversation-form";
import { useConversationList } from "@/components/messaging/use-messaging";
import { otherMembers } from "@/lib/messaging/people";

export function ContactDirectory() {
  const router = useRouter();
  const { session } = useAccountSession();
  const viewerId = session?.id ?? "";
  const { conversations, state, error } = useConversationList();

  const contacts = conversations.flatMap((conversation) =>
    otherMembers(conversation, viewerId)
      .filter((member) => member.id !== viewerId)
      .map((member) => ({ member, conversationId: conversation.id })),
  );

  return (
    <section aria-label="Contacts" className="contact-directory">
      <div className="contact-directory__start">
        <StartConversationForm
          onStarted={(conversation) =>
            router.push(`/app/conversations?conversation=${encodeURIComponent(conversation.id)}`)
          }
        />
      </div>

      {state === "loading" ? (
        <LoadingSkeleton label="Loading contacts…" />
      ) : state === "error" ? (
        <p className="contact-directory__empty messaging-error" role="alert">
          {error}
        </p>
      ) : contacts.length > 0 ? (
        <ul>
          {contacts.map(({ member, conversationId }) => (
            <li key={member.id}>
              <ContactAvatar person={member} />
              <span className="contact-directory__identity">
                <strong>{member.name}</strong>
                <span>{member.email}</span>
              </span>
              <Link href={`/app/conversations?conversation=${encodeURIComponent(conversationId)}`}>
                Open conversation <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="contact-directory__empty">
          People you talk with appear here. Untold never reads your device contacts.
        </p>
      )}
    </section>
  );
}
