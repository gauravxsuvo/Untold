import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const authSchema = pgSchema("untold_auth");
export const appSchema = pgSchema("untold_app");

export const authUser = authSchema.table(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("untold_auth_user_email_unique").on(table.email)],
);

export const authSession = authSchema.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("untold_auth_session_token_unique").on(table.token),
    index("untold_auth_session_user_id_idx").on(table.userId),
  ],
);

export const authTwoFactor = authSchema.table(
  "two_factor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").notNull().default(false),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (table) => [uniqueIndex("untold_auth_two_factor_user_unique").on(table.userId)],
);

// Short-lived fingerprints prevent a code used for a sensitive action being reused.
export const authUsedTotp = authSchema.table(
  "used_totp",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.fingerprint] })],
);

export const authAccount = authSchema.table(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("untold_auth_account_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
    index("untold_auth_account_user_id_idx").on(table.userId),
  ],
);

export const authVerification = authSchema.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("untold_auth_verification_identifier_idx").on(table.identifier)],
);

export const authRateLimit = authSchema.table(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("untold_auth_rate_limit_key_unique").on(table.key)],
);

export const pushKeys = appSchema.table("push_keys", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
});

export const pushSubscriptions = appSchema.table(
  "push_subscription",
  {
    endpointHash: text("endpoint_hash").primaryKey(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => authSession.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("untold_push_subscription_user_idx").on(table.userId)],
);

export const pushOutbox = appSchema.table(
  "push_outbox",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => messageEnvelopes.id, { onDelete: "cascade" }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("untold_push_outbox_due_idx").on(table.nextAttemptAt)],
);

export const pushDeliveries = appSchema.table(
  "push_delivery",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => pushOutbox.messageId, { onDelete: "cascade" }),
    endpointHash: text("endpoint_hash").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.endpointHash] })],
);

export const conversations = appSchema.table(
  "conversation",
  {
    id: uuid("id").primaryKey(),
    createdBy: text("created_by")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    directKey: text("direct_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("untold_conversation_direct_key_unique").on(table.directKey)],
);

export const appRateLimits = appSchema.table("rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStartedAt: bigint("window_started_at", { mode: "number" }).notNull(),
});

export const conversationMembers = appSchema.table(
  "conversation_member",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    initiatedAt: timestamp("initiated_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.conversationId, table.userId],
      name: "untold_conversation_member_pk",
    }),
    index("untold_conversation_member_user_id_idx").on(table.userId),
  ],
);

export const devices = appSchema.table(
  "device",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    agreementKey: text("agreement_key").notNull(),
    signingKey: text("signing_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("untold_device_user_id_idx").on(table.userId)],
);

export const messageAttachments = appSchema.table(
  "message_attachment",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    ciphertextBytes: integer("ciphertext_bytes").notNull(),
    ciphertextSha256: text("ciphertext_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("untold_message_attachment_object_key_unique").on(table.objectKey),
    index("untold_message_attachment_sender_idx").on(table.senderId),
    index("untold_message_attachment_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => value,
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

export const profilePhotos = appSchema.table("profile_photo", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
  version: uuid("version").notNull(),
  image: bytea("image").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messageEnvelopes = appSchema.table(
  "message_envelope",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    clientMessageId: uuid("client_message_id").notNull(),
    attachmentId: uuid("attachment_id").references(() => messageAttachments.id, {
      onDelete: "restrict",
    }),
    envelope: bytea("envelope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("untold_message_client_id_unique").on(table.senderId, table.clientMessageId),
    uniqueIndex("untold_message_attachment_unique").on(table.attachmentId),
    index("untold_message_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const messageReceipts = appSchema.table(
  "message_receipt",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messageEnvelopes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId], name: "untold_message_receipt_pk" }),
    index("untold_message_receipt_user_idx").on(table.userId),
  ],
);
