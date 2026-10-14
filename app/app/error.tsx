"use client";

import { StatePanel } from "@/components/app/state-panel";

export default function AppError({ retry }: { retry: () => void }) {
  return (
    <div className="app-page">
      <StatePanel
        actionHref="/app/inbox"
        actionLabel="Return to inbox"
        description="Try loading this section again. If the problem continues, return to your inbox."
        kind="error"
        title="We couldn’t open this page."
      />
      <button className="app-retry-button" onClick={retry} type="button">
        Try again
      </button>
    </div>
  );
}
