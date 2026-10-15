import { LandingPage } from "@/components/landing/landing-page";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await getServerSession();
  if (session.status === "signed-in") redirect("/app/inbox");

  return <LandingPage />;
}
