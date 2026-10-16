"use client";
import Link from "next/link";
import { Phone, PhoneIncoming, PhoneOutgoing, UsersRound, Video } from "lucide-react";
import {
  callLabel,
  callOutcome,
  formatCallDuration,
  type CallHistoryEntry,
} from "@/lib/messaging/call-history";
import { useCalls } from "./call-provider";
import { useMessagingDevice } from "./messaging-device-provider";
import { initialsFor } from "@/lib/messaging/people";

export function CallHistoryCard({
  entry,
  viewerId,
  compact = false,
}: {
  entry: CallHistoryEntry;
  viewerId: string;
  compact?: boolean;
}) {
  const calls = useCalls();
  const device = useMessagingDevice();
  const Icon = entry.source === "group" ? UsersRound : entry.kind === "video" ? Video : Phone;
  const Direction = entry.initiatorId === viewerId ? PhoneOutgoing : PhoneIncoming;
  const own = entry.participants.find((person) => person.userId === viewerId);
  const canJoin = entry.source === "group" && entry.status === "live" && own?.status !== "declined";
  const canCall = entry.source === "direct" && entry.status === "ended";
  return (
    <article
      className={`call-history-card${compact ? " call-history-card--compact" : ""}${entry.missed ? " is-missed" : ""}`}
    >
      <div className="call-history-card__icon" aria-hidden="true">
        {compact || entry.source === "group" ? <Icon size={23} /> : initialsFor(entry.name)}
      </div>
      <div className="call-history-card__body">
        <strong>{compact ? callLabel(entry, viewerId) : entry.name}</strong>
        <p>
          {!compact ? (
            <>
              <Direction size={14} aria-hidden="true" />
              {callLabel(entry, viewerId)} ·{" "}
            </>
          ) : null}
          {callOutcome(entry)}
          {entry.durationSeconds !== null ? ` · ${formatCallDuration(entry.durationSeconds)}` : ""}
        </p>
        <time dateTime={entry.createdAt}>
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
            new Date(entry.createdAt),
          )}
        </time>
        <details>
          <summary>Call details</summary>
          <div className="call-history-card__details">
            <p>
              {entry.legacy
                ? "Older call — outcome and duration may be unavailable."
                : "Call activity is system metadata. Calls are not recorded."}
            </p>
            {entry.personalSeconds !== null ? (
              <p>Your time: {formatCallDuration(entry.personalSeconds)}</p>
            ) : null}
            <ul>
              {entry.participants.map((person) => (
                <li key={person.userId}>
                  <span>{person.userId === viewerId ? "You" : person.name}</span>
                  <span>
                    {person.status === "invited"
                      ? "Invited"
                      : person.status === "declined"
                        ? "Declined"
                        : person.status === "joined"
                          ? "Joined"
                          : "Left"}
                    {person.seconds !== null ? ` · ${formatCallDuration(person.seconds)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href={`/app/conversations?conversation=${encodeURIComponent(entry.conversationId)}`}
            >
              Open chat
            </Link>
          </div>
        </details>
      </div>
      {canCall || canJoin ? (
        <button
          className="feature-button call-history-card__action"
          type="button"
          disabled={calls.active || !device.approved}
          aria-label={`${canJoin ? "Join" : "Call back"} ${entry.name}`}
          onClick={() =>
            void calls.start(
              entry.conversationId,
              entry.name,
              entry.kind,
              entry.source === "group",
              canJoin ? entry.sourceId : undefined,
            )
          }
        >
          <Phone size={17} />
          <span>{canJoin ? "Join" : "Call back"}</span>
        </button>
      ) : null}
    </article>
  );
}
