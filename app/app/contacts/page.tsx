import { PageHeading } from "@/components/app/page-heading";
import { ContactDirectory } from "@/components/messaging/contact-directory";

export default function ContactsPage() {
  return (
    <div className="app-page">
      <PageHeading
        description="People you’ve connected with on Untold."
        eyebrow="People"
        title="Contacts"
      />
      <ContactDirectory />
    </div>
  );
}
