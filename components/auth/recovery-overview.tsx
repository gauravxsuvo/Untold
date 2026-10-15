import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";

const signInTips = [
  {
    number: "01",
    title: "Check your email address",
    label: "Start here",
    description: "Use the email address you signed up with. Check for typos or try another address you may have used.",
  },
  {
    number: "02",
    title: "Look for a saved password",
    label: "Your password manager",
    description: "Your browser or password manager may have saved your Untold password. Check there before trying again.",
  },
  {
    number: "03",
    title: "Keep a signed-in browser open",
    label: "Already signed in?",
    description: "If Untold is still open on another device, keep it signed in. Don’t clear its browser data while trying to get back in.",
  },
];

export function RecoveryOverview() {
  return (
    <main className="auth-page auth-page--recovery">
      <header className="auth-page__header">
        <Link aria-label="Untold home" className="app-brand" href="/">
          <Wordmark />
        </Link>
        <span className="auth-preview-badge"><i aria-hidden="true" /> Sign-in help</span>
      </header>
      <section aria-labelledby="recovery-title" className="recovery-page__intro">
        <p className="auth-kicker">Getting back in</p>
        <h1 id="recovery-title">Trouble signing in?</h1>
        <p>Password resets aren’t available yet. Here are a few things to try if you can’t sign in.</p>
      </section>
      <section aria-label="Things to try" className="recovery-options">
        {signInTips.map((tip) => (
          <article className="recovery-option" key={tip.number}>
            <span className="recovery-option__number">{tip.number}</span>
            <p className="recovery-option__label">{tip.label}</p>
            <h2>{tip.title}</h2>
            <p>{tip.description}</p>
          </article>
        ))}
      </section>
      <aside aria-labelledby="key-recovery-title" className="recovery-key-note">
        <p className="auth-kicker">Keep your history</p>
        <h2 id="key-recovery-title">Your browser data matters.</h2>
        <p>
          Clearing Untold’s browser data or losing a device can make older messages unreadable,
          even if you sign in again. Those messages can’t currently be restored on a new device.
          Keep your password in a password manager and protect the devices you use.
        </p>
      </aside>
      <footer className="auth-page__footer">
        <Link href="/auth/sign-in">Back to sign in</Link>
        <Link href="/auth/sign-up">Create an account <ArrowUpRight aria-hidden="true" size={16} /></Link>
      </footer>
    </main>
  );
}
