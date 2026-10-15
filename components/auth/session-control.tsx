"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, LogOut, UserRound } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { initialsFor } from "@/lib/messaging/people";

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
        <LogOut aria-hidden="true" size={14} strokeWidth={1.8} />
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
      <span aria-hidden="true" className="app-sidebar__avatar">
        {session ? initialsFor(session.displayName) : <UserRound size={17} strokeWidth={1.8} />}
      </span>
      <div className="app-sidebar__session-copy">
        {session ? (
          <>
            <strong>{session.displayName}</strong>
            <small>{session.email}</small>
            <button className="app-sidebar__session-action" onClick={handleSignOut} type="button">
              <LogOut aria-hidden="true" size={14} strokeWidth={1.8} />
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
              Sign in <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
