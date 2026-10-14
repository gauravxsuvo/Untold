import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = {
  title: "Account setup preview — Untold",
  description: "Explore the Untold sign-up interface. No account is created or saved.",
};

export default function SignUpPage() {
  return <AuthScreen mode="sign-up" />;
}
