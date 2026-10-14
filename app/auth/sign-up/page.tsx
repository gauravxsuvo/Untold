import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { getServerSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Create an account — Untold",
  description: "Create an Untold account.",
};

export default async function SignUpPage() {
  if ((await getServerSession()).status === "signed-in") redirect("/app/inbox");

  return <AuthScreen mode="sign-up" />;
}
