"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { useInstallPrompt } from "@/components/pwa/install-prompt-provider";
import { InstallAppButton } from "@/components/pwa/install-app-button";

async function getRegistration() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error("Timed out")), 15_000),
    ),
  ]);
}
async function saveSubscription(subscription: PushSubscription, method: "POST" | "DELETE") {
  const response = await fetch("/api/push", {
    method,
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) throw new Error("Save failed");
  window.dispatchEvent(new Event("untold:notifications-changed"));
}

export function NotificationSettings() {
  const { session } = useAccountSession();
  const { isInstalled, platform } = useInstallPrompt();
  const [state, setState] = useState<"loading" | "on" | "off" | "blocked" | "unsupported">(
    "loading",
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    const refresh = async () => {
      const current = ++revision;
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const sub = await registration?.pushManager.getSubscription();
        let registered = false;
        if (sub && Notification.permission === "granted") {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(sub.endpoint),
          );
          const hash = Array.from(new Uint8Array(digest), (value) =>
            value.toString(16).padStart(2, "0"),
          ).join("");
          const response = await fetch(`/api/push?endpoint=${hash}`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: AbortSignal.timeout(15_000),
          });
          registered = response.ok && (await response.json()).registered === true;
        }
        if (!cancelled && current === revision) setState(registered ? "on" : "off");
      } catch {
        if (!cancelled && current === revision) setState("off");
      }
    };
    void refresh();
    const changed = () => {
      void refresh();
    };
    window.addEventListener("untold:notifications-changed", changed);
    return () => {
      cancelled = true;
      window.removeEventListener("untold:notifications-changed", changed);
    };
  }, []);

  async function change() {
    if (!session) return;
    setBusy(true);
    setFeedback("");
    try {
      // This call is directly inside the user gesture, before any network work.
      const permission =
        state === "on" ? Notification.permission : await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await getRegistration();
      const existing = await registration.pushManager.getSubscription();
      if (state === "on") {
        if (existing) {
          await saveSubscription(existing, "DELETE");
          await existing.unsubscribe();
        }
        setState("off");
        setFeedback("Notifications are off on this device.");
        return;
      }
      const response = await fetch("/api/push", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Unavailable");
      const { publicKey } = (await response.json()) as { publicKey: string };
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (value) =>
        value.charCodeAt(0),
      );
      let subscription = existing;
      if (
        existing &&
        new Uint8Array(existing.options.applicationServerKey ?? new ArrayBuffer(0)).join(",") !==
          key.join(",")
      ) {
        await existing.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await saveSubscription(subscription, "POST");
      setState("on");
      setFeedback("Notifications are on. New messages will show a private alert.");
    } catch {
      setFeedback("We couldn’t update notifications. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  const installFirst = platform === "apple-mobile" && !isInstalled;
  return (
    <article className="notification-settings">
      <div>
        <p className="messaging-kicker">Stay in touch</p>
        <h2>Message notifications</h2>
        <p>
          Get an alert for new messages on this device. Alerts never show message text, photos, or
          your contact’s name.
        </p>
      </div>
      {installFirst ? (
        <>
          <p>
            On iPhone or iPad, add Untold to your Home Screen, open it from its icon, and return
            here to enable notifications.
          </p>
          <InstallAppButton placement="settings" />
        </>
      ) : state === "unsupported" ? (
        <p>
          Notifications aren’t supported in this browser. Try the installed app or an up-to-date
          browser.
        </p>
      ) : state === "blocked" ? (
        <p>
          Notifications are blocked. Allow notifications for Untold in your browser or device
          settings, then reopen this page.
        </p>
      ) : (
        <button
          className="security-button security-button--secondary"
          disabled={busy || state === "loading" || !session}
          onClick={() => void change()}
          type="button"
        >
          {state === "on" ? (
            <BellOff aria-hidden="true" size={16} />
          ) : (
            <Bell aria-hidden="true" size={16} />
          )}
          {busy
            ? "Updating…"
            : state === "loading"
              ? "Checking notifications…"
              : state === "on"
                ? "Turn off notifications"
                : "Enable notifications"}
        </button>
      )}
      <p aria-live="polite" className="auth-field__hint" role="status">
        {feedback ||
          (state === "on" && !installFirst ? "Notifications are on for this browser." : "")}
      </p>
    </article>
  );
}

// Restore a permitted subscription to the current session after signing in again.
export function NotificationSessionSync() {
  const { session } = useAccountSession();
  const userId = session?.id;
  const sessionId = session?.sessionId;
  useEffect(() => {
    if (
      !userId ||
      !sessionId ||
      !("serviceWorker" in navigator) ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    )
      return;
    let cancelled = false;
    void navigator.serviceWorker
      .getRegistration("/")
      .then(async (registration) => {
        if (registration)
          await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription && !cancelled) await saveSubscription(subscription, "POST");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, sessionId]);
  return null;
}
