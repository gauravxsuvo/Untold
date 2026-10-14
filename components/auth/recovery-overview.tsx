import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";

const recoveryOptions = [
  {
    number: "01",
    title: "A verified email reset",
    label: "Simpler to use",
    description:
      "A time-limited link can restore account access. Anyone controlling the email account may be able to request it, so recovery addresses need protection and reset requests must avoid revealing which accounts exist.",
  },
  {
    number: "02",
    title: "A saved recovery code",
    label: "User-held secret",
    description:
      "A one-time code kept somewhere safe can work without relying on the inbox. If it is lost, account access may be harder to restore; if stolen, it can help someone else recover the account.",
  },
  {
    number: "03",
    title: "An existing trusted device",
    label: "Device-based",
    description:
      "A device already linked to the account can approve a new sign-in. This depends on keeping that device available and needs a separate plan for people who lose every enrolled device.",
  },
];

export function RecoveryOverview() {
  return (
    <main className="auth-page auth-page--recovery">
      <header className="auth-page__header">
        <Link aria-label="Untold home" className="app-brand" href="/">
          <Wordmark />
        </Link>
        <span className="auth-preview-badge">
          <i aria-hidden="true" /> Design concept
        </span>
      </header>

      <section aria-labelledby="recovery-title" className="recovery-page__intro">
        <p className="auth-kicker">Account recovery · concept only</p>
        <h1 id="recovery-title">Getting back in should not weaken privacy.</h1>
        <p>
          Recovery is not wired up. Each approach changes who can help restore an account and what a
          lost device means. Untold has not chosen a recovery method.
        </p>
      </section>

      <section aria-label="Account recovery approaches" className="recovery-options">
        {recoveryOptions.map((option) => (
          <article className="recovery-option" key={option.number}>
            <span className="recovery-option__number">{option.number}</span>
            <p className="recovery-option__label">{option.label}</p>
            <h2>{option.title}</h2>
            <p>{option.description}</p>
          </article>
        ))}
      </section>

      <aside aria-labelledby="key-recovery-title" className="recovery-key-note">
        <p className="auth-kicker">A separate decision</p>
        <h2 id="key-recovery-title">Account access and message keys are different.</h2>
        <p>
          A password reset can restore the ability to sign in. It cannot recreate end-to-end
          encryption keys that only existed on a lost device. Untold must decide whether old
          messages become unreadable, whether users hold a recovery secret, or whether another key
          backup model is acceptable before building that flow.
        </p>
      </aside>

      <p className="recovery-page__note">
        No email, code, device, or identity check is contacted here. Recovery design will be
        reviewed before implementation.
      </p>

      <footer className="auth-page__footer">
        <Link href="/auth/sign-in">Return to sign in</Link>
        <Link href="/auth/sign-up">
          Create an account <span aria-hidden="true">↗</span>
        </Link>
      </footer>
    </main>
  );
}
