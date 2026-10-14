import { PageHeading } from "@/components/app/page-heading";
import { MockContactDirectory } from "@/components/messaging/mock-contact-directory";

export default function ContactsPage() {
  return (
    <div className="app-page">
      <PageHeading
        description="A few fictional people make this messaging preview easier to explore."
        eyebrow="People"
        title="Contacts"
      />
      <MockContactDirectory />
    </div>
  );
}
