"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { usePreviewAuth } from "@/components/auth/preview-auth-provider";
import { authClient } from "@/lib/auth/client";
import { validateAuthForm, type AuthFieldErrors, type AuthFormMode } from "@/lib/auth/validation";

const emptyValues = { name: "", email: "", password: "", confirmation: "" };

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
  const { beginDemoSession, session, isSessionPending, isAccountServiceUnavailable } = usePreviewAuth();
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
          result.error.status === 503
            ? "The account service is not configured yet. Your password has been cleared; please try again later."
            : result.error.message || "We could not complete that request. Check your details and try again.",
        );
        return;
      }

      setName("");
      setEmail("");
      router.push(isSignUp ? "/app/onboarding" : "/app/inbox");
    } catch {
      setFeedback("We could not reach the account service. Your password has been cleared; please try again.");
    } finally {
      setPassword("");
      setConfirmation("");
      setIsSubmitting(false);
    }
  }

  function handleDemoSession() {
    setName(emptyValues.name);
    setEmail(emptyValues.email);
    setPassword(emptyValues.password);
    setConfirmation(emptyValues.confirmation);
    beginDemoSession();
    router.push("/app/onboarding");
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
        <span className="auth-preview-badge">
              <i aria-hidden="true" /> Account access
        </span>
      </header>

      <div className="auth-layout">
        <section aria-labelledby="auth-title" className="auth-card">
          <p className="auth-kicker">A considered beginning</p>
          <h1 id="auth-title">{isSignUp ? "Make room for what matters." : "Welcome back."}</h1>
          <p className="auth-card__intro">
            {isSignUp
              ? "Create an account to explore Untold. Email verification and account recovery are not configured yet."
              : "Sign in to your Untold account, or explore the workspace with a temporary demo profile."}
          </p>

          {signedOut ? (
            <p className="auth-notice" role="status">
              You have been signed out.
            </p>
          ) : null}
          {isAccountServiceUnavailable ? (
            <p className="auth-notice" role="status">
              Account access is not configured in this environment yet. The sample profile is still
              available to explore.
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
                    ? "Use a sample password only. 15+ characters; passphrases are fine."
                    : "Use a sample value only. This preview does not check credentials."}
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
                <span>Account recovery is not configured yet.</span>
                <Link href="/auth/recovery">Need help signing in?</Link>
              </div>
            )}

            <button
              className="auth-submit"
              disabled={isSubmitting || isSessionPending || isAccountServiceUnavailable}
              type="submit"
            >
              {isSubmitting
                ? "Connecting…"
                : isSessionPending
                  ? "Checking service…"
                  : isAccountServiceUnavailable
                    ? "Service unavailable"
                    : isSignUp
                      ? "Create account"
                      : "Sign in"}
              <span aria-hidden="true">↗</span>
            </button>
            <p aria-live="polite" className="auth-feedback" role={feedback ? "status" : undefined}>
              {feedback}
            </p>
          </form>

          <div className="auth-divider">
            <span>or</span>
          </div>
          {session?.source !== "account" ? (
            <>
              <button className="auth-demo-button" onClick={handleDemoSession} type="button">
                Explore the workspace with a sample profile <span aria-hidden="true">→</span>
              </button>
              <p className="auth-demo-note">
                The sample profile is fictional and stays in memory. Account credentials are sent
                only when you submit the account form and are cleared after the request.
              </p>
            </>
          ) : null}

          <p className="auth-switch">
            {isSignUp ? "Already have an account?" : "New to Untold?"}{" "}
            <Link href={isSignUp ? "/auth/sign-in" : "/auth/sign-up"}>
              {isSignUp ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </section>

        <aside aria-label="How this preview handles your information" className="auth-side-note">
          <span aria-hidden="true" className="auth-side-note__mark">
            ✳
          </span>
          <p className="auth-kicker">Honest by design</p>
          <h2>
            {isAccountServiceUnavailable
              ? "Account access is being configured."
              : "Account access is connected; messaging is still a preview."}
          </h2>
          <ul>
            <li>Submitted account credentials go to the configured Untold account service.</li>
            <li>Email verification and password recovery are not configured.</li>
            <li>The message workspace still uses mock conversations; encryption is not implemented.</li>
          </ul>
          <Link href="/auth/recovery">
            How recovery could work <span aria-hidden="true">↗</span>
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
