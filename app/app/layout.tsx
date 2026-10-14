import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplicationShell } from "@/components/app/application-shell";
import { StatePanel } from "@/components/app/state-panel";
import { getServerSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Workspace — Untold",
  description: "Your Untold conversations.",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (session.status === "signed-out") redirect("/auth/sign-in");

  return (
    <ApplicationShell>
      {session.status === "unavailable" ? (
        <div className="app-page">
          <StatePanel
            description="The account service is not configured or cannot reach its database. Check the server environment and try again."
            kind="unavailable"
            title="Untold is temporarily unavailable."
          />
        </div>
      ) : (
        children
      )}
    </ApplicationShell>
  );
}
