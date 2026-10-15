import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { getServerSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Sign in | Untold",
  description: "Sign in to your Untold account.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  if ((await getServerSession()).status === "signed-in") redirect("/app/inbox");

  return <AuthScreen mode="sign-in" signedOut={params.status === "signed-out"} />;
}
