import { PageHeading } from "@/components/app/page-heading";
import { ContactDirectory } from "@/components/messaging/contact-directory";

export default function ContactsPage() {
  return (
    <div className="app-page">
      <PageHeading
        description="The people you have conversations with. Add someone by their account email."
        eyebrow="People"
        title="Contacts"
      />
      <ContactDirectory />
    </div>
  );
}
