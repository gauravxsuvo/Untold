"use client";

import Link from "next/link";
import { usePreviewAuth } from "@/components/auth/preview-auth-provider";
import { PageHeading } from "@/components/app/page-heading";

const onboardingSteps = [
  {
    number: "01",
    title: "Choose how people see you",
    text: "A display name helps a contact recognize you. A name is self-selected; it does not prove who someone is.",
  },
  {
    number: "02",
    title: "Know what privacy means here",
    text: "Account identity, message contents, and connection metadata are separate design questions. The eventual service should explain each one before asking you to continue.",
  },
  {
    number: "03",
    title: "Check a contact’s identity",
    text: "A future conversation could let both people compare a safety code or QR in person. That would check a device key, not a person’s legal identity. Nothing is verified in this prototype.",
  },
];

export function OnboardingPreview() {
  const { session } = usePreviewAuth();

  return (
    <div className="app-page app-page--onboarding">
      <PageHeading
        description="A calm first look at the choices a real account flow will need to make."
        eyebrow="Getting started · preview"
        title="Start with clarity."
      />

      <section aria-label="Current preview session" className="onboarding-session-card">
        <span aria-hidden="true" className="onboarding-session-card__icon">
          ✳
        </span>
        <div>
          <p className="messaging-kicker">
            {session?.source === "account" ? "Account session" : "Temporary demo session"}
          </p>
          {session ? (
            <>
              <h2>Welcome, {session.displayName}.</h2>
              <p>
                {session.email} · {session.source === "demo"
                  ? "sample identity · held in memory only"
                  : session.emailVerified ? "email verified" : "email not verified"}
              </p>
            </>
          ) : (
            <>
              <h2>Explore without signing in.</h2>
              <p>
                Sign in or use the sample profile to explore the workspace. Conversations on these
                screens still use local mock data.
              </p>
            </>
          )}
        </div>
        <span className="onboarding-session-card__status">
          {session?.source === "account" ? "Account created" : "Preview session"}
        </span>
      </section>

      <section aria-labelledby="onboarding-steps-title" className="onboarding-steps">
        <div className="onboarding-steps__heading">
          <p className="messaging-kicker">Before your first conversation</p>
          <h2 id="onboarding-steps-title">A few things should be clear.</h2>
        </div>
        <div className="onboarding-steps__grid">
          {onboardingSteps.map((step) => (
            <article className="onboarding-step" key={step.number}>
              <span className="onboarding-step__number">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <aside aria-labelledby="onboarding-recovery-title" className="onboarding-recovery-card">
        <div>
          <p className="messaging-kicker">Still to decide</p>
          <h2 id="onboarding-recovery-title">What happens if you lose access?</h2>
          <p>
            Account recovery and recovery of future message keys need separate, explicit choices.
          </p>
        </div>
        <Link href="/auth/recovery">
          Review recovery concepts <span aria-hidden="true">↗</span>
        </Link>
      </aside>

      <div className="onboarding-actions">
        <Link className="onboarding-actions__primary" href="/app/inbox">
          Continue to the preview workspace <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/app/profile">View profile</Link>
      </div>

      <p className="onboarding-disclaimer">
        This onboarding does not verify a person or turn on encryption. Message screens still use
        mock data.
      </p>
    </div>
  );
}
