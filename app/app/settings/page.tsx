"use client";

import Link from "next/link";
import { PageHeading } from "@/components/app/page-heading";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { DeviceManagement } from "@/components/messaging/device-management";

export default function SettingsPage() {
  const { session } = useAccountSession();

  return (
    <div className="app-page">
      <PageHeading
        description="Your account and what Untold does with your messages."
        eyebrow="Account and privacy"
        title="Settings"
      />
      <section aria-label="Account settings" className="account-settings-preview">
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
        {session ? <DeviceManagement accountId={session.id} /> : null}
        <article>
          <div>
            <p className="messaging-kicker">Current session</p>
            <h2>{session ? "Signed in" : "Checking session…"}</h2>
            <p>
              {session
                ? `${session.email} · ${session.emailVerified ? "email verified" : "email not verified"}`
                : "Your session is loading."}
            </p>
          </div>
          <span className="account-settings-preview__status">Account session</span>
        </article>
        <article>
          <div>
            <p className="messaging-kicker">Message privacy</p>
            <h2>Device encryption prototype</h2>
            <p>
              New messages and shared files are encrypted on your browser before Untold stores them.
              Compare device safety codes with your contact before trusting a device. Migration 006 removes older
              unencrypted message rows from the live database; backups may retain copies. Protocol
              v1 has no forward secrecy and has not had an independent security review. Someone
              who gains access to an unlocked device may be able to read its messages.
            </p>
          </div>
        </article>
        <article>
          <div>
            <p className="messaging-kicker">Recovery</p>
            <h2>Not configured</h2>
            <p>Password reset by email is not set up yet. Keep your password somewhere safe.</p>
          </div>
          <Link href="/auth/recovery">
            Review recovery concepts <span aria-hidden="true">↗</span>
          </Link>
        </article>
      </section>
    </div>
  );
}
