import { PageHeading } from "@/components/app/page-heading";
import { InboxOverview } from "@/components/messaging/inbox-overview";

export default function InboxPage() {
  return (
    <div className="app-page">
      <PageHeading
        description="A gentle overview of the conversations in your workspace."
        eyebrow="Your space"
        title="Inbox"
      />
      <InboxOverview />
    </div>
  );
}
