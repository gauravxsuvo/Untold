import "server-only";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/server/database";
import { memberships } from "@/lib/server/schema";

export class MembershipRequiredError extends Error {}

export async function accountAccess(user: { id: string; email: string }) {
  const { db } = getDatabase();
  let [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);
  if (!membership) {
    await db.insert(memberships).values({ userId: user.id }).onConflictDoNothing();
    [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .limit(1);
  }
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const pinnedId = process.env.ADMIN_USER_ID?.trim();
  // Email alone cannot promote a fresh, unapproved signup to administrator.
  // Existing approved owners can use ADMIN_EMAIL alone; a fresh installation
  // must also pin ADMIN_USER_ID using the account ID shown on its waiting page.
  const admin = Boolean(
    email &&
      user.email.toLowerCase() === email &&
      (pinnedId ? pinnedId === user.id : membership?.status === "approved"),
  );
  if (admin && membership?.status !== "approved") {
    await db
      .update(memberships)
      .set({ status: "approved", reviewedAt: new Date() })
      .where(eq(memberships.userId, user.id));
  }
  return { admin, status: admin ? "approved" : (membership?.status ?? "pending") };
}

export async function requireMembership(user: { id: string; email: string }) {
  const access = await accountAccess(user);
  if (access.status !== "approved") throw new MembershipRequiredError();
  return access;
}
