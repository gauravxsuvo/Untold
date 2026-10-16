// Install the isolated tools described in docs/call-reliability-and-history.md.
// Runs the real migrations and server queries in ephemeral PostgreSQL/WASM.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { runMigrations } from "./migrate-core.mjs";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, ".test-build/call-tools/package.json"));
const { PGlite } = require("@electric-sql/pglite");
const { build } = require("esbuild");
const { PgDialect } = createRequire(join(root, "package.json"))("drizzle-orm/pg-core");
await mkdir(join(root, ".test-build"), { recursive: true });
await build({
  entryPoints: [join(root, "lib/server/call-history.ts")],
  outfile: join(root, ".test-build/call-history-server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [
    {
      name: "server-only-test",
      setup(b) {
        b.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "test",
        }));
        b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "" }));
      },
    },
  ],
});
const { historyEntries, listCallHistory, reconcileCallHistory, conversationTimelineKeys } =
  createRequire(import.meta.url)(join(root, ".test-build/call-history-server.cjs"));
const pg = new PGlite();
const dialect = new PgDialect();
const adapter = (client) => ({
  execute(statement) {
    const { sql, params } = dialect.sqlToQuery(statement);
    return client.query(sql, params);
  },
  transaction(work) {
    return client.transaction((tx) => work(adapter(tx)));
  },
});
const db = adapter(pg);
const q = (text, params = []) => pg.query(text, params);
const a = randomUUID(),
  b = randomUUID(),
  group = randomUUID(),
  direct = randomUUID();
const uid = () => randomUUID();
let checks = 0;
try {
  for (const name of (await readdir(join(root, "scripts/migrations")))
    .filter((name) => name.endsWith(".sql") && name < "018")
    .sort()) {
    await pg.exec(await readFile(join(root, "scripts/migrations", name), "utf8"));
  }
  for (const user of ["alice", "bob", "carol", "dave"])
    await q('INSERT INTO untold_auth."user"(id,name,email) VALUES($1,$1,$2)', [
      user,
      `${user}@test.invalid`,
    ]);
  await q(
    "INSERT INTO untold_app.device(id,user_id,name,agreement_key,signing_key) VALUES($1,'alice','A','a','a'),($2,'bob','B','b','b')",
    [a, b],
  );
  await q(
    "INSERT INTO untold_app.conversation(id,created_by,group_name,group_owner_id) VALUES($1,'alice',NULL,NULL),($2,'alice','Test group','alice')",
    [direct, group],
  );
  for (const conversation of [direct, group])
    for (const user of ["alice", "bob"])
      await q("INSERT INTO untold_app.conversation_member(conversation_id,user_id) VALUES($1,$2)", [
        conversation,
        user,
      ]);
  const legacy = uid();
  await q(
    "INSERT INTO untold_app.call(id,conversation_id,caller_id,callee_id,caller_device_id,kind,status,expires_at) VALUES($1,$2,'alice','bob',$3,'voice','ended',now())",
    [legacy, direct, a],
  );
  await pg.exec(await readFile(join(root, "scripts/migrations/018-call-history.sql"), "utf8"));
  assert.equal((await listCallHistory(db, "bob")).calls[0].legacy, true);
  checks++;
  const start = async (expires = "now() + interval '75 seconds'") => {
    const id = uid();
    await q(
      `INSERT INTO untold_app.call(id,conversation_id,caller_id,callee_id,caller_device_id,kind,expires_at) VALUES($1,$2,'alice','bob',$3,'video',${expires})`,
      [id, direct, a],
    );
    return id;
  };
  const ended = await start();
  await q(
    "UPDATE untold_app.call SET status='active',answered_at=now(),callee_device_id=$2,caller_connected_at=now()-interval '5 seconds',callee_connected_at=now()-interval '4 seconds' WHERE id=$1",
    [ended, b],
  );
  await q(
    "UPDATE untold_app.call SET status='ended',end_reason='completed',ended_at=now() WHERE id=$1",
    [ended],
  );
  const row = (await listCallHistory(db, "bob")).calls.find((call) => call.sourceId === ended);
  assert.equal(row.outcome, "completed");
  assert.ok(row.durationSeconds >= 4);
  assert.equal(row.missed, false);
  checks++;
  await q(
    "UPDATE untold_app.call SET status='ended',ended_at=now()+interval '1 hour' WHERE id=$1",
    [ended],
  );
  assert.equal(
    (await listCallHistory(db, "bob")).calls.find((call) => call.sourceId === ended).endedAt,
    row.endedAt,
  );
  checks++;
  const missed = await start("now() - interval '1 second'");
  await reconcileCallHistory(db, "bob");
  assert.equal(
    (await listCallHistory(db, "bob", { missed: true })).calls.find(
      (call) => call.sourceId === missed,
    )?.missed,
    true,
  );
  assert.equal((await listCallHistory(db, "alice", { missed: true })).calls.length, 0);
  checks++;
  const declined = await start();
  await q(
    "UPDATE untold_app.call SET status='ended',end_reason='declined',ended_at=now() WHERE id=$1",
    [declined],
  );
  assert.equal(
    (await listCallHistory(db, "bob")).calls.find((call) => call.sourceId === declined).missed,
    false,
  );
  checks++;
  const room = uid(),
    instanceA = uid(),
    instanceB = uid();
  await q(
    "INSERT INTO untold_app.call_room(id,conversation_id,created_by,kind,ring_until,expires_at) VALUES($1,$2,'alice','video',now()+interval '75 seconds',now()+interval '60 seconds')",
    [room, group],
  );
  await q(
    "INSERT INTO untold_app.call_participant(room_id,user_id,device_id,instance_id,status,seen_at) VALUES($1,'alice',$2,$3,'joined',now()),($1,'bob',NULL,NULL,'invited',NULL)",
    [room, a, instanceA],
  );
  await q(
    "UPDATE untold_app.call_participant SET status='joined',device_id=$2,instance_id=$3,seen_at=now(),connected_at=now() WHERE room_id=$1 AND user_id='bob'",
    [room, b, instanceB],
  );
  await q(
    "UPDATE untold_app.call_participant SET connected_at=now() WHERE room_id=$1 AND user_id='alice'",
    [room],
  );
  assert.ok(
    (await listCallHistory(db, "alice")).calls.find((call) => call.sourceId === room).connectedAt,
  );
  checks++;
  await q(
    "UPDATE untold_app.call_participant SET status='left',connected_at=NULL WHERE room_id=$1 AND user_id='bob'",
    [room],
  );
  await q(
    "UPDATE untold_app.call_participant SET status='joined',device_id=$2,instance_id=$3,seen_at=now(),connected_at=now() WHERE room_id=$1 AND user_id='bob'",
    [room, b, uid()],
  );
  assert.equal(
    (
      await q(
        "SELECT count(*)::int n FROM untold_app.call_attendance WHERE history_id=$1 AND user_id='bob'",
        [`group:${room}`],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (await listCallHistory(db, "bob")).calls.filter((call) => call.sourceId === room).length,
    1,
  );
  checks++;
  await q(
    "INSERT INTO untold_app.conversation_member(conversation_id,user_id) VALUES($1,'carol')",
    [group],
  );
  assert.equal((await listCallHistory(db, "carol")).calls.length, 0);
  checks++;
  await q(
    "UPDATE untold_app.conversation_member SET left_at=now() WHERE conversation_id=$1 AND user_id='bob'",
    [group],
  );
  assert.equal(
    (await listCallHistory(db, "bob")).calls.some((call) => call.sourceId === room),
    false,
  );
  checks++;
  await q(
    "UPDATE untold_app.conversation_member SET left_at=NULL WHERE conversation_id=$1 AND user_id='bob'",
    [group],
  );
  await q("UPDATE untold_app.call_room SET status='ended' WHERE id=$1", [room]);
  assert.equal(
    (
      await q(
        "SELECT count(*)::int n FROM untold_app.call_attendance WHERE history_id=$1 AND left_at IS NULL",
        [`group:${room}`],
      )
    ).rows[0].n,
    0,
  );
  checks++;
  // Equal timestamps across kinds exercise the actual shared cursor, not two limited lists.
  for (let i = 0; i < 105; i++)
    await q(
      "INSERT INTO untold_app.message_envelope(id,conversation_id,sender_id,client_message_id,envelope,created_at) VALUES($1,$2,'alice',$3,$4,$5::timestamptz)",
      [uid(), direct, uid(), Buffer.from("{}"), `2026-01-01T00:00:00.00000${(i % 3) + 1}Z`],
    );
  const first = await conversationTimelineKeys(db, "alice", direct, null);
  const second = await conversationTimelineKeys(db, "alice", direct, first.nextCursor);
  const all = [...first.keys, ...second.keys];
  assert.equal(new Set(all.map((item) => item.id)).size, all.length);
  assert.equal(all.length, 109);
  checks++;
  assert.equal(
    (await historyEntries(db, "dave", (await import("drizzle-orm")).sql`true`)).length,
    0,
  );
  checks++;
  // Exercise the hosted runner itself, including ledger creation and fast restart.
  const startupDatabase = new PGlite();
  try {
    const statements = [];
    const createClient = () =>
      Object.assign(new EventEmitter(), {
        async connect() {},
        async end() {},
        async query(text, params) {
          statements.push(text);
          return params
            ? startupDatabase.query(text, params)
            : ((await startupDatabase.exec(text)).at(-1) ?? { rows: [] });
        },
      });
    await runMigrations("postgres://isolated-test", () => {}, { createClient });
    assert.equal(
      (await startupDatabase.query("SELECT count(*)::int AS n FROM untold_migrations.applied"))
        .rows[0].n,
      18,
    );
    statements.length = 0;
    await runMigrations("postgres://isolated-test", () => {}, { createClient });
    assert.deepEqual(statements, ["SELECT name, sha256 FROM untold_migrations.applied"]);
    checks += 2;
  } finally {
    await startupDatabase.close();
  }
  console.log(
    `${checks} database checks passed; migrations 001–018 and history queries ran in an isolated PostgreSQL engine.`,
  );
} catch (error) {
  console.error(error.message, error.code ?? "", error.where ?? "");
  process.exitCode = 1;
} finally {
  await pg.close();
}
