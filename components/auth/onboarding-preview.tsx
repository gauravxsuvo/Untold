"use client";

import Link from "next/link";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { PageHeading } from "@/components/app/page-heading";

const onboardingSteps = [
  {
    number: "01",
    title: "Choose how people see you",
    text: "Your friends see your display name and email address. A name alone doesn’t confirm who someone is.",
  },
  {
    number: "02",
    title: "Check your friend’s safety code",
    text: "Compare the safety codes in your conversation by phone or in person. Only confirm a code when it matches the one your friend sees.",
  },
  {
    number: "03",
    title: "Start a conversation",
    text: "Ask a friend to join Untold, then find them by email in Conversations or Contacts. You’re ready to say hello.",
  },
];

export function OnboardingPreview() {
  const { session } = useAccountSession();

  return (
    <div className="app-page app-page--onboarding">
      <PageHeading
        description="A few things worth knowing before your first conversation."
        eyebrow="Getting started"
        title="Make yourself at home."
      />

      <section aria-label="Current session" className="onboarding-session-card">
        <span aria-hidden="true" className="onboarding-session-card__icon">
          <MessageCircle size={24} />
        </span>
        <div>
          <p className="messaging-kicker">
            {session ? "Your account" : "Loading your account"}
          </p>
          {session ? (
            <>
              <h2>Welcome, {session.displayName}.</h2>
              <p>
                {session.email}
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
          <h2 id="onboarding-steps-title">Three simple steps.</h2>
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
          <p className="messaging-kicker">Keep your history</p>
          <h2 id="onboarding-recovery-title">Take care of your password and devices.</h2>
          <p>
            Password resets aren’t available yet. Clearing your browser data or losing a device
            can also make older messages unreadable, even if you sign in again.
          </p>
        </div>
        <Link href="/auth/recovery">
          Help with signing in <ArrowUpRight aria-hidden="true" size={16} />
        </Link>
      </aside>

      <div className="onboarding-actions">
        <Link className="onboarding-actions__primary" href="/app/inbox">
          Go to your inbox <ArrowUpRight aria-hidden="true" size={16} />
        </Link>
        <Link href="/app/profile">View profile</Link>
      </div>

      <p className="onboarding-disclaimer">
        Untold is in early access. Privacy features haven’t been independently checked yet.
        Keep this in mind before sharing anything sensitive.
      </p>
    </div>
  );
}
