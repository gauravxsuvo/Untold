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
            <p>Use your email address and password to sign in.</p>
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
            <p className="messaging-kicker">Your account</p>
            <h2>{session ? "Signed in" : "Loading your account…"}</h2>
            <p>
              {session
                ? session.email
                : "This only takes a moment."}
            </p>
          </div>
          <span className="account-settings-preview__status">{session ? "Signed in" : "Loading"}</span>
        </article>
        <article>
          <div>
            <p className="messaging-kicker">Message privacy</p>
            <h2>Before you share</h2>
            <p>What to know before you send a message.</p>
            <ul className="account-privacy-notes">
              <li>Messages and files are encrypted on your device before you send them.</li>
              <li>Compare safety codes with your contact by phone or in person before sharing.</li>
              <li>Privacy features are still being tested and haven’t been independently checked.</li>
              <li>If someone gets your browser’s saved security information, past messages may be exposed.</li>
              <li>Messages sent before encryption was added may not have the same protection.</li>
              <li>Untold still knows who has an account and who talks to whom.</li>
              <li>Someone with access to an unlocked device can read its messages.</li>
            </ul>
          </div>
        </article>
        <article>
          <div>
            <p className="messaging-kicker">Recovery</p>
            <h2>Keep your password safe</h2>
            <p>Password resets aren’t available yet. Save your password in a password manager.</p>
          </div>
          <Link href="/auth/recovery">
            Help with signing in <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
          </Link>
        </article>
      </section>
    </div>
  );
}
