"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, RefreshCw } from "lucide-react";
import { useAccountSession } from "@/components/auth/account-session-provider";
import { useMessagingDevice } from "./messaging-device-provider";
import { useCallHistoryStatus } from "./call-history-provider";
import { CallHistoryCard } from "./call-history-entry";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import type { CallHistoryEntry, CallHistoryPage } from "@/lib/messaging/call-history";

export function CallHistoryList() {
  const { session } = useAccountSession();
  const { device, approved, state } = useMessagingDevice();
  const { refresh: refreshBadge } = useCallHistoryStatus();
  const [filter, setFilter] = useState("all");
  const [entries, setEntries] = useState<CallHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const inFlight = useRef(false);
  const cursorLoaded = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const refresh = useCallback(
    async (before?: string | null) => {
      if (!device || !approved || inFlight.current) return;
      const token = generation.current;
      inFlight.current = true;
      setPending(true);
      try {
        const query = new URLSearchParams({ deviceId: device.deviceId, filter });
        const liveIds = entriesRef.current
          .filter((entry) => entry.status === "live")
          .slice(0, 100)
          .map((entry) => entry.id);
        if (liveIds.length) query.set("live", liveIds.join(","));
        if (before) query.set("before", before);
        const response = await fetch(`/api/call-history?${query}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          if ([401, 403].includes(response.status) && token === generation.current) setEntries([]);
          throw new Error("Call history could not load. Check your connection and try again.");
        }
        const page: CallHistoryPage = await response.json();
        if (token !== generation.current) return;
        setEntries((current) =>
          [
            ...new Map(
              [...current, ...page.calls, ...(page.updates ?? [])].map((entry) => [
                entry.id,
                entry,
              ]),
            ).values(),
          ]
            .filter((entry) => filter !== "missed" || entry.missed)
            .sort(
              (a, b) =>
                Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id),
            ),
        );
        if (before || !cursorLoaded.current) setCursor(page.nextCursor);
        if (before) cursorLoaded.current = true;
        setError("");
      } catch (caught) {
        if (token === generation.current)
          setError(caught instanceof Error ? caught.message : "Call history could not load.");
      } finally {
        if (token === generation.current) {
          inFlight.current = false;
          setPending(false);
        }
      }
    },
    [device, approved, filter],
  );
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    cursorLoaded.current = false;
    setEntries([]);
    setCursor(null);
    void refresh();
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(update, 15000);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("untold-call-history-refresh", update);
    return () => {
      generation.current++;
      clearInterval(timer);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("untold-call-history-refresh", update);
    };
  }, [refresh]);
  useEffect(() => {
    if (!device || !approved) return;
    const token = generation.current;
    let frame = 0,
      busy = false,
      disposed = false;
    const acknowledge = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || busy || !document.hasFocus() || document.visibilityState !== "visible")
          return;
        const ids = entries
          .filter((entry) => {
            if (!entry.missed || entry.acknowledged) return false;
            const node = document.querySelector(`[data-call-history-id="${entry.id}"]`);
            const box = node?.getBoundingClientRect();
            return (
              box &&
              box.bottom > 0 &&
              box.top < window.innerHeight &&
              box.right > 0 &&
              box.left < window.innerWidth
            );
          })
          .slice(0, 50)
          .map((entry) => entry.id);
        if (!ids.length) return;
        busy = true;
        void fetch(`/api/call-history?deviceId=${device.deviceId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
          signal: AbortSignal.timeout(15000),
        })
          .then((response) => {
            if (response.ok && !disposed && token === generation.current) {
              setEntries((current) =>
                current.map((entry) =>
                  ids.includes(entry.id) ? { ...entry, acknowledged: true } : entry,
                ),
              );
              refreshBadge();
            }
          })
          .catch(() => {})
          .finally(() => {
            busy = false;
          });
      });
    };
    acknowledge();
    window.addEventListener("scroll", acknowledge, true);
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", acknowledge, true);
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
    };
  }, [entries, device, approved, refreshBadge]);
  if (!approved)
    return (
      <p className="calls-empty">
        {state === "loading" ? (
          "Getting this device ready…"
        ) : (
          <>
            Approve this device in <Link href="/app/settings">Settings</Link> to see your calls.
          </>
        )}
      </p>
    );
  return (
    <section className="calls-page" aria-label="Call history">
      <div className="calls-toolbar">
        <fieldset aria-label="Filter calls">
          {["all", "missed"].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All calls" : "Missed"}
            </button>
          ))}
        </fieldset>
        <button
          className="feature-button"
          type="button"
          disabled={pending}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      {error ? (
        <p role="alert" className="messaging-error">
          {error}
        </p>
      ) : null}
      {pending && !entries.length ? (
        <LoadingSkeleton label="Loading calls…" rows={4} />
      ) : entries.length ? (
        <ol className="calls-list">
          {entries.map((entry, index) => (
            <li key={entry.id} data-call-history-id={entry.id}>
              {!index ||
              new Date(entries[index - 1].createdAt).toDateString() !==
                new Date(entry.createdAt).toDateString() ? (
                <h2 className="calls-date">
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(
                    new Date(entry.createdAt),
                  )}
                </h2>
              ) : null}
              <CallHistoryCard entry={entry} viewerId={session?.id ?? ""} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="calls-empty">
          <Phone size={32} aria-hidden="true" />
          <h2>{filter === "missed" ? "No missed calls" : "Your calls, all together"}</h2>
          <p>
            {filter === "missed"
              ? "Unanswered incoming calls will appear here."
              : "Voice and video calls from your chats and groups will appear here."}
          </p>
          <Link className="feature-button" href="/app/contacts">
            Find someone to call
          </Link>
        </div>
      )}
      {cursor ? (
        <button
          className="feature-button"
          type="button"
          disabled={pending}
          onClick={() => void refresh(cursor)}
        >
          {pending ? "Loading…" : "Earlier calls"}
        </button>
      ) : null}
    </section>
  );
}
