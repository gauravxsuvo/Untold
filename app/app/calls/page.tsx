import { PageHeading } from "@/components/app/page-heading";
import { CallHistoryList } from "@/components/messaging/call-history-list";
export default function CallsPage() {
  return (
    <div className="app-page">
      <PageHeading
        eyebrow="Stay in touch"
        title="Calls"
        description="Your voice and video calls, with people and groups."
      />
      <CallHistoryList />
    </div>
  );
}
