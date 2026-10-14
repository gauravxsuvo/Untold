import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const baseUrl = process.env.UNTOLD_LOCAL_URL ?? "http://localhost:3000";

if (!databaseUrl) throw new Error("Set DATABASE_URL to the local Portways bridge URL first.");

const databaseAddress = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(databaseAddress.hostname)) {
  throw new Error("Backend smoke checks only run through the local Portways bridge on loopback.");
}

const appAddress = new URL(baseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(appAddress.hostname)) {
  throw new Error("UNTOLD_LOCAL_URL must point to a local Untold instance.");
}

const expectedTables = [
  ["untold_auth", "user"],
  ["untold_auth", "session"],
  ["untold_auth", "account"],
  ["untold_auth", "verification"],
  ["untold_auth", "rate_limit"],
  ["untold_app", "conversation"],
  ["untold_app", "conversation_member"],
  ["untold_app", "message_envelope"],
  ["untold_app", "rate_limit"],
];

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const result = await pool.query(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema IN ('untold_auth', 'untold_app') AND table_type = 'BASE TABLE'`,
  );
  const foundTables = new Set(result.rows.map((row) => `${row.table_schema}.${row.table_name}`));
  for (const [schema, table] of expectedTables) {
    assert.ok(foundTables.has(`${schema}.${table}`), `Missing ${schema}.${table}; run npm run db:migrate.`);
  }

  const indexResult = await pool.query(
    `SELECT indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = 'untold_app' AND indexname IN (
       'untold_conversation_member_user_id_idx',
       'untold_message_conversation_created_idx'
     )`,
  );
  const indexDefinitions = new Map(indexResult.rows.map((row) => [row.indexname, row.indexdef]));
  assert.match(indexDefinitions.get("untold_conversation_member_user_id_idx") ?? "", /CREATE INDEX/i);
  assert.match(indexDefinitions.get("untold_message_conversation_created_idx") ?? "", /CREATE INDEX/i);

  const sessionResponse = await fetch(new URL("/api/auth/get-session", appAddress), {
    headers: { Cookie: "better-auth.session_token=invalid-smoke-test-token" },
  });
  assert.equal(sessionResponse.status, 200, "Better Auth session endpoint should respond successfully.");
  assert.match(sessionResponse.headers.get("content-type") ?? "", /application\/json/i);

  const tokenResponse = await fetch(new URL("/api/realtime/token", appAddress), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationIds: ["00000000-0000-4000-8000-000000000000"] }),
  });
  assert.equal(tokenResponse.status, 401, "Realtime token route must reject requests without a session.");

  process.stdout.write("Backend smoke checks passed: schema, Better Auth, and unauthenticated realtime gate.\n");
} finally {
  await pool.end();
}
