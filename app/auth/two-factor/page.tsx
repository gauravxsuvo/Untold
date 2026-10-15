import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TwoFactorScreen } from "@/components/auth/two-factor-screen";
import { getServerSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Verify your sign-in | Untold",
  robots: { index: false, follow: false },
};

export default async function TwoFactorPage() {
  if ((await getServerSession()).status === "signed-in") redirect("/app/inbox");
  return <TwoFactorScreen />;
}
