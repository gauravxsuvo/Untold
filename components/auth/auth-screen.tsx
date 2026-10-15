"use client";

import Link from "next/link";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { AuthHeaderActions } from "@/components/auth/auth-header-actions";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { authClient } from "@/lib/auth/client";
import { validateAuthForm, type AuthFieldErrors, type AuthFormMode } from "@/lib/auth/validation";

export function AuthScreen({
  mode,
  signedOut = false,
}: {
  mode: AuthFormMode;
  signedOut?: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [feedback, setFeedback] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isSessionPending, isAccountServiceUnavailable } = useAccountSession();
  const router = useRouter();
  const isSignUp = mode === "sign-up";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    const nextErrors = validateAuthForm(mode, { name, email, password, confirmation });
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });

      if (result.error) {
        setFeedback(
          result.error.status === 429
            ? "Too many attempts. Please wait a moment before trying again."
            : (result.error.status ?? 0) >= 500
              ? "Untold isn’t available right now. Please try again in a moment."
              : isSignUp
                ? "We couldn’t create your account. Check your details, or try signing in if you already have an account."
                : "We couldn’t sign you in. Check your email address and password, then try again.",
        );
        return;
      }

      if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
        router.push("/auth/two-factor");
        return;
      }

      setName("");
      setEmail("");
      router.push(isSignUp ? "/access" : "/app/inbox");
      router.refresh();
    } catch {
      setFeedback("We couldn’t connect to Untold. Check your connection and try again.");
    } finally {
      setPassword("");
      setConfirmation("");
      setIsSubmitting(false);
    }
  }

  function clearFieldError(field: keyof AuthFieldErrors) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFeedback("");
  }

  return (
    <main className="auth-page">
      <header className="auth-page__header">
        <Link aria-label="Untold home" className="app-brand" href="/">
          <Wordmark />
        </Link>
        <AuthHeaderActions />
      </header>

      <div className="auth-layout">
        <section aria-labelledby="auth-title" className="auth-card">
          <p className="auth-kicker">{isSignUp ? "Join Untold" : "Your conversations await"}</p>
          <h1 id="auth-title">{isSignUp ? "Make room for what matters." : "Welcome back."}</h1>
          <p className="auth-card__intro">
            {isSignUp
              ? "Untold is a private space. Create an account to request access. The owner will review your request before you can start chatting."
              : "Sign in to your Untold account to pick up your conversations."}
          </p>

          {signedOut ? (
            <p className="auth-notice" role="status">
              You have been signed out.
            </p>
          ) : null}
          {isAccountServiceUnavailable ? (
            <p className="auth-notice" role="status">
              We can’t load your account right now. Please try again in a moment.
            </p>
          ) : null}

          <form className="auth-form" noValidate onSubmit={handleSubmit}>
            {isSignUp ? (
              <div className="auth-field">
                <label htmlFor="auth-name">Display name</label>
                <input
                  autoComplete="name"
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "auth-name-error" : undefined}
                  id="auth-name"
                  name="name"
                  onChange={(event) => {
                    setName(event.target.value);
                    clearFieldError("name");
                  }}
                  placeholder="How should people know you?"
                  value={name}
                />
                {errors.name ? (
                  <span className="auth-field__error" id="auth-name-error">
                    {errors.name}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="auth-field">
              <label htmlFor="auth-email">Email address</label>
              <input
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "auth-email-error" : undefined}
                id="auth-email"
                name="email"
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearFieldError("email");
                }}
                placeholder="you@example.com"
                type="email"
                value={email}
              />
              {errors.email ? (
                <span className="auth-field__error" id="auth-email-error">
                  {errors.email}
                </span>
              ) : null}
            </div>

            <div className="auth-field">
              <label htmlFor="auth-password">Password</label>
              <div className="auth-password-input">
                <input
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? "auth-password-error" : "auth-password-hint"}
                  id="auth-password"
                  maxLength={128}
                  minLength={isSignUp ? 15 : undefined}
                  name="password"
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearFieldError("password");
                  }}
                  type={isPasswordVisible ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                  aria-pressed={isPasswordVisible}
                  onClick={() => setIsPasswordVisible((visible) => !visible)}
                  type="button"
                >
                  {isPasswordVisible ? "Hide" : "Show"}
                </button>
              </div>
              {errors.password ? (
                <span className="auth-field__error" id="auth-password-error">
                  {errors.password}
                </span>
              ) : (
                <span className="auth-field__hint" id="auth-password-hint">
                  {isSignUp
                    ? "At least 15 characters. A passphrase of a few words works well."
                    : "Enter the password you chose when you signed up."}
                </span>
              )}
            </div>

            {isSignUp ? (
              <div className="auth-field">
                <label htmlFor="auth-confirmation">Confirm password</label>
                <input
                  autoComplete="new-password"
                  aria-invalid={Boolean(errors.confirmation)}
                  aria-describedby={errors.confirmation ? "auth-confirmation-error" : undefined}
                  id="auth-confirmation"
                  maxLength={128}
                  name="confirmation"
                  onChange={(event) => {
                    setConfirmation(event.target.value);
                    clearFieldError("confirmation");
                  }}
                  type="password"
                  value={confirmation}
                />
                {errors.confirmation ? (
                  <span className="auth-field__error" id="auth-confirmation-error">
                    {errors.confirmation}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="auth-form__utility">
                <span>Forgot your password?</span>
                <Link href="/auth/recovery">Reset password</Link>
              </div>
            )}

            <button
              className="auth-submit"
              disabled={isSubmitting || isSessionPending || isAccountServiceUnavailable}
              type="submit"
            >
              {isSubmitting
                ? isSignUp ? "Creating account…" : "Signing in…"
                : isSessionPending
                  ? "Loading…"
                  : isAccountServiceUnavailable
                    ? "Try again later"
                    : isSignUp
                      ? "Create account"
                      : "Sign in"}
              <ArrowUpRight aria-hidden="true" size={16} />
            </button>
            <p aria-live="polite" className="auth-feedback" role={feedback ? "status" : undefined}>
              {feedback}
            </p>
          </form>

          <p className="auth-switch">
            {isSignUp ? "Already have an account?" : "New to Untold?"}{" "}
            <Link href={isSignUp ? "/auth/sign-in" : "/auth/sign-up"}>
              {isSignUp ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </section>

        <aside aria-label="How Untold handles your information" className="auth-side-note">
          <span aria-hidden="true" className="auth-side-note__mark">
            <MessageCircle size={32} />
          </span>
          <p className="auth-kicker">Before you begin</p>
          <h2>A few things to know.</h2>
          <ul>
            <li>Compare safety codes with your friend by phone or in person before sharing.</li>
            <li>Untold is in early access. Privacy features haven’t been independently checked yet.</li>
            <li>Set up two-factor authentication and save your recovery codes so you can reset a forgotten password.</li>
          </ul>
          <Link href="/auth/recovery">
            Help with signing in <ArrowUpRight aria-hidden="true" size={16} />
          </Link>
        </aside>
      </div>

      <footer className="auth-page__footer">
        <span>Some things are just between us.</span>
        <Link href="/">Back to Untold</Link>
      </footer>
    </main>
  );
}
