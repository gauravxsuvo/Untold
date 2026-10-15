"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { AuthHeaderActions } from "@/components/auth/auth-header-actions";
import { SecurityCodeField } from "@/components/auth/security-controls";
import { useAccountSession } from "@/components/auth/account-session-provider";

export function RecoveryOverview() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const { refreshSession } = useAccountSession();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    if (password.length < 15 || password.length > 128) {
      setFeedback(
        "Use a password with 15 to 128 characters. A passphrase of a few words works well.",
      );
      return;
    }
    if (password !== confirmation) {
      setFeedback("Your passwords don’t match. Please enter them again.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/security/password-reset", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword: password }),
      });
      if (!response.ok) {
        setFeedback(
          response.status === 429
            ? "Too many attempts. Please wait a while before trying again."
            : response.status >= 500
              ? "Untold isn’t available right now. Please try again in a moment."
              : "We couldn’t reset your password. Check your email and use an unused recovery code from your MFA setup.",
        );
        return;
      }
      setDone(true);
      setEmail("");
      await refreshSession();
    } catch {
      setFeedback("We couldn’t connect to Untold. Check your connection and try again.");
    } finally {
      setPassword("");
      setConfirmation("");
      setCode("");
      setBusy(false);
    }
  }
  return (
    <main className="auth-page auth-page--recovery">
      <header className="auth-page__header">
        <Link aria-label="Untold home" className="app-brand" href="/">
          <Wordmark />
        </Link>
        <AuthHeaderActions />
      </header>
      <div className="auth-layout">
        <section aria-labelledby="recovery-title" className="auth-card">
          {done ? (
            <>
              <CheckCircle2 aria-hidden="true" className="security-intro-icon" size={28} />
              <p className="auth-kicker">You’re ready</p>
              <h1 id="recovery-title">Password changed.</h1>
              <p className="auth-card__intro" role="status">
                You’ve been signed out on every device. Sign in with your new password and
                authenticator app, or another unused recovery code. MFA is still on.
              </p>
              <p>The recovery code you just used no longer works.</p>
              <Link className="security-button security-back-link" href="/auth/sign-in">
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <p className="auth-kicker">Getting back in</p>
              <h1 id="recovery-title">Reset your password.</h1>
              <p className="auth-card__intro">
                This works only if you previously set up two-factor authentication. You’ll need one
                of the recovery codes you saved during setup.
              </p>
              <form className="auth-form" onSubmit={submit}>
                <div className="auth-field">
                  <label htmlFor="recovery-email">Email address</label>
                  <input
                    autoComplete="email"
                    id="recovery-email"
                    maxLength={254}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    type="email"
                    value={email}
                  />
                </div>
                <SecurityCodeField backup code={code} onChange={setCode} />
                <div className="auth-field">
                  <label htmlFor="recovery-password">New password</label>
                  <input
                    aria-describedby="recovery-password-hint"
                    autoComplete="new-password"
                    id="recovery-password"
                    maxLength={128}
                    minLength={15}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type="password"
                    value={password}
                  />
                  <span className="auth-field__hint" id="recovery-password-hint">
                    At least 15 characters. Use a different password from your other accounts.
                  </span>
                </div>
                <div className="auth-field">
                  <label htmlFor="recovery-confirmation">Confirm new password</label>
                  <input
                    autoComplete="new-password"
                    id="recovery-confirmation"
                    maxLength={128}
                    onChange={(event) => setConfirmation(event.target.value)}
                    required
                    type="password"
                    value={confirmation}
                  />
                </div>
                <p className="auth-field__hint">
                  Resetting uses up this recovery code and signs you out on every device. MFA stays
                  on.
                </p>
                <button className="auth-submit" disabled={busy} type="submit">
                  {busy ? "Resetting…" : "Reset password"}
                </button>
                <p aria-live="polite" className="security-feedback" role="status">
                  {feedback}
                </p>
              </form>
            </>
          )}
        </section>
        <aside aria-label="Account recovery help" className="auth-side-note">
          <KeyRound aria-hidden="true" size={28} />
          <p className="auth-kicker">Keep your access</p>
          <h2>No recovery code?</h2>
          <p>Check your password manager for your password or saved recovery codes.</p>
          <p>
            If you’re still signed in, you can replace your recovery codes in Settings using your
            current password and an authenticator code.
          </p>
          <p>Without MFA and a saved recovery code, a forgotten password can’t be reset.</p>
          <h3>Your browser data matters</h3>
          <p>
            A password reset can’t restore message history from a lost device or cleared browser.
            Keep your browser data while getting back in.
          </p>
        </aside>
      </div>
      <footer className="auth-page__footer">
        <Link href="/auth/sign-in">Back to sign in</Link>
        <Link href="/auth/sign-up">Create an account</Link>
      </footer>
    </main>
  );
}
