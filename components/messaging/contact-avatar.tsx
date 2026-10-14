import { initialsFor, toneFor, type Person } from "@/lib/messaging/people";

export function ContactAvatar({ person, large = false }: { person: Person; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`contact-avatar contact-avatar--${toneFor(person.id)}${large ? " contact-avatar--large" : ""}`}
    >
      {initialsFor(person.name)}
    </span>
  );
}
