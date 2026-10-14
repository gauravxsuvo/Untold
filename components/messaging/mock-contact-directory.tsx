import Link from "next/link";
import { mockContacts } from "@/lib/messaging/mock-data";

export function MockContactDirectory() {
  return (
    <section aria-label="Demo contacts" className="mock-contact-directory">
      <p className="messaging-kicker">Sample people · no device contacts used</p>
      <ul>
        {mockContacts.map((contact) => (
          <li key={contact.id}>
            <span aria-hidden="true" className={`contact-avatar contact-avatar--${contact.tone}`}>
              {contact.initials}
            </span>
            <span className="mock-contact-directory__identity">
              <strong>{contact.name}</strong>
              <span>{contact.relationship}</span>
            </span>
            <Link href={`/app/conversations?conversation=${encodeURIComponent(contact.id)}`}>
              Open conversation <span aria-hidden="true">↗</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
