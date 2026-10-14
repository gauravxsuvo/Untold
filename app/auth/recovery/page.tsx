import type { Metadata } from "next";
import { RecoveryOverview } from "@/components/auth/recovery-overview";

export const metadata: Metadata = {
  title: "Recovery concepts — Untold",
  description: "Review account recovery approaches and their privacy tradeoffs.",
};

export default function RecoveryPage() {
  return <RecoveryOverview />;
}
