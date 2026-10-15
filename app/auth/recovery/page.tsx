import type { Metadata } from "next";
import { RecoveryOverview } from "@/components/auth/recovery-overview";

export const metadata: Metadata = {
  title: "Help with signing in | Untold",
  description: "Help with signing in to Untold and keeping access to your conversations.",
};

export default function RecoveryPage() {
  return <RecoveryOverview />;
}
