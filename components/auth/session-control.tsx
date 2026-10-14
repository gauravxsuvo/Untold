"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccountSession } from "@/components/auth/account-session-provider";

export function SessionControl({ placement }: { placement: "sidebar" | "mobile" }) {
  const { session, isSessionPending, signOut } = useAccountSession();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.replace("/auth/sign-in?status=signed-out");
    router.refresh();
  }

  if (placement === "mobile") {
    return session ? (
      <button className="app-preview-pill app-preview-pill--action" onClick={handleSignOut} type="button">
        Sign out
      </button>
    ) : isSessionPending ? (
      <span className="app-preview-pill" aria-live="polite">Checking account…</span>
    ) : (
      <Link className="app-preview-pill" href="/auth/sign-in">
        Sign in
      </Link>
    );
  }

  return (
    <div className="app-sidebar__foot">
      <span aria-hidden="true" className="app-status-dot" />
      <div className="app-sidebar__session-copy">
        {session ? (
          <>
            <strong>{session.displayName}</strong>
            <small>{session.email}</small>
            <button className="app-sidebar__session-action" onClick={handleSignOut} type="button">
              Sign out
            </button>
          </>
        ) : isSessionPending ? (
          <>
            <strong>Checking account</strong>
            <small aria-live="polite">Connecting…</small>
          </>
        ) : (
          <>
            <strong>Signed out</strong>
            <small>No account session</small>
            <Link className="app-sidebar__session-action" href="/auth/sign-in">
              Sign in <span aria-hidden="true">↗</span>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
