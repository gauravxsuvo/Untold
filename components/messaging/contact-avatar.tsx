import { toneFor, type Person } from "@/lib/messaging/people";
import { Avatar } from "@/components/profile/avatar";

export function ContactAvatar({ person, large = false, group = false }: { person: Person; large?: boolean; group?: boolean }) {
  return (
    <Avatar
      id={person.id}
      name={person.name}
      image={person.image}
      group={group}
      className={`contact-avatar contact-avatar--${toneFor(person.id)}${large ? " contact-avatar--large" : ""}`}
    />
  );
}
