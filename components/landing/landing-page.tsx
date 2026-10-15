import Link from "next/link";
import { ArrowDown, ArrowUpRight, CornerDownRight, MessageCircle } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { ConceptPreview } from "@/components/landing/concept-preview";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";
import { InstallAppButton } from "@/components/pwa/install-app-button";

const principles = [
  {
    number: "01",
    title: "Private conversations",
    text: "Talk with the people you choose. No public feed to scroll through, just your conversations.",
    status: "Available now",
  },
  {
    number: "02",
    title: "Know who you’re talking to",
    text: "Compare safety codes with your friend by phone or in person before you start sharing.",
    status: "Check together",
  },
  {
    number: "03",
    title: "Share more than words",
    text: "Send photos, videos, and files in your conversations. When possible, Untold makes them smaller to save space.",
    status: "Available now",
  },
];

export function LandingPage() {
  return (
    <main id="top">
      <header className="site-header">
        <div className="page-width site-header__inner">
          <div className="site-header__brand-actions">
            <a className="site-header__brand" href="#top" aria-label="Untold home">
              <Wordmark />
            </a>
            <InstallAppButton />
          </div>
          <nav className="site-nav" aria-label="Main navigation">
            <ThemeSwitcher compact />
            <a href="#privacy">Our approach</a>
            <a href="#building">What we’re building</a>
            <Link className="site-nav__cta" href="/auth/sign-in">
              Sign in <ArrowUpRight aria-hidden="true" size={16} />
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
            A quiet place to catch up, share a moment, and stay close to the people who matter.
          </p>
          <div className="hero__actions">
            <Link className="button button--primary" href="/auth/sign-up">
              Request access <ArrowUpRight aria-hidden="true" size={16} />
            </Link>
            <a className="text-link" href="#building">
              Take a look <ArrowDown aria-hidden="true" size={16} />
            </a>
          </div>
          <p className="hero__note">
            <MessageCircle aria-hidden="true" size={15} /> Early access. A little space for your conversations.
          </p>
        </div>
        <div className="hero__visual">
          <span className="hero__orbit hero__orbit--one" aria-hidden="true" />
          <span className="hero__orbit hero__orbit--two" aria-hidden="true" />
          <ConceptPreview />
          <p className="hero__visual-note">
            <CornerDownRight aria-hidden="true" size={16} /> A conversation, without the noise.
          </p>
        </div>
      </section>

      <section className="privacy" id="privacy" aria-labelledby="privacy-title">
        <div className="page-width privacy__inner">
          <div className="privacy__intro">
            <p className="eyebrow eyebrow--light">Your conversations</p>
            <h2 id="privacy-title">A little more room for the people you choose.</h2>
            <p className="privacy__lead">
              Untold keeps things simple, with clear information to help you decide what to share.
            </p>
          </div>
          <div className="privacy__points">
            <article className="privacy-point">
              <span className="privacy-point__mark" aria-hidden="true">
                01
              </span>
              <div>
                <h3>Just your conversations</h3>
                <p>
                  Add a friend by email and start talking. Your messages don’t appear in a public feed.
                </p>
              </div>
            </article>
            <article className="privacy-point">
              <span className="privacy-point__mark" aria-hidden="true">
                02
              </span>
              <div>
                <h3>Check before you share</h3>
                <p>
                  Compare a contact’s safety code by phone or in person. This helps you check that
                  you’re talking to the right person. Untold still knows who has an account and who talks to whom.
                </p>
              </div>
            </article>
            <article className="privacy-point">
              <span className="privacy-point__mark" aria-hidden="true">
                03
              </span>
              <div>
                <h3>Still in early access</h3>
                <p>
                  Privacy features are still being tested and haven’t been independently checked.
                  Keep that in mind before sharing anything sensitive.
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
              <span aria-hidden="true" /> Make yourself at home
            </p>
            <h2 id="building-title">
              Less to get in the way.
              <br />
              <em>More room to talk.</em>
            </h2>
          </div>
          <p className="building__summary">
            Start with a friend. Send a thought, a photo, or something that made your day.
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
          <p className="eyebrow eyebrow--light">Stay close</p>
          <h2 id="closing-title">
            The best conversations
            <br />
            deserve a little <em>care.</em>
          </h2>
          <p>Make a little room for someone you’ve been meaning to catch up with.</p>
          <Link className="button button--light" href="/auth/sign-up">
            Request access <ArrowUpRight aria-hidden="true" size={16} />
          </Link>
          <span className="closing__detail closing__detail--left" aria-hidden="true" />
          <span className="closing__detail closing__detail--right" aria-hidden="true" />
        </div>
      </section>

      <footer className="site-footer page-width">
        <a className="site-footer__brand" href="#top" aria-label="Untold home">
          <Wordmark />
        </a>
        <p>Some things are just between us.</p>
        <span>Early access. Privacy features haven’t been independently checked yet.</span>
      </footer>
    </main>
  );
}
