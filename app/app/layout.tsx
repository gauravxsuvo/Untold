import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplicationShell } from "@/components/app/application-shell";
import { StatePanel } from "@/components/app/state-panel";
import { getServerSession } from "@/lib/auth/session";
import { MessagingDeviceProvider } from "@/components/messaging/messaging-device-provider";

export const metadata: Metadata = {
  title: "Your conversations | Untold",
  description: "Your Untold conversations.",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (session.status === "signed-out") redirect("/auth/sign-in");

  return (
    <MessagingDeviceProvider>
      <ApplicationShell>
        {session.status === "unavailable" ? (
          <div className="app-page">
            <StatePanel
              description="We can’t load your account right now. Please try again in a moment."
              kind="unavailable"
              title="Untold is temporarily unavailable."
            />
          </div>
        ) : (
          children
        )}
      </ApplicationShell>
    </MessagingDeviceProvider>
  );
}
