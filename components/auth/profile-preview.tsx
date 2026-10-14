"use client";

import Link from "next/link";
import { PageHeading } from "@/components/app/page-heading";
import { usePreviewAuth } from "@/components/auth/preview-auth-provider";

export function ProfilePreview() {
  const { session } = usePreviewAuth();
  const initials = session?.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="app-page app-page--profile-preview">
      <PageHeading
        description="An honest view of what your current profile does and does not represent."
        eyebrow="Your details"
        title="Profile"
      />

      {session ? (
        <section aria-labelledby="profile-preview-title" className="profile-preview-card">
          <span aria-hidden="true" className="profile-preview-card__avatar">{initials || "U"}</span>
          <div className="profile-preview-card__details">
            <p className="messaging-kicker">
              {session.source === "demo" ? "Temporary sample identity" : "Account profile"}
            </p>
            <h2 id="profile-preview-title">{session.displayName}</h2>
            <p>{session.email}</p>
            <span className="profile-preview-card__status">
              {session.emailVerified ? "Email verified" : "Email not verified"}
              {session.source === "demo" ? " · not saved" : " · saved to your account"}
            </span>
          </div>
          <p className="profile-preview-card__note">
            {session.source === "demo"
              ? "This fictional profile exists only in the current page session. Reloading clears it."
              : "This account profile is stored by the account service. Message delivery and encryption are not yet connected."}
          </p>
        </section>
      ) : (
        <section
          aria-labelledby="profile-preview-title"
          className="profile-preview-card profile-preview-card--empty"
        >
          <p className="messaging-kicker">No account connected</p>
          <h2 id="profile-preview-title">Your profile is not set up.</h2>
          <p>Explore the sign-up and onboarding screens with a fictional temporary profile.</p>
          <Link href="/auth/sign-up">
            Explore account setup <span aria-hidden="true">↗</span>
          </Link>
        </section>
      )}

      <p className="profile-preview-footnote">
        Display names are not proof of identity. Message-key verification is a separate concept and
        is not implemented.
      </p>
    </div>
  );
}
