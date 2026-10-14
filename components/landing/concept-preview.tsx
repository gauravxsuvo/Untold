const conversations = [
  { initials: "J", name: "June", detail: "Made it home. Thank you for today.", active: true },
  { initials: "M", name: "Mara", detail: "I saved you the last chapter.", active: false },
  { initials: "R", name: "Rowan", detail: "Sunday, same little place?", active: false },
];

export function ConceptPreview() {
  return (
    <figure className="concept" id="concept" aria-labelledby="concept-label">
      <div className="concept__caption">
        <span className="concept__caption-dot" aria-hidden="true" />
        <span id="concept-label">A first look at the conversation space</span>
        <span className="concept__caption-note">Concept preview</span>
      </div>

      <div className="mock-app">
        <aside className="mock-sidebar" aria-label="Illustrative conversation list">
          <div className="mock-sidebar__top">
            <span className="mock-sidebar__label">CONVERSATIONS</span>
            <span className="mock-add" aria-hidden="true">+</span>
          </div>
          <div className="mock-search" aria-hidden="true">
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <title>Search</title>
              <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.4" />
              <path d="m12 12 3 3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
            </svg>
            <span>Find a conversation</span>
          </div>
          <ul className="mock-threads">
            {conversations.map((conversation) => (
              <li
                className={`mock-thread${conversation.active ? " mock-thread--active" : ""}`}
                key={conversation.name}
              >
                <span className={`mock-avatar mock-avatar--${conversation.initials.toLowerCase()}`} aria-hidden="true">
                  {conversation.initials}
                </span>
                <span className="mock-thread__copy">
                  <span className="mock-thread__name">{conversation.name}</span>
                  <span className="mock-thread__detail">{conversation.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mock-sidebar__foot">
            <span className="mock-avatar mock-avatar--you" aria-hidden="true">Y</span>
            <span>Example profile</span>
            <span className="mock-more" aria-hidden="true">···</span>
          </div>
        </aside>

        <section className="mock-chat" aria-label="Illustrative conversation with June">
          <header className="mock-chat__header">
            <span className="mock-avatar mock-avatar--june" aria-hidden="true">J</span>
            <span className="mock-chat__person">
              <strong>June</strong>
              <span>Example conversation</span>
            </span>
            <span className="mock-more-button" aria-hidden="true">···</span>
          </header>

          <div className="mock-chat__history">
            <p className="mock-date">TODAY · 4:16 PM</p>
            <div className="mock-message mock-message--outgoing">
              <p>Thanks for making an ordinary Tuesday feel like a little escape.</p>
              <span>4:16 PM <span className="mock-check" aria-hidden="true">✓</span></span>
            </div>
            <div className="mock-message mock-message--incoming">
              <p>I know exactly what you mean. Let’s not wait so long next time.</p>
              <span>4:17 PM</span>
            </div>
            <div className="mock-message mock-message--outgoing mock-message--short">
              <p>Already looking forward to it.</p>
              <span>4:18 PM <span className="mock-check" aria-hidden="true">✓</span></span>
            </div>
          </div>

          <div className="mock-composer" aria-hidden="true">
            <span className="mock-composer__plus">+</span>
            <span>Write a message</span>
            <span className="mock-composer__send">↑</span>
          </div>
        </section>
      </div>

      <figcaption className="concept__disclaimer">
        An illustrative interface only. Messaging is not available; nothing here is sent or stored.
      </figcaption>
    </figure>
  );
}
