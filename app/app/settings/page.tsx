"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PageHeading } from "@/components/app/page-heading";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { DeviceManagement } from "@/components/messaging/device-management";
import { InstallAppButton } from "@/components/pwa/install-app-button";

export default function SettingsPage() {
  const { session } = useAccountSession();

  return (
    <div className="app-page">
      <PageHeading
        description="Manage your account, devices, and privacy."
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
            View account profile <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
          </Link>
        </article>
        <article className="account-settings-preview__install">
          <div>
            <p className="messaging-kicker">Your devices</p>
            <h2>Install Untold</h2>
            <p>
              Open Untold in its own window on your computer, or add it to your Android
              home screen. Your conversations stay connected to your account.
            </p>
          </div>
          <InstallAppButton placement="settings" />
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
            <p>What to know before you send a message.</p>
            <ul className="account-privacy-notes">
              <li>New messages and files are encrypted in your browser before upload.</li>
              <li>Compare safety codes with your contact before trusting a new device.</li>
              <li>Protocol v1 has no forward secrecy and has not had an independent security review.</li>
              <li>Older unencrypted history was removed from the live database; backups may retain copies.</li>
              <li>Someone with access to an unlocked device can read its messages.</li>
            </ul>
          </div>
        </article>
        <article>
          <div>
            <p className="messaging-kicker">Recovery</p>
            <h2>Not configured</h2>
            <p>Password reset by email is not set up yet. Keep your password somewhere safe.</p>
          </div>
          <Link href="/auth/recovery">
            Review recovery concepts <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
          </Link>
        </article>
      </section>
    </div>
  );
}
