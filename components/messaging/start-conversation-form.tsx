"use client";

import { useId, useState, type FormEvent } from "react";
import { startConversation, userFacingError } from "@/lib/messaging/api-client";
import type { ConversationSummary } from "@/lib/messaging/people";

export function StartConversationForm({
  onStarted,
}: {
  onStarted: (conversation: ConversationSummary) => void;
}) {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const conversation = await startConversation(email);
      setEmail("");
      onStarted(conversation);
    } catch (caught) {
      setFeedback({
        kind: "error",
        text: userFacingError(caught, "That conversation could not be started."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="start-conversation" onSubmit={handleSubmit}>
      <label className="messaging-kicker" htmlFor={inputId}>
        Start a conversation
      </label>
      <div className="start-conversation__row">
        <span className="conversation-search">
          <input
            autoComplete="email"
            id={inputId}
            maxLength={254}
            onChange={(event) => {
              setEmail(event.target.value);
              setFeedback(null);
            }}
            placeholder="Their account email"
            type="email"
            value={email}
          />
        </span>
        <button disabled={isSubmitting || !email.trim()} type="submit">
          {isSubmitting ? "Starting…" : "Start"}
        </button>
      </div>
      <p
        aria-live="polite"
        className={`start-conversation__feedback${feedback?.kind === "error" ? " start-conversation__feedback--error" : ""}`}
      >
        {feedback?.text ?? ""}
      </p>
    </form>
  );
}
