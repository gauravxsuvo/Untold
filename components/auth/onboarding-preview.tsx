"use client";

import Link from "next/link";
import { useAccountSession } from "@/components/auth/account-session-provider";
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
    text: "Messages are sent over HTTPS and stored on Untold’s server. They are not end-to-end encrypted yet, so the server operator can read them. Share accordingly.",
  },
  {
    number: "03",
    title: "Start a conversation",
    text: "Ask a friend to sign up, then enter their account email under Conversations or Contacts. They will see your display name and email.",
  },
];

export function OnboardingPreview() {
  const { session } = useAccountSession();

  return (
    <div className="app-page app-page--onboarding">
      <PageHeading
        description="A few things worth knowing before your first conversation."
        eyebrow="Getting started"
        title="Start with clarity."
      />

      <section aria-label="Current session" className="onboarding-session-card">
        <span aria-hidden="true" className="onboarding-session-card__icon">
          ✳
        </span>
        <div>
          <p className="messaging-kicker">
            {session ? "Account session" : "Checking account"}
          </p>
          {session ? (
            <>
              <h2>Welcome, {session.displayName}.</h2>
              <p>
                {session.email} · {session.emailVerified ? "email verified" : "email not verified"}
              </p>
            </>
          ) : (
            <>
              <h2>Loading your account…</h2>
              <p>This only takes a moment.</p>
            </>
          )}
        </div>
        <span className="onboarding-session-card__status">
          {session ? "Account ready" : "Loading"}
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
          Go to your inbox <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/app/profile">View profile</Link>
      </div>

      <p className="onboarding-disclaimer">
        Display names are self-chosen and are not proof of identity. End-to-end encryption is not
        implemented yet.
      </p>
    </div>
  );
}
