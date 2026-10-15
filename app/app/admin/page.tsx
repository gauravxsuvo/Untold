import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { accountAccess } from "@/lib/server/membership";
import { PageHeading } from "@/components/app/page-heading";
import { MemberReview } from "@/components/auth/member-review";
export default async function AdminPage() {
  const session = await getServerSession();
  if (session.status !== "signed-in" || !(await accountAccess(session.user)).admin)
    redirect("/app/settings");
  return (
    <div className="app-page">
      <PageHeading
        eyebrow="Private membership"
        title="Account requests"
        description="Choose who can join your space."
      />
      <MemberReview />
    </div>
  );
}
