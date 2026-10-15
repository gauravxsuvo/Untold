"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { AuthHeaderActions } from "@/components/auth/auth-header-actions";
import { SecurityCodeField, securityError } from "@/components/auth/security-controls";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { authClient } from "@/lib/auth/client";

export function TwoFactorScreen() {
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const { refreshSession } = useAccountSession();
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    try {
      const result = backup
        ? await authClient.twoFactor.verifyBackupCode({
            code: code.trim().toLowerCase(),
            trustDevice: false,
          })
        : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
      if (result.error) {
        setFeedback(securityError(result.error.status, result.error.code));
        return;
      }
      await refreshSession();
      router.replace("/app/inbox");
      router.refresh();
    } catch {
      setFeedback("We couldn’t connect to Untold. Please try again.");
    } finally {
      setCode("");
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <header className="auth-page__header">
        <Link aria-label="Untold home" className="app-brand" href="/">
          <Wordmark />
        </Link>
        <AuthHeaderActions />
      </header>
      <div className="security-auth-layout">
        <section aria-labelledby="two-factor-title" className="auth-card">
          <ShieldCheck aria-hidden="true" className="security-intro-icon" size={28} />
          <p className="auth-kicker">One more step</p>
          <h1 id="two-factor-title">Confirm it’s you.</h1>
          <p className="auth-card__intro">
            {backup
              ? "Use a saved recovery code to finish signing in. Each code can only be used once."
              : "Open your authenticator app and enter the current code for Untold."}
          </p>
          <form className="auth-form" onSubmit={submit}>
            <SecurityCodeField backup={backup} code={code} onChange={setCode} />
            <button className="auth-submit" disabled={busy} type="submit">
              {busy ? "Checking…" : "Verify and sign in"}
            </button>
            <p aria-live="polite" className="security-feedback" role="status">
              {feedback}
            </p>
          </form>
          <button
            className="security-text-button"
            disabled={busy}
            onClick={() => {
              setBackup(!backup);
              setCode("");
              setFeedback("");
            }}
            type="button"
          >
            {backup ? "Use an authenticator code" : "Use a recovery code instead"}
          </button>
          <p className="auth-field__hint">
            For your security, this step expires after 5 minutes. If it expires, start signing in
            again.
          </p>
          <Link className="security-back-link" href="/auth/sign-in">
            Back to sign in
          </Link>
        </section>
      </div>
    </main>
  );
}
