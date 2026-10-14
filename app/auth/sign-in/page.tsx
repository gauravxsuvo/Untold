import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = {
  title: "Sign in preview — Untold",
  description: "Explore the Untold sign-in interface. No account provider is connected.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  return <AuthScreen mode="sign-in" signedOut={params.status === "signed-out"} />;
}
