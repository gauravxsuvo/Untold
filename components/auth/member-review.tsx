"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
type Member = { id: string; name: string; email: string; status: string; requestedAt: string };
export function MemberReview() {
  const [filter, setFilter] = useState("pending");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/members?status=${filter}&page=${page}`, {
          cache: "no-store",
          signal: signal ?? AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error();
        const result = await response.json();
        setMembers(result.members);
        setHasMore(result.hasMore);
        setError("");
      } catch {
        if (!signal?.aborted) setError("We couldn’t load account requests. Try again.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filter, page],
  );
  useEffect(() => {
    const c = new AbortController();
    void refresh(c.signal);
    return () => c.abort();
  }, [refresh]);
  async function review(member: Member, status: "approved" | "rejected") {
    if (
      status === "rejected" &&
      !window.confirm(
        `Remove access for ${member.name}? They won’t be able to use Untold until you approve them again.`,
      )
    )
      return;
    setBusy(member.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, status }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error();
      setNotice(
        status === "approved"
          ? `${member.name} can now use Untold.`
          : `${member.name} no longer has access.`,
      );
      await refresh();
    } catch {
      setError("We couldn’t save that decision. Please try again.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="member-review">
      <fieldset className="member-review__filters" aria-label="Filter accounts">
        {["pending", "approved", "rejected"].map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filter === status}
            disabled={Boolean(busy)}
            onClick={() => {
              setFilter(status);
              setPage(0);
            }}
          >
            {status === "pending" ? "Requests" : status === "approved" ? "Members" : "Declined"}
          </button>
        ))}
        <button
          type="button"
          aria-label="Refresh requests"
          disabled={loading || Boolean(busy)}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
        </button>
      </fieldset>
      {error ? (
        <p role="alert" className="messaging-error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {loading ? (
        <LoadingSkeleton label="Loading accounts…" />
      ) : members.length ? (
        <ul className="member-review__list">
          {members.map((member) => (
            <li key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <span>{member.email}</span>
                <small>Joined {new Date(member.requestedAt).toLocaleDateString()}</small>
              </div>
              <div className="member-review__actions">
                {member.status !== "approved" ? (
                  <button
                    className="feature-button"
                    disabled={Boolean(busy)}
                    onClick={() => void review(member, "approved")}
                    type="button"
                  >
                    <Check size={16} />
                    Approve
                  </button>
                ) : null}
                {member.status !== "rejected" ? (
                  <button
                    className="feature-button feature-button--danger"
                    disabled={Boolean(busy)}
                    onClick={() => void review(member, "rejected")}
                    type="button"
                  >
                    <X size={16} />
                    {member.status === "approved" ? "Remove access" : "Decline"}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="feature-empty">
          {filter === "pending"
            ? "No requests waiting. New accounts will appear here."
            : "No accounts in this list."}
        </p>
      )}
      <nav className="member-review__pagination" aria-label="Account pages">
        <button
          className="feature-button"
          disabled={loading || Boolean(busy) || page === 0}
          type="button"
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          className="feature-button"
          disabled={loading || Boolean(busy) || !hasMore}
          type="button"
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </nav>
    </section>
  );
}
