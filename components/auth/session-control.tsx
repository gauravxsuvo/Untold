"use client";

import Link from "next/link";
import { ArrowUpRight, UserRound } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { Avatar } from "@/components/profile/avatar";

export function SessionControl() {
  const { session, isSessionPending } = useAccountSession();

  return (
    <div className="app-sidebar__foot">
      {session ? (
        <Avatar
          className="app-sidebar__avatar"
          id={session.id}
          image={session.image}
          name={session.displayName}
        />
      ) : (
        <span aria-hidden="true" className="app-sidebar__avatar">
          <UserRound size={17} strokeWidth={1.8} />
        </span>
      )}
      <div className="app-sidebar__session-copy">
        {session ? (
          <>
            <strong>{session.displayName}</strong>
            <small>{session.email}</small>
            <Link className="app-sidebar__session-action" href="/app/settings">
              Account settings <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
            </Link>
          </>
        ) : isSessionPending ? (
          <>
            <strong>Checking account</strong>
            <small aria-live="polite">Connecting…</small>
          </>
        ) : (
          <>
            <strong>Signed out</strong>
            <small>Sign in to continue</small>
            <Link className="app-sidebar__session-action" href="/auth/sign-in">
              Sign in <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
