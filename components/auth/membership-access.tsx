"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { SignOutSettings } from "@/components/auth/sign-out-settings";

export function MembershipAccess({
  waiting = false,
  initialStatus = "pending",
}: {
  waiting?: boolean;
  initialStatus?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/access", {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401) {
        router.replace("/auth/sign-in");
        return;
      }
      if (!response.ok) throw new Error();
      const access = await response.json();
      setError("");
      setStatus(access.status);
      if (waiting && access.status === "approved") {
        router.replace("/app/inbox");
        router.refresh();
      }
      if (!waiting && access.status !== "approved") router.replace("/access");
    } catch {
      if (waiting) setError("We couldn’t check your request. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [router, waiting]);
  useEffect(() => {
    let active = true;
    const check = () => {
      if (active && document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(check, 20_000);
    window.addEventListener("focus", check);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [refresh]);
  if (!waiting) return null;
  return (
    <section className="membership-waiting">
      <span className="membership-waiting__icon">
        <Clock3 size={28} aria-hidden="true" />
      </span>
      <p className="messaging-kicker">A private space</p>
      <h1>{status === "rejected" ? "Your request wasn’t approved" : "You’re on the list"}</h1>
      <p>
        {status === "rejected"
          ? "This account can’t access Untold right now. If you know the owner, you can ask them to review your request."
          : "Your account is ready. The owner will review your request before you can start chatting."}
      </p>
      <button
        className="feature-button"
        disabled={busy}
        onClick={() => void refresh()}
        type="button"
      >
        <RefreshCw size={16} aria-hidden="true" />
        {busy ? "Checking…" : "Check request"}
      </button>
      {error ? (
        <p role="alert" className="messaging-error">
          {error}
        </p>
      ) : null}
      <SignOutSettings />
    </section>
  );
}

export function AdminAccessLink() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/access", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => setAdmin(a?.admin === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return admin ? (
    <article>
      <div>
        <p className="messaging-kicker">Private membership</p>
        <h2>Account requests</h2>
        <p>Choose who can join Untold and manage member access.</p>
      </div>
      <Link href="/app/admin">
        <ShieldCheck size={16} aria-hidden="true" /> Review accounts
      </Link>
    </article>
  ) : null;
}
