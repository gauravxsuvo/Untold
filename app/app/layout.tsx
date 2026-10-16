import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplicationShell } from "@/components/app/application-shell";
import { StatePanel } from "@/components/app/state-panel";
import { getServerSession } from "@/lib/auth/session";
import { MessagingDeviceProvider } from "@/components/messaging/messaging-device-provider";
import { accountAccess } from "@/lib/server/membership";
import { MembershipAccess } from "@/components/auth/membership-access";
import { CallProvider } from "@/components/messaging/call-provider";
import { GroupCallProvider } from "@/components/messaging/group-call-provider";
import { CallDevicesProvider } from "@/components/messaging/call-devices";
import { CallHistoryProvider } from "@/components/messaging/call-history-provider";

export const metadata: Metadata = {
  title: "Your conversations | Untold",
  description: "Your Untold conversations.",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (session.status === "signed-out") redirect("/auth/sign-in");
  if (session.status === "signed-in" && (await accountAccess(session.user)).status !== "approved")
    redirect("/access");

  return (
    <MessagingDeviceProvider>
      <CallDevicesProvider>
        <GroupCallProvider>
          <CallProvider>
            <CallHistoryProvider>
              <ApplicationShell>
                <MembershipAccess />
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
            </CallHistoryProvider>
          </CallProvider>
        </GroupCallProvider>
      </CallDevicesProvider>
    </MessagingDeviceProvider>
  );
}
