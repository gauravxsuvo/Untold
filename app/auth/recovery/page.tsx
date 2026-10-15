import type { Metadata } from "next";
import { RecoveryOverview } from "@/components/auth/recovery-overview";

export const metadata: Metadata = {
  title: "Reset your password | Untold",
  robots: { index: false, follow: false },
  description: "Help with signing in to Untold and keeping access to your conversations.",
};

export default function RecoveryPage() {
  return <RecoveryOverview />;
}
