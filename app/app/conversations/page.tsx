import { PageHeading } from "@/components/app/page-heading";
import { ConversationWorkspace } from "@/components/messaging/conversation-workspace";

type ConversationsPageProps = {
  searchParams: Promise<{ conversation?: string | string[] }>;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const params = await searchParams;
  const requestedId = typeof params.conversation === "string" ? params.conversation : null;

  return (
    <div className="app-page app-page--messaging">
      <PageHeading
        description="Find someone or pick up where you left off."
        eyebrow="Your conversations"
        title="Conversations"
      />
      <ConversationWorkspace
        initialSelectedId={requestedId && uuidPattern.test(requestedId) ? requestedId : null}
      />
    </div>
  );
}
