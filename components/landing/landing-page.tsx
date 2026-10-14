import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { ConceptPreview } from "@/components/landing/concept-preview";

const principles = [
  {
    number: "01",
    title: "Private conversations",
    text: "A focused home for the people and conversations that matter, without a public feed competing for your attention.",
    status: "Available now",
  },
  {
    number: "02",
    title: "Encryption, done carefully",
    text: "End-to-end encryption is a core goal. It has not been implemented yet; its design belongs to a later, security-critical phase.",
    status: "Not implemented",
  },
  {
    number: "03",
    title: "Room to grow thoughtfully",
    text: "Future capabilities will be considered alongside their effects on identity, recovery, metadata, and everyday usability.",
    status: "Still being explored",
  },
];

export function LandingPage() {
  return (
    <main id="top">
      <header className="site-header">
        <div className="page-width site-header__inner">
          <a className="site-header__brand" href="#top" aria-label="Untold home">
            <Wordmark />
          </a>
          <nav className="site-nav" aria-label="Main navigation">
            <a href="#privacy">Our approach</a>
            <a href="#building">What we’re building</a>
            <Link className="site-nav__cta" href="/auth/sign-in">
              Sign in <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <section className="hero page-width" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow">
            <span aria-hidden="true" /> Private messaging, in early access
          </p>
          <h1 id="hero-title">
            Some things are just <em>between us.</em>
          </h1>
          <p className="hero__description">
            Untold is a quieter home for the conversations that matter—thoughtful by
            design, and honest about what is and isn’t ready.
          </p>
          <div className="hero__actions">
            <Link className="button button--primary" href="/auth/sign-up">
              Create an account <span aria-hidden="true">↗</span>
            </Link>
            <a className="text-link" href="#building">
              What we’re making <span aria-hidden="true">↓</span>
            </a>
          </div>
          <p className="hero__note">
            <span aria-hidden="true">✳</span> Early access · Not end-to-end encrypted yet
          </p>
        </div>
        <div className="hero__visual">
          <span className="hero__orbit hero__orbit--one" aria-hidden="true" />
          <span className="hero__orbit hero__orbit--two" aria-hidden="true" />
          <ConceptPreview />
          <p className="hero__visual-note">
            <span aria-hidden="true">↳</span> A conversation, without the noise.
          </p>
        </div>
      </section>

      <section className="privacy" id="privacy" aria-labelledby="privacy-title">
        <div className="page-width privacy__inner">
          <div className="privacy__intro">
            <p className="eyebrow eyebrow--light">A promise we have to earn</p>
            <h2 id="privacy-title">Privacy should feel like part of the conversation.</h2>
            <p className="privacy__lead">
              It starts with clear choices, careful engineering, and plain language about the
              limits. The interface is only the beginning.
            </p>
          </div>
          <div className="privacy__points">
            <article className="privacy-point">
              <span className="privacy-point__mark" aria-hidden="true">
                01
              </span>
              <div>
                <h3>Thoughtful by default</h3>
                <p>
                  A calm, uncluttered experience for the people you choose. There is no public
                  feed.
                </p>
              </div>
            </article>
            <article className="privacy-point">
              <span className="privacy-point__mark" aria-hidden="true">
                02
              </span>
              <div>
                <h3>Clear about today</h3>
                <p>
                  Messaging works today. End-to-end encryption does not exist yet, so messages are
                  stored on Untold’s server and protected in transit by HTTPS.
                </p>
              </div>
            </article>
            <article className="privacy-point">
              <span className="privacy-point__mark" aria-hidden="true">
                03
              </span>
              <div>
                <h3>Careful with every claim</h3>
                <p>
                  Security promises should follow implementation, testing, and independent
                  review—not come before them.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="building page-width" id="building" aria-labelledby="building-title">
        <div className="building__heading">
          <div>
            <p className="eyebrow">
              <span aria-hidden="true" /> The direction
            </p>
            <h2 id="building-title">
              A considered start.
              <br />
              <em>More, only when it’s ready.</em>
            </h2>
          </div>
          <p className="building__summary">
            The product is at the beginning. Here’s what guides it today—and what still needs to be
            worked out.
          </p>
        </div>
        <div className="principles-list">
          {principles.map((principle) => (
            <article className="principle" key={principle.number}>
              <span className="principle__number">{principle.number}</span>
              <div className="principle__body">
                <h3>{principle.title}</h3>
                <p>{principle.text}</p>
              </div>
              <span
                className={`principle__status${principle.number === "02" ? " principle__status--pending" : ""}`}
              >
                <span aria-hidden="true" /> {principle.status}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="closing page-width" aria-labelledby="closing-title">
        <div className="closing__panel">
          <Wordmark compact />
          <p className="eyebrow eyebrow--light">Still at the beginning</p>
          <h2 id="closing-title">
            The best conversations
            <br />
            deserve a little <em>care.</em>
          </h2>
          <p>Follow the idea as it takes shape, one considered step at a time.</p>
          <a className="button button--light" href="#top">
            Back to the beginning <span aria-hidden="true">↑</span>
          </a>
          <span className="closing__detail closing__detail--left" aria-hidden="true" />
          <span className="closing__detail closing__detail--right" aria-hidden="true" />
        </div>
      </section>

      <footer className="site-footer page-width">
        <a className="site-footer__brand" href="#top" aria-label="Untold home">
          <Wordmark />
        </a>
        <p>Some things are just between us.</p>
        <span>Untold is in early access. Messages are not end-to-end encrypted yet.</span>
      </footer>
    </main>
  );
}
