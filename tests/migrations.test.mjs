import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { migrationLimits, runMigrations } from "../scripts/migrate-core.mjs";

const hash = (source) => createHash("sha256").update(source).digest("hex");
async function fixture(work) {
  const directory = await mkdtemp(join(tmpdir(), "untold-migration-test-"));
  const files = new Map([
    ["001-first.sql", "SELECT 1;"],
    ["002-second.sql", "SELECT 2;"],
  ]);
  for (const [name, source] of files) await writeFile(join(directory, name), source);
  try {
    await work(directory, files);
  } finally {
    if (
      resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
      basename(directory).startsWith("untold-migration-test-")
    )
      await rm(directory, { recursive: true, force: true });
  }
}
class FakeClient extends EventEmitter {
  constructor(ledger = new Map(), behavior = {}) {
    super();
    this.ledger = ledger;
    this.behavior = behavior;
    this.queries = [];
    this.closed = false;
  }
  async connect() {
    if (this.behavior.connect) return this.behavior.connect();
  }
  async end() {
    this.closed = true;
  }
  async query(text, params) {
    this.queries.push({ text, params });
    const result = await this.behavior.query?.(text, params, this);
    if (result) return result;
    if (text === "SELECT name, sha256 FROM untold_migrations.applied")
      return { rows: [...this.ledger].map(([name, sha256]) => ({ name, sha256 })) };
    if (text.startsWith("SELECT sha256"))
      return { rows: this.ledger.has(params[0]) ? [{ sha256: this.ledger.get(params[0]) }] : [] };
    if (text.startsWith("INSERT INTO untold_migrations.applied"))
      this.ledger.set(params[0], params[1]);
    return { rows: [] };
  }
}
test("up-to-date startup validates every checksum with one ledger read and no transactions/DDL", async () =>
  fixture(async (directory, files) => {
    const client = new FakeClient(
      new Map([...files].map(([name, source]) => [name, hash(source)])),
    );
    let config;
    const logs = [];
    await runMigrations(
      "postgres://private:secret@hidden.invalid/private",
      (line) => logs.push(line),
      {
        directory,
        createClient: (value) => {
          config = value;
          return client;
        },
      },
    );
    assert.equal(client.queries.length, 1);
    assert.equal(config.connectionTimeoutMillis, migrationLimits.connectMs);
    assert.equal(client.closed, true);
    assert.ok(logs.some((line) => line.includes("2 existing migration(s) verified; 0 pending")));
    assert.ok(logs.every((line) => !line.includes("secret") && !line.includes("hidden.invalid")));
  }));
test("only pending migrations take a lock and commit their SQL and checksum together", async () =>
  fixture(async (directory, files) => {
    const client = new FakeClient(new Map([["001-first.sql", hash(files.get("001-first.sql"))]]));
    await runMigrations("postgres://test", () => {}, { directory, createClient: () => client });
    const queries = client.queries.map(({ text }) => text);
    assert.equal(queries.filter((text) => text === "BEGIN").length, 1);
    assert.ok(queries.indexOf("SELECT pg_advisory_xact_lock($1)") < queries.indexOf("SELECT 2;"));
    assert.ok(queries.some((text) => text.startsWith("SET LOCAL lock_timeout")));
    assert.ok(queries.some((text) => text.startsWith("SET LOCAL statement_timeout")));
    assert.ok(!queries.includes("SELECT 1;"));
    assert.equal(queries.at(-1), "COMMIT");
    assert.equal(client.ledger.get("002-second.sql"), hash(files.get("002-second.sql")));
  }));
test("a concurrently applied pending migration is rechecked under the advisory lock", async () =>
  fixture(async (directory, files) => {
    const client = new FakeClient(new Map(), {
      query: (text, _params, state) => {
        if (text === "SELECT pg_advisory_xact_lock($1)")
          for (const [name, source] of files) state.ledger.set(name, hash(source));
      },
    });
    await runMigrations("postgres://test", () => {}, { directory, createClient: () => client });
    assert.ok(client.queries.every(({ text }) => !["SELECT 1;", "SELECT 2;"].includes(text)));
  }));
test("changed applied SQL fails before any new migration can execute", async () =>
  fixture(async (directory) => {
    const client = new FakeClient(new Map([["001-first.sql", "wrong-hash"]]));
    await assert.rejects(
      runMigrations("postgres://test", () => {}, { directory, createClient: () => client }),
      (error) =>
        error.code === "MIGRATION_CHECKSUM_MISMATCH" && error.message.includes("001-first.sql"),
    );
    assert.equal(client.queries.length, 1);
    assert.equal(client.closed, true);
  }));
test("failed migration rolls back, names its stage, and hides upstream credentials/SQL", async () =>
  fixture(async (directory) => {
    const client = new FakeClient(new Map(), {
      query: (text) => {
        if (text === "SELECT 1;")
          throw Object.assign(new Error("postgres://private:secret@hidden.invalid SQL contents"), {
            code: "55P03",
          });
      },
    });
    await assert.rejects(
      runMigrations("postgres://test", () => {}, { directory, createClient: () => client }),
      (error) =>
        error.code === "55P03" &&
        error.message.includes("001-first.sql") &&
        !error.message.includes("secret") &&
        !error.message.includes("hidden.invalid"),
    );
    assert.equal(client.queries.at(-1).text, "ROLLBACK");
    assert.equal(client.ledger.size, 0);
  }));
test("silent connection stall is bounded and closes the client", async () =>
  fixture(async (directory) => {
    const client = new FakeClient(new Map(), { connect: () => new Promise(() => {}) });
    await assert.rejects(
      runMigrations("postgres://test", () => {}, {
        directory,
        createClient: () => client,
        limits: { connectMs: 20, progressMs: 0 },
      }),
      (error) => error.code === "MIGRATION_CONNECT_TIMEOUT",
    );
    assert.equal(client.closed, true);
    assert.equal(client.queries.length, 0);
  }));

test("real pg client exits when a TCP peer accepts but never completes PostgreSQL handshake", async () =>
  fixture(async (directory) => {
    const sockets = new Set();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await assert.rejects(
        runMigrations(`postgres://test:fixture@127.0.0.1:${server.address().port}/test`, () => {}, {
          directory,
          limits: { connectMs: 50, progressMs: 0 },
        }),
        (error) => error.code === "MIGRATION_CONNECT_TIMEOUT",
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  }));
test("silent query stall closes the transport rather than queuing an unbounded rollback", async () =>
  fixture(async (directory) => {
    const client = new FakeClient(new Map(), {
      query: (text) => (text === "SELECT 1;" ? new Promise(() => {}) : undefined),
    });
    await assert.rejects(
      runMigrations("postgres://test", () => {}, {
        directory,
        createClient: () => client,
        limits: { queryMs: 20, progressMs: 0 },
      }),
      (error) => error.code === "MIGRATION_QUERY_TIMEOUT",
    );
    assert.equal(client.closed, true);
    assert.ok(!client.queries.some(({ text }) => text === "ROLLBACK"));
  }));
test("fresh database initializes its ledger under the same transaction lock", async () =>
  fixture(async (directory) => {
    let missing = true;
    const client = new FakeClient(new Map(), {
      query: (text) => {
        if (text === "SELECT name, sha256 FROM untold_migrations.applied" && missing) {
          missing = false;
          throw Object.assign(new Error("missing"), { code: "42P01" });
        }
      },
    });
    await runMigrations("postgres://test", () => {}, { directory, createClient: () => client });
    assert.equal(client.ledger.size, 2);
    assert.ok(
      client.queries.some(({ text }) =>
        text.startsWith("CREATE TABLE IF NOT EXISTS untold_migrations.applied"),
      ),
    );
  }));
