import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { SessionControl } from "@/components/auth/session-control";
import { ApplicationNavigation } from "@/components/app/application-navigation";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";

export function ApplicationShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <a className="app-skip-link" href="#app-content">
        Skip to content
      </a>

      <aside className="app-sidebar" aria-label="Application sidebar">
        <Link aria-label="Untold inbox" className="app-brand" href="/app/inbox">
          <Wordmark />
        </Link>

        <div className="app-sidebar__label">Your space</div>
        <ApplicationNavigation placement="sidebar" />

        <SessionControl placement="sidebar" />
      </aside>

      <div className="app-main-column">
        <header className="app-mobile-header">
          <Link aria-label="Untold inbox" className="app-brand" href="/app/inbox">
            <Wordmark />
          </Link>
          <div className="app-mobile-header__actions">
            <ThemeSwitcher compact />
            <InstallAppButton placement="mobile" />
            <SessionControl placement="mobile" />
          </div>
        </header>

        <main className="app-main" id="app-content" tabIndex={-1}>
          <div className="app-topbar">
            <span className="app-topbar__title">Your conversations</span>
            <div className="app-topbar__actions">
              <ThemeSwitcher compact />
              <InstallAppButton />
              <span className="app-preview-pill">
                <MessageCircle aria-hidden="true" size={14} strokeWidth={1.8} />
                Early access
              </span>
            </div>
          </div>
          {children}
          <footer className="app-main__footer">
            <span>Some things are just between us.</span>
            <span>Check your contact’s safety code before sharing anything sensitive.</span>
          </footer>
        </main>
      </div>

      <ApplicationNavigation placement="mobile" />
    </div>
  );
}
