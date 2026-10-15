import { and, eq, sql } from "drizzle-orm";
import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedSession,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { getDatabase } from "@/lib/server/database";
import {
  accountIdentities,
  authSession,
  authUser,
  contactVerifications,
  devices,
} from "@/lib/server/schema";
import { accountDeviceDirectory } from "@/lib/server/device-trust";
import {
  accountDeviceAuthorized,
  checkContactVerification,
  sameAccountIdentity,
  validContactVerification,
  validDeviceApproval,
} from "@/crypto/src/account-trust";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const { db } = getDatabase();
    const userId = session.user.id;
    const [identity] = await db
      .select()
      .from(accountIdentities)
      .where(eq(accountIdentities.userId, userId));
    const directory = await accountDeviceDirectory([userId]);
    const proofs = await db
      .select({ proof: contactVerifications.proof })
      .from(contactVerifications)
      .where(eq(contactVerifications.ownerId, userId));
    const contacts = await db.execute<import("@/crypto/src/account-types").AccountIdentity>(sql`
      SELECT ai.user_id AS "userId", ai.device_id AS "deviceId", ai.agreement_key AS "agreementKey", ai.signing_key AS "signingKey"
      FROM untold_app.account_identity ai
      WHERE ai.user_id <> ${userId} AND EXISTS (
        SELECT 1 FROM untold_app.conversation_member own
        JOIN untold_app.conversation_member peer ON peer.conversation_id = own.conversation_id
        JOIN untold_app.conversation c ON c.id = own.conversation_id
        WHERE own.user_id = ${userId} AND peer.user_id = ai.user_id AND own.left_at IS NULL AND peer.left_at IS NULL
          AND (c.group_name IS NOT NULL OR c.created_by = ${userId} OR own.initiated_at IS NOT NULL OR EXISTS (
            SELECT 1 FROM untold_app.message_envelope m WHERE m.conversation_id = c.id
          ))
      )
    `);
    const deviceId = new URL(request.url).searchParams.get("device");
    const [device] =
      deviceId && /^[a-f0-9-]{36}$/i.test(deviceId)
        ? await db
            .select({ sealed: devices.approvalResponse })
            .from(devices)
            .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
            .limit(1)
        : [];
    return Response.json(
      {
        identity: identity ?? null,
        devices: directory,
        contacts: contacts.rows,
        verifications: proofs.map((row) => row.proof),
        sealedApproval: device?.sealed ?? null,
      },
      { headers: noStore },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const parsed = await readJsonBody(request, 16 * 1024);
    if (!parsed.ok || !parsed.body || typeof parsed.body !== "object")
      return Response.json({ message: "Check the device details and try again." }, { status: 400 });
    const body = parsed.body as Record<string, unknown>;
    const { db } = getDatabase();
    const budget = await consumeRateLimit(db, `device-security:${session.user.id}`, {
      max: 120,
      windowSeconds: 600,
    });
    if (!budget.allowed) return rateLimitedResponse(budget.retryAfterSeconds);
    const success = await db.transaction(async (tx) => {
      await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.id, session.user.id))
        .for("update");
      const [live] = await tx
        .select({ id: authSession.id })
        .from(authSession)
        .where(
          and(
            eq(authSession.id, session.session.id),
            eq(authSession.userId, session.user.id),
            sql`${authSession.expiresAt} > now()`,
          ),
        )
        .for("update");
      if (!live) return false;
      const [identity] = await tx
        .select()
        .from(accountIdentities)
        .where(eq(accountIdentities.userId, session.user.id));
      if (!identity) return false;
      const directory = await accountDeviceDirectory([session.user.id], tx);
      if (body.action === "approve" && validDeviceApproval(body.approval)) {
        const approval = body.approval;
        const sealed = body.sealed as { nonce?: unknown; ciphertext?: unknown } | null;
        if (
          !sealed ||
          typeof sealed.nonce !== "string" ||
          !/^[A-Za-z0-9_-]{16}$/.test(sealed.nonce) ||
          typeof sealed.ciphertext !== "string" ||
          !/^[A-Za-z0-9_-]{100,8192}$/.test(sealed.ciphertext) ||
          !sameAccountIdentity(identity, approval.identity) ||
          Math.abs(Date.now() - approval.issuedAt) > 120_000
        )
          return false;
        const target = directory.find((d) => d.deviceId === approval.deviceId && !d.revoked);
        const issuer = directory.find(
          (d) => d.deviceId === approval.issuerDeviceId && !d.revoked && d.approved,
        );
        if (
          !target ||
          !issuer ||
          target.deviceId === issuer.deviceId ||
          target.approved ||
          target.linkHash !== approval.requestHash ||
          !target.linkExpiresAt ||
          Date.parse(target.linkExpiresAt) < Date.now() ||
          !(await accountDeviceAuthorized({ ...target, approval }, directory))
        )
          return false;
        await tx
          .update(devices)
          .set({
            approval,
            approvalResponse: { nonce: sealed.nonce, ciphertext: sealed.ciphertext },
            linkExpiresAt: null,
          })
          .where(and(eq(devices.id, target.deviceId), eq(devices.userId, session.user.id)));
        return true;
      }
      if (body.action === "verify" && validContactVerification(body.proof)) {
        const proof = body.proof;
        const issuer = directory.find(
          (d) => d.deviceId === proof.verifierDeviceId && !d.revoked && d.approved,
        );
        const [contact] = await tx
          .select()
          .from(accountIdentities)
          .where(eq(accountIdentities.userId, proof.contact.userId));
        if (
          !issuer ||
          !sameAccountIdentity(proof.contact, contact) ||
          Math.abs(Date.now() - proof.verifiedAt) > 120_000 ||
          !(await checkContactVerification(proof, identity, directory))
        )
          return false;
        await tx
          .insert(contactVerifications)
          .values({ ownerId: session.user.id, contactId: proof.contact.userId, proof })
          .onConflictDoUpdate({
            target: [contactVerifications.ownerId, contactVerifications.contactId],
            set: { proof },
          });
        return true;
      }
      return false;
    });
    return success
      ? Response.json({ status: true }, { headers: noStore })
      : Response.json(
          { message: "This approval couldn’t be completed. Refresh both devices and try again." },
          { status: 409, headers: noStore },
        );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
