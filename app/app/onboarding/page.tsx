import type { Metadata } from "next";
import { OnboardingPreview } from "@/components/auth/onboarding-preview";

export const metadata: Metadata = {
  title: "Getting started preview — Untold",
  description: "Learn about account identity, privacy, and future contact verification.",
};

export default function OnboardingPage() {
  return <OnboardingPreview />;
}
