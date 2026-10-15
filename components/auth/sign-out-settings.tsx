"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";

export function SignOutSettings() {
  const { session, signOut } = useAccountSession();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);

  if (!session) return null;

  async function handleSignOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await signOut();
      router.replace("/auth/sign-in?status=signed-out");
      router.refresh();
    } catch {
      setError("Couldn’t sign out. Check your connection and try again.");
      setPending(false);
      inFlight.current = false;
    }
  }

  return (
    <article className="account-security account-signout">
      <div>
        <p className="messaging-kicker">This device</p>
        <h2>Sign out</h2>
        <p>
          {confirming
            ? "Sign out of Untold on this device? You can sign in again whenever you’re ready."
            : `You’re signed in as ${session.email}.`}
        </p>
      </div>
      {confirming ? (
        <fieldset className="security-actions account-signout__confirmation" disabled={pending}>
          <legend className="sr-only">Confirm sign out</legend>
          <button
            className="security-button security-button--secondary"
            disabled={pending}
            onClick={() => {
              setConfirming(false);
              setError("");
            }}
            ref={cancelButton}
            type="button"
          >
            Stay signed in
          </button>
          <button
            className="security-button"
            disabled={pending}
            onClick={handleSignOut}
            type="button"
          >
            {pending ? (
              <LoaderCircle aria-hidden="true" className="app-loading-spinner" size={16} />
            ) : (
              <LogOut aria-hidden="true" size={16} />
            )}
            {pending ? "Signing out…" : "Yes, sign out"}
          </button>
        </fieldset>
      ) : (
        <button
          className="security-button security-button--secondary"
          onClick={() => {
            setConfirming(true);
            requestAnimationFrame(() => cancelButton.current?.focus());
          }}
          type="button"
        >
          <LogOut aria-hidden="true" size={16} /> Sign out
        </button>
      )}
      {error ? (
        <p className="messaging-error" role="alert">
          {error}
        </p>
      ) : null}
      {pending ? (
        <span className="sr-only" role="status">
          Signing out…
        </span>
      ) : null}
    </article>
  );
}
