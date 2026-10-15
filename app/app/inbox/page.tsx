import { PageHeading } from "@/components/app/page-heading";
import { InboxOverview } from "@/components/messaging/inbox-overview";

export default function InboxPage() {
  return (
    <div className="app-page">
      <PageHeading
        description="The conversations you’ve shared, all in one place."
        eyebrow="Your space"
        title="Inbox"
      />
      <InboxOverview />
    </div>
  );
}
