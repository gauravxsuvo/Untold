export type MessageSender = "contact" | "you";

export type MockMessage = {
  id: string;
  sender: MessageSender;
  body: string;
  createdAt: string;
  previewOnly?: true;
};

export type MockContact = {
  id: string;
  name: string;
  initials: string;
  relationship: string;
  tone: "sage" | "clay" | "blue";
};

export type MockConversation = {
  id: string;
  contact: MockContact;
  messages: MockMessage[];
  lastMessage: string;
  lastSender: MessageSender;
  updatedAt: string;
};

export const initialConversations: MockConversation[] = [
  {
    id: "june-park",
    contact: {
      id: "june-park",
      name: "June Park",
      initials: "JP",
      relationship: "A friend",
      tone: "sage",
    },
    messages: [
      {
        id: "june-1",
        sender: "contact",
        body: "The little bookshop was lovely. I could have stayed all afternoon.",
        createdAt: "2026-10-14T20:12:00+05:30",
      },
      {
        id: "june-2",
        sender: "you",
        body: "It has that kind of quiet about it.",
        createdAt: "2026-10-14T20:15:00+05:30",
        previewOnly: true,
      },
      {
        id: "june-3",
        sender: "contact",
        body: "We should go back next weekend.",
        createdAt: "2026-10-14T20:18:00+05:30",
      },
    ],
    lastMessage: "We should go back next weekend.",
    lastSender: "contact",
    updatedAt: "2026-10-14T20:18:00+05:30",
  },
  {
    id: "rohan-malik",
    contact: {
      id: "rohan-malik",
      name: "Rohan Malik",
      initials: "RM",
      relationship: "A friend",
      tone: "clay",
    },
    messages: [
      {
        id: "rohan-1",
        sender: "you",
        body: "I found the essay you mentioned.",
        createdAt: "2026-10-14T19:22:00+05:30",
        previewOnly: true,
      },
      {
        id: "rohan-2",
        sender: "contact",
        body: "That one has stayed with me for years. Let me know what you think.",
        createdAt: "2026-10-14T19:28:00+05:30",
      },
      {
        id: "rohan-3",
        sender: "you",
        body: "I will bring the book next time.",
        createdAt: "2026-10-14T19:33:00+05:30",
        previewOnly: true,
      },
    ],
    lastMessage: "I will bring the book next time.",
    lastSender: "you",
    updatedAt: "2026-10-14T19:33:00+05:30",
  },
  {
    id: "amara-lin",
    contact: {
      id: "amara-lin",
      name: "Amara Lin",
      initials: "AL",
      relationship: "A friend",
      tone: "blue",
    },
    messages: [
      {
        id: "amara-1",
        sender: "contact",
        body: "I saved you the last piece of cake.",
        createdAt: "2026-10-14T18:04:00+05:30",
      },
      {
        id: "amara-2",
        sender: "you",
        body: "You know exactly how to make a day better.",
        createdAt: "2026-10-14T18:09:00+05:30",
        previewOnly: true,
      },
    ],
    lastMessage: "You know exactly how to make a day better.",
    lastSender: "you",
    updatedAt: "2026-10-14T18:09:00+05:30",
  },
];

export const mockContacts = initialConversations.map((conversation) => conversation.contact);

export function searchConversations(
  conversations: readonly MockConversation[],
  query: string,
): MockConversation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [...conversations];
  }

  return conversations.filter((conversation) => {
    const searchableText = [
      conversation.contact.name,
      conversation.contact.relationship,
      conversation.lastMessage,
      ...conversation.messages.map((message) => message.body),
    ]
      .join(" ")
      .toLocaleLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

export function appendPreviewMessage(
  conversation: MockConversation,
  body: string,
  createdAt = new Date().toISOString(),
): MockConversation {
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    return conversation;
  }

  const message: MockMessage = {
    id: `preview-${Date.parse(createdAt)}-${conversation.messages.length + 1}`,
    sender: "you",
    body: trimmedBody,
    createdAt,
    previewOnly: true,
  };

  return {
    ...conversation,
    messages: [...conversation.messages, message],
    lastMessage: trimmedBody,
    lastSender: "you",
    updatedAt: createdAt,
  };
}
