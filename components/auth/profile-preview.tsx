"use client";

import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

import { PageHeading } from "@/components/app/page-heading";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { useState } from "react";
import { Avatar } from "@/components/profile/avatar";
import { ProfilePhotoEditor } from "@/components/profile/profile-photo-editor";

export function ProfilePreview() {
  const { session, isSessionPending, refreshSession } = useAccountSession();
  const [photoOverride, setPhotoOverride] = useState<{ owner: string; image: string | null } | null>(null);
  const image = photoOverride?.owner === session?.id ? photoOverride?.image : session?.image;

  function handlePhotoChange(next: string | null) {
    if (!session) return;
    setPhotoOverride({ owner: session.id, image: next });
    void refreshSession().catch(() => {});
  }

  return (
    <div className="app-page app-page--profile-preview">
      <PageHeading
        description="How you appear to the people you talk with."
        eyebrow="Your details"
        title="Profile"
      />

      {session ? (
        <section aria-labelledby="profile-preview-title" className="profile-preview-card">
          <Avatar className="profile-preview-card__avatar" id={session.id} image={image} name={session.displayName} />
          <div className="profile-preview-card__details">
            <p className="messaging-kicker">Account profile</p>
            <h2 id="profile-preview-title">{session.displayName}</h2>
            <p>{session.email}</p>
            <span className="profile-preview-card__status">
              Your account
            </span>
          </div>
          <ProfilePhotoEditor hasPhoto={Boolean(image)} image={image} key={session.id} onChange={handlePhotoChange} />
          <p className="profile-preview-card__note">
            People who start a conversation with you, or whom you start one with, see your display
            name, profile photo, and email address.
          </p>
        </section>
      ) : isSessionPending ? <LoadingSkeleton kind="profile" label="Loading your profile…" rows={1} /> : (
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
        A name alone doesn’t confirm who someone is. Compare your contact’s safety code
        by phone or in person before sharing anything sensitive.
      </p>
    </div>
  );
}
