import { PageHeading } from "@/components/app/page-heading";
import { ConversationWorkspace } from "@/components/messaging/conversation-workspace";
import { initialConversations } from "@/lib/messaging/mock-data";

type ConversationsPageProps = {
  searchParams: Promise<{ conversation?: string | string[] }>;
};

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const params = await searchParams;
  const requestedId = typeof params.conversation === "string" ? params.conversation : null;
  const initialSelectedId = initialConversations.some(({ id }) => id === requestedId)
    ? requestedId
    : null;

  return (
    <div className="app-page app-page--messaging">
      <PageHeading
        description="Choose a conversation, find a detail, or add a note to this local preview."
        eyebrow="Your conversations"
        title="Conversations"
      />
      <ConversationWorkspace initialSelectedId={initialSelectedId} />
    </div>
  );
}
