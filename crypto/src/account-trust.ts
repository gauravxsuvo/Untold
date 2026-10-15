import type {
  AccountIdentity,
  ContactVerification,
  DeviceApproval,
  DeviceRemoval,
  SealedApproval,
} from "./account-types";
import {
  hasLegacyDeviceTrust,
  readCryptoRecord,
  updateCryptoRecord,
  verifyDeviceFingerprint,
  type DeviceTrust,
  type LocalDevice,
  type PublicDevice,
} from "./protocol";

export type {
  AccountIdentity,
  ContactVerification,
  DeviceApproval,
  SealedApproval,
} from "./account-types";
const encoder = new TextEncoder();
const keyPattern = /^[A-Za-z0-9_-]{80,256}$/;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 65536)
    throw new Error("Invalid security data");
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
}
function canonicalIdentity(identity: AccountIdentity) {
  return {
    userId: identity.userId,
    deviceId: identity.deviceId,
    agreementKey: identity.agreementKey,
    signingKey: identity.signingKey,
  };
}
export function validAccountIdentity(value: unknown): value is AccountIdentity {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.userId === "string" &&
    item.userId.length > 0 &&
    item.userId.length <= 256 &&
    typeof item.deviceId === "string" &&
    idPattern.test(item.deviceId) &&
    typeof item.agreementKey === "string" &&
    keyPattern.test(item.agreementKey) &&
    typeof item.signingKey === "string" &&
    keyPattern.test(item.signingKey)
  );
}
export function sameAccountIdentity(
  first?: AccountIdentity | null,
  second?: AccountIdentity | null,
): boolean {
  return Boolean(
    first &&
      second &&
      JSON.stringify(canonicalIdentity(first)) === JSON.stringify(canonicalIdentity(second)),
  );
}
function approvalBody(item: DeviceApproval) {
  return {
    kind: item.kind,
    version: item.version,
    identity: canonicalIdentity(item.identity),
    deviceId: item.deviceId,
    agreementKey: item.agreementKey,
    signingKey: item.signingKey,
    issuerDeviceId: item.issuerDeviceId,
    requestHash: item.requestHash,
    issuedAt: item.issuedAt,
  };
}
function verificationBody(item: ContactVerification) {
  return {
    kind: item.kind,
    version: item.version,
    owner: canonicalIdentity(item.owner),
    contact: canonicalIdentity(item.contact),
    verifierDeviceId: item.verifierDeviceId,
    verifiedAt: item.verifiedAt,
  };
}
export function validDeviceApproval(value: unknown): value is DeviceApproval {
  if (!value || typeof value !== "object") return false;
  const item = value as DeviceApproval;
  return (
    item.kind === "untold-device-approval" &&
    item.version === 1 &&
    validAccountIdentity(item.identity) &&
    typeof item.deviceId === "string" &&
    idPattern.test(item.deviceId) &&
    typeof item.issuerDeviceId === "string" &&
    idPattern.test(item.issuerDeviceId) &&
    typeof item.agreementKey === "string" &&
    keyPattern.test(item.agreementKey) &&
    typeof item.signingKey === "string" &&
    keyPattern.test(item.signingKey) &&
    typeof item.requestHash === "string" &&
    /^[a-f0-9]{64}$/.test(item.requestHash) &&
    Number.isSafeInteger(item.issuedAt) &&
    item.issuedAt > 0 &&
    typeof item.signature === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(item.signature)
  );
}
export function validContactVerification(value: unknown): value is ContactVerification {
  if (!value || typeof value !== "object") return false;
  const item = value as ContactVerification;
  return (
    item.kind === "untold-account-verification" &&
    item.version === 1 &&
    validAccountIdentity(item.owner) &&
    validAccountIdentity(item.contact) &&
    item.owner.userId !== item.contact.userId &&
    typeof item.verifierDeviceId === "string" &&
    idPattern.test(item.verifierDeviceId) &&
    Number.isSafeInteger(item.verifiedAt) &&
    item.verifiedAt > 0 &&
    typeof item.signature === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(item.signature)
  );
}
async function sign(body: object, local: LocalDevice): Promise<string> {
  return encode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        local.signingPrivateKey,
        encoder.encode(JSON.stringify(body)),
      ),
    ),
  );
}
async function verify(body: object, signature: string, signingKey: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      decode(signingKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      decode(signature),
      encoder.encode(JSON.stringify(body)),
    );
  } catch {
    return false;
  }
}
export async function accountDeviceAuthorized(
  device: PublicDevice,
  directory: readonly PublicDevice[],
  visited = new Set<string>(),
): Promise<boolean> {
  const root = device.accountIdentity;
  if (!root || root.userId !== device.userId || visited.has(device.deviceId) || visited.size >= 64)
    return false;
  if (device.deviceId === root.deviceId)
    return device.agreementKey === root.agreementKey && device.signingKey === root.signingKey;
  const approval = device.approval;
  if (
    !validDeviceApproval(approval) ||
    !sameAccountIdentity(root, approval.identity) ||
    approval.deviceId !== device.deviceId ||
    approval.agreementKey !== device.agreementKey ||
    approval.signingKey !== device.signingKey
  )
    return false;
  const issuer = directory.find(
    (item) => item.userId === device.userId && item.deviceId === approval.issuerDeviceId,
  );
  if (!issuer || !sameAccountIdentity(issuer.accountIdentity, root)) return false;
  visited.add(device.deviceId);
  // A historical issuer may be removed. Its old signatures remain valid; the API
  // refuses new approvals or attestations from a removed device.
  return (
    (await accountDeviceAuthorized(issuer, directory, visited)) &&
    (await verify(approvalBody(approval), approval.signature, issuer.signingKey))
  );
}
export async function accountPairCode(
  first: AccountIdentity,
  second: AccountIdentity,
): Promise<string> {
  const participants = [first, second]
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map(canonicalIdentity);
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(JSON.stringify({ kind: "untold-account-pair", version: 1, participants })),
    ),
  );
  return (
    [...digest]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
      .match(/.{4}/g)
      ?.join(" ") ?? ""
  );
}
export async function pinnedAccountRoot(accountId: string): Promise<AccountIdentity | null> {
  return (
    (await readCryptoRecord<{ id: string; identity: AccountIdentity }>("account-roots", accountId))
      ?.identity ?? null
  );
}
export async function pinAccountRoot(
  accountId: string,
  identity: AccountIdentity,
  replace = false,
) {
  if (identity.userId !== accountId || !validAccountIdentity(identity))
    throw new Error("Invalid account identity");
  await updateCryptoRecord<{ id: string; identity: AccountIdentity }>(
    "account-roots",
    accountId,
    (saved) => {
      if (saved && !replace && !sameAccountIdentity(saved.identity, identity))
        throw new Error(
          "Your account safety identity changed. Open Settings to recover this device.",
        );
      return { id: accountId, identity };
    },
  );
}
export type LinkSecret = { id: string; deviceId: string; secret: string; requestHash: string };
export async function linkCommitment(
  local: Pick<LocalDevice, "accountId" | "deviceId" | "agreementKey" | "signingKey">,
  secret: string,
): Promise<string> {
  if (!/^[a-f0-9]{32}$/.test(secret)) throw new Error("Invalid linking code");
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(
        JSON.stringify({
          kind: "untold-device-link",
          userId: local.accountId,
          deviceId: local.deviceId,
          agreementKey: local.agreementKey,
          signingKey: local.signingKey,
          secret,
        }),
      ),
    ),
  );
  return [...digest].map((n) => n.toString(16).padStart(2, "0")).join("");
}
export async function deviceLinkSecret(local: LocalDevice): Promise<LinkSecret> {
  const saved = await readCryptoRecord<LinkSecret>("account-links", local.accountId);
  if (saved?.deviceId === local.deviceId) return saved;
  const secret = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const item = {
    id: local.accountId,
    deviceId: local.deviceId,
    secret,
    requestHash: await linkCommitment(local, secret),
  };
  return updateCryptoRecord<LinkSecret>("account-links", local.accountId, (current) =>
    current?.deviceId === local.deviceId ? current : item,
  );
}
async function linkKey(secret: string) {
  const bytes = Uint8Array.from(secret.match(/.{2}/g) ?? [], (n) => Number.parseInt(n, 16));
  if (bytes.length !== 16) throw new Error("Invalid linking code");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function createDeviceApproval(
  local: LocalDevice,
  target: PublicDevice,
  directory: PublicDevice[],
  rawSecret: string,
): Promise<{ approval: DeviceApproval; sealed: SealedApproval }> {
  const secret = rawSecret.replace(/[\s-]/g, "").toLowerCase();
  const root = await pinnedAccountRoot(local.accountId);
  const issuer = directory.find(
    (d) => d.deviceId === local.deviceId && d.userId === local.accountId && !d.revoked,
  );
  if (
    !root ||
    !issuer ||
    !sameAccountIdentity(root, target.accountIdentity) ||
    !(await accountDeviceAuthorized(issuer, directory)) ||
    issuer.agreementKey !== local.agreementKey ||
    issuer.signingKey !== local.signingKey ||
    target.revoked ||
    target.userId !== local.accountId ||
    target.deviceId === local.deviceId ||
    !target.linkExpiresAt ||
    Date.parse(target.linkExpiresAt) <= Date.now() ||
    (await linkCommitment({ accountId: target.userId, ...target }, secret)) !== target.linkHash
  )
    throw new Error(
      "The linking code doesn’t match this device. Check the code on your new device and try again.",
    );
  const unsigned = {
    kind: "untold-device-approval" as const,
    version: 1 as const,
    identity: root,
    deviceId: target.deviceId,
    agreementKey: target.agreementKey,
    signingKey: target.signingKey,
    issuerDeviceId: local.deviceId,
    requestHash: target.linkHash as string,
    issuedAt: Date.now(),
    signature: "",
  };
  const approval: DeviceApproval = {
    ...unsigned,
    signature: await sign(approvalBody(unsigned), local),
  };
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: encoder.encode(`${local.accountId}:${target.deviceId}:${target.linkHash}`),
    },
    await linkKey(secret),
    encoder.encode(JSON.stringify({ identity: root, approval })),
  );
  return {
    approval,
    sealed: { nonce: encode(nonce), ciphertext: encode(new Uint8Array(ciphertext)) },
  };
}
export async function acceptDeviceApproval(
  local: LocalDevice,
  identity: AccountIdentity,
  approval: DeviceApproval,
  sealed: SealedApproval,
  directory: PublicDevice[],
) {
  const link = await deviceLinkSecret(local);
  const clear = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(sealed.nonce),
        additionalData: encoder.encode(`${local.accountId}:${local.deviceId}:${link.requestHash}`),
      },
      await linkKey(link.secret),
      decode(sealed.ciphertext),
    ),
  );
  try {
    const bundle = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(clear));
    const target = directory.find(
      (d) => d.deviceId === local.deviceId && d.userId === local.accountId && !d.revoked,
    );
    if (
      !validDeviceApproval(bundle.approval) ||
      !sameAccountIdentity(identity, bundle.identity) ||
      JSON.stringify(approvalBody(bundle.approval)) !== JSON.stringify(approvalBody(approval)) ||
      bundle.approval.signature !== approval.signature ||
      !target ||
      target.agreementKey !== local.agreementKey ||
      target.signingKey !== local.signingKey ||
      !(await accountDeviceAuthorized(target, directory))
    )
      throw new Error("Invalid device approval");
    await pinAccountRoot(local.accountId, identity);
  } finally {
    clear.fill(0);
  }
}
export async function createContactVerification(
  local: LocalDevice,
  contact: AccountIdentity,
): Promise<ContactVerification> {
  const owner = await pinnedAccountRoot(local.accountId);
  if (!owner || owner.userId === contact.userId)
    throw new Error("Approve this device before verifying a contact.");
  const unsigned: ContactVerification = {
    kind: "untold-account-verification",
    version: 1,
    owner,
    contact,
    verifierDeviceId: local.deviceId,
    verifiedAt: Date.now(),
    signature: "",
  };
  return { ...unsigned, signature: await sign(verificationBody(unsigned), local) };
}
export async function checkContactVerification(
  proof: ContactVerification,
  owner: AccountIdentity,
  directory: readonly PublicDevice[],
): Promise<boolean> {
  if (!validContactVerification(proof) || !sameAccountIdentity(proof.owner, owner)) return false;
  const issuer = directory.find(
    (d) => d.userId === owner.userId && d.deviceId === proof.verifierDeviceId,
  );
  return Boolean(
    issuer &&
      (await accountDeviceAuthorized(issuer, directory)) &&
      (await verify(verificationBody(proof), proof.signature, issuer.signingKey)),
  );
}
export async function saveContactVerification(
  proof: ContactVerification,
  directory: PublicDevice[],
  replace = false,
) {
  const owner = await pinnedAccountRoot(proof.owner.userId);
  if (!owner || !(await checkContactVerification(proof, owner, directory)))
    throw new Error("Invalid contact verification");
  const id = `${owner.userId}\0${proof.contact.userId}`;
  await updateCryptoRecord<{ id: string; proof: ContactVerification }>(
    "verified-accounts",
    id,
    (saved) => {
      if (
        !replace &&
        saved &&
        sameAccountIdentity(saved.proof.owner, owner) &&
        (proof.verifiedAt < saved.proof.verifiedAt ||
          (proof.verifiedAt === saved.proof.verifiedAt &&
            !sameAccountIdentity(saved.proof.contact, proof.contact)))
      )
        return saved;
      return { id, proof };
    },
  );
}
export async function classifyAccountDevices(
  accountId: string,
  directory: readonly PublicDevice[],
): Promise<DeviceTrust[]> {
  const ownRoot = await pinnedAccountRoot(accountId);
  const cached = new Map<string, ContactVerification | null>();
  for (const device of directory) {
    if (device.userId !== accountId && !cached.has(device.userId)) {
      const saved = await readCryptoRecord<{ proof: ContactVerification }>(
        "verified-accounts",
        `${accountId}\0${device.userId}`,
      );
      cached.set(
        device.userId,
        saved &&
          sameAccountIdentity(saved.proof.owner, ownRoot) &&
          (await checkContactVerification(saved.proof, ownRoot as AccountIdentity, directory))
          ? saved.proof
          : null,
      );
    }
  }
  return Promise.all(
    directory.map(async (device) => {
      const approved = await accountDeviceAuthorized(device, directory);
      const identity = device.accountIdentity;
      let trust: DeviceTrust["trust"] = "new";
      if (device.userId === accountId) {
        trust =
          ownRoot && identity && !sameAccountIdentity(ownRoot, identity)
            ? "changed"
            : approved && sameAccountIdentity(ownRoot, identity)
              ? "verified"
              : "new";
      } else {
        const proof = cached.get(device.userId);
        trust =
          proof && !sameAccountIdentity(proof.contact, identity)
            ? "changed"
            : proof && approved
              ? "verified"
              : "new";
      }
      if (approved && trust === "verified") {
        await verifyDeviceFingerprint(accountId, device);
      } else if (device.revoked && (await hasLegacyDeviceTrust(accountId, device))) {
        // Keep authentic historical messages readable after a device is removed.
        trust = "verified";
      }
      return { ...device, approved, trust };
    }),
  );
}
export async function legacyAccountVerified(
  accountId: string,
  identity: AccountIdentity,
): Promise<boolean> {
  return hasLegacyDeviceTrust(accountId, {
    ...identity,
    userName: "",
    deviceName: "",
    revoked: false,
  });
}

function removalBody(value: DeviceRemoval) {
  return {
    kind: value.kind,
    identity: canonicalIdentity(value.identity),
    deviceId: value.deviceId,
    issuerDeviceId: value.issuerDeviceId,
    issuedAt: value.issuedAt,
  };
}
export async function createDeviceRemoval(
  local: LocalDevice,
  deviceId: string,
): Promise<DeviceRemoval> {
  const identity = await pinnedAccountRoot(local.accountId);
  if (!identity) throw new Error("Approve this device first.");
  const body: DeviceRemoval = {
    kind: "untold-device-removal",
    identity,
    deviceId,
    issuerDeviceId: local.deviceId,
    issuedAt: Date.now(),
    signature: "",
  };
  return { ...body, signature: await sign(removalBody(body), local) };
}
export async function checkDeviceRemoval(
  value: unknown,
  directory: PublicDevice[],
): Promise<boolean> {
  if (!value || typeof value !== "object") return false;
  const body = value as DeviceRemoval;
  if (
    body.kind !== "untold-device-removal" ||
    !validAccountIdentity(body.identity) ||
    typeof body.deviceId !== "string" ||
    !idPattern.test(body.deviceId) ||
    typeof body.issuerDeviceId !== "string" ||
    !idPattern.test(body.issuerDeviceId) ||
    body.issuerDeviceId === body.deviceId ||
    !Number.isSafeInteger(body.issuedAt) ||
    Math.abs(Date.now() - body.issuedAt) > 120_000 ||
    typeof body.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/.test(body.signature)
  )
    return false;
  const issuer = directory.find(
    (d) =>
      d.deviceId === body.issuerDeviceId &&
      !d.revoked &&
      d.userId === body.identity.userId &&
      sameAccountIdentity(d.accountIdentity, body.identity),
  );
  return Boolean(
    issuer &&
      (await accountDeviceAuthorized(issuer, directory)) &&
      (await verify(removalBody(body), body.signature, issuer.signingKey)),
  );
}
