import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/server/database";
import { accountIdentities, authUser, devices } from "@/lib/server/schema";
import { accountDeviceAuthorized } from "@/crypto/src/account-trust";
import type { PublicDevice } from "@/crypto/src/protocol";

type Reader = Pick<ReturnType<typeof getDatabase>["db"], "select">;
export async function accountDeviceDirectory(
  userIds: string[],
  reader?: Reader,
): Promise<PublicDevice[]> {
  if (!userIds.length) return [];
  const db = reader ?? getDatabase().db;
  const rows = await db
    .select({
      userId: devices.userId,
      userName: authUser.name,
      deviceId: devices.id,
      deviceName: devices.name,
      agreementKey: devices.agreementKey,
      signingKey: devices.signingKey,
      revokedAt: devices.revokedAt,
      approval: devices.approval,
      linkHash: devices.linkHash,
      linkExpiresAt: devices.linkExpiresAt,
      identity: accountIdentities,
    })
    .from(devices)
    .innerJoin(authUser, eq(authUser.id, devices.userId))
    .innerJoin(accountIdentities, eq(accountIdentities.userId, devices.userId))
    .where(inArray(devices.userId, userIds))
    .orderBy(devices.createdAt, devices.id);
  const directory: PublicDevice[] = rows.map(({ revokedAt, identity, linkExpiresAt, ...row }) => ({
    ...row,
    revoked: revokedAt !== null,
    accountIdentity: identity,
    linkExpiresAt: linkExpiresAt?.toISOString() ?? null,
  }));
  return Promise.all(
    directory.map(async (device) => ({
      ...device,
      approved: await accountDeviceAuthorized(device, directory),
    })),
  );
}
