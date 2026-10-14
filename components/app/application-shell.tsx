import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { SessionControl } from "@/components/auth/session-control";
import { ApplicationNavigation } from "@/components/app/application-navigation";

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

        <div className="app-sidebar__label">Workspace</div>
        <ApplicationNavigation placement="sidebar" />

        <SessionControl placement="sidebar" />
      </aside>

      <div className="app-main-column">
        <header className="app-mobile-header">
          <Link aria-label="Untold inbox" className="app-brand" href="/app/inbox">
            <Wordmark />
          </Link>
          <div className="app-mobile-header__actions">
            <SessionControl placement="mobile" />
          </div>
        </header>

        <main className="app-main" id="app-content" tabIndex={-1}>
          <div className="app-topbar">
            <span>Private by intention</span>
            <span className="app-preview-pill">
              <i aria-hidden="true" />
              Not end-to-end encrypted
            </span>
          </div>
          {children}
          <footer className="app-main__footer">
            <span>Some things are just between us.</span>
            <span>Messages are sent over HTTPS and stored on the server. End-to-end encryption is not implemented yet.</span>
          </footer>
        </main>
      </div>

      <ApplicationNavigation placement="mobile" />
    </div>
  );
}
