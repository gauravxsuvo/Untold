export type AccountIdentity = Readonly<{
  userId: string;
  deviceId: string;
  agreementKey: string;
  signingKey: string;
}>;

export type DeviceApproval = Readonly<{
  kind: "untold-device-approval";
  version: 1;
  identity: AccountIdentity;
  deviceId: string;
  agreementKey: string;
  signingKey: string;
  issuerDeviceId: string;
  requestHash: string;
  issuedAt: number;
  signature: string;
}>;

export type ContactVerification = Readonly<{
  kind: "untold-account-verification";
  version: 1;
  owner: AccountIdentity;
  contact: AccountIdentity;
  verifierDeviceId: string;
  verifiedAt: number;
  signature: string;
}>;

export type SealedApproval = Readonly<{ nonce: string; ciphertext: string }>;

export type DeviceRemoval = Readonly<{
  kind: "untold-device-removal";
  identity: AccountIdentity;
  deviceId: string;
  issuerDeviceId: string;
  issuedAt: number;
  signature: string;
}>;
