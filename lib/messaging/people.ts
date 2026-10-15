export type Person = { id: string; name: string; email: string; image?: string | null };

export type ConversationSummary = {
  id: string;
  createdAt: string;
  members: Person[];
  lastMessage: { text: string | null; senderId: string; createdAt: string; hasAttachment?: boolean } | null;
};

export type ConversationMessage = {
  id: string;
  senderId: string;
  clientMessageId: string;
  envelope?: string;
  attachmentId?: string | null;
  text?: string | null;
  createdAt: string;
  receivedAt?: string | null;
  readAt?: string | null;
};

const avatarTones = ["sage", "clay", "blue"] as const;
export type AvatarTone = (typeof avatarTones)[number];

export function initialsFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "U";
}

export function toneFor(id: string): AvatarTone {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return avatarTones[hash % avatarTones.length];
}

export function otherMembers(conversation: ConversationSummary, viewerId: string): Person[] {
  const others = conversation.members.filter((member) => member.id !== viewerId);
  return others.length > 0 ? others : conversation.members;
}

export function conversationTitle(conversation: ConversationSummary, viewerId: string): string {
  return otherMembers(conversation, viewerId)
    .map((member) => member.name)
    .join(", ");
}

export function conversationActivityAt(conversation: ConversationSummary): string {
  return conversation.lastMessage?.createdAt ?? conversation.createdAt;
}

export function sortByActivity(conversations: ConversationSummary[]): ConversationSummary[] {
  return [...conversations].sort(
    (first, second) =>
      Date.parse(conversationActivityAt(second)) - Date.parse(conversationActivityAt(first)),
  );
}

export function searchConversations(
  conversations: ConversationSummary[],
  query: string,
  viewerId: string,
): ConversationSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return conversations;

  return conversations.filter((conversation) => {
    const haystack = [
      ...otherMembers(conversation, viewerId).flatMap((member) => [member.name, member.email]),
      conversation.lastMessage?.text ?? "",
    ]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function mergeMessages<Message extends ConversationMessage>(
  current: Message[],
  incoming: Message[],
): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (first, second) =>
      Date.parse(first.createdAt) - Date.parse(second.createdAt) || first.id.localeCompare(second.id),
  );
}

export function formatMessageTime(value: string, now = new Date()): string {
  const date = new Date(value);
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(
    undefined,
    sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" },
  ).format(date);
}
