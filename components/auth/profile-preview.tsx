"use client";

import { PageHeading } from "@/components/app/page-heading";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { initialsFor } from "@/lib/messaging/people";

export function ProfilePreview() {
  const { session, isSessionPending } = useAccountSession();

  return (
    <div className="app-page app-page--profile-preview">
      <PageHeading
        description="How you appear to the people you talk with."
        eyebrow="Your details"
        title="Profile"
      />

      {session ? (
        <section aria-labelledby="profile-preview-title" className="profile-preview-card">
          <span aria-hidden="true" className="profile-preview-card__avatar">
            {initialsFor(session.displayName)}
          </span>
          <div className="profile-preview-card__details">
            <p className="messaging-kicker">Account profile</p>
            <h2 id="profile-preview-title">{session.displayName}</h2>
            <p>{session.email}</p>
            <span className="profile-preview-card__status">
              {session.emailVerified ? "Email verified" : "Email not verified"}
            </span>
          </div>
          <p className="profile-preview-card__note">
            People who start a conversation with you, or whom you start one with, see your display
            name and email address.
          </p>
        </section>
      ) : (
        <section
          aria-labelledby="profile-preview-title"
          className="profile-preview-card profile-preview-card--empty"
        >
          <p className="messaging-kicker">{isSessionPending ? "Loading" : "Signed out"}</p>
          <h2 id="profile-preview-title">
            {isSessionPending ? "Loading your profile…" : "Sign in to see your profile."}
          </h2>
        </section>
      )}

      <p className="profile-preview-footnote">
        Display names are self-chosen and are not proof of identity. Contact safety-code
        verification is not implemented yet.
      </p>
    </div>
  );
}
