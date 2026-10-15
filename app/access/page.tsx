import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { accountAccess } from "@/lib/server/membership";
import { MembershipAccess } from "@/components/auth/membership-access";
import { Wordmark } from "@/components/brand/wordmark";
export default async function AccessPage() {
  const session = await getServerSession();
  if (session.status === "signed-out") redirect("/auth/sign-in");
  if (session.status !== "signed-in")
    return (
      <main className="membership-waiting">
        <h1>We couldn’t load your account</h1>
        <p>Please refresh and try again.</p>
      </main>
    );
  const access = await accountAccess(session.user);
  if (access.status === "approved") redirect("/app/inbox");
  const showReference =
    process.env.ADMIN_EMAIL?.trim().toLowerCase() === session.user.email.toLowerCase() &&
    !process.env.ADMIN_USER_ID?.trim();
  return (
    <main className="access-page">
      <Wordmark />
      <MembershipAccess waiting initialStatus={access.status} />
      <details>
        <summary>Account details</summary>
        <p>{session.user.email}</p>
        {showReference ? (
          <p>
            Account reference: <code>{session.user.id}</code>
          </p>
        ) : null}
      </details>
    </main>
  );
}
