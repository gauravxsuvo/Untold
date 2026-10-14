"use client";

import Link from "next/link";
import { PageHeading } from "@/components/app/page-heading";
import { usePreviewAuth } from "@/components/auth/preview-auth-provider";

export default function SettingsPage() {
  const { session } = usePreviewAuth();

  return (
    <div className="app-page">
      <PageHeading
        description="Account access is connected. Recovery and conversation privacy choices are still being designed."
        eyebrow="Account and privacy"
        title="Settings"
      />
      <section aria-label="Account settings preview" className="account-settings-preview">
        <article>
          <div>
            <p className="messaging-kicker">Sign-in method</p>
            <h2>Untold account</h2>
            <p>Accounts use email and password. Email verification is not configured yet.</p>
          </div>
          <Link href="/app/profile">
            View account profile <span aria-hidden="true">↗</span>
          </Link>
        </article>
        <article>
          <div>
            <p className="messaging-kicker">Current session</p>
            <h2>
              {session?.source === "account"
                ? "Signed in"
                : session?.source === "demo"
                  ? "Temporary demo session"
                  : "No account session"}
            </h2>
            <p>
              {session?.source === "account"
                ? `${session.email} · ${session.emailVerified ? "email verified" : "email not verified"}`
                : session?.source === "demo"
                  ? "A fictional sample profile is held in page memory."
                  : "Sign in to use an account session or explore with the sample profile."}
            </p>
          </div>
          <span className="account-settings-preview__status">
            {session?.source === "account" ? "Account session" : "Preview"}
          </span>
        </article>
        <article>
          <div>
            <p className="messaging-kicker">Recovery</p>
            <h2>Not configured</h2>
            <p>Account access recovery and future message-key recovery need separate decisions.</p>
          </div>
          <Link href="/auth/recovery">
            Review recovery concepts <span aria-hidden="true">↗</span>
          </Link>
        </article>
      </section>
      <p className="account-settings-preview__note">
        Message screens still use mock data. Nothing is end-to-end encrypted, and no account recovery
        email is sent.
      </p>
    </div>
  );
}
