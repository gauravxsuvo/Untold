import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const migrationLockKey = 7_224_301_855;
export const migrationLimits = Object.freeze({
  connectMs: 10_000,
  lockMs: 10_000,
  statementMs: 120_000,
  queryMs: 125_000,
  progressMs: 5_000,
});

export class MigrationError extends Error {
  constructor(stage, code) {
    const hints = {
      MIGRATION_CONNECT_TIMEOUT:
        "Check the linked Postgres service and container database connectivity.",
      MIGRATION_QUERY_TIMEOUT:
        "The database stopped responding; the migration connection was closed.",
      "55P03":
        "A database lock is busy. Check for another migration or a long-running transaction.",
      57014: "The database statement exceeded its time limit.",
      "28P01": "Check the project's linked database credentials.",
      ENOTFOUND: "The linked database hostname could not be resolved.",
      EAI_AGAIN: "The linked database hostname could not be resolved.",
      ECONNREFUSED: "The linked database refused the connection.",
      ETIMEDOUT: "The linked database connection timed out.",
      MIGRATION_CHECKSUM_MISMATCH:
        "An applied migration changed. Restore that file and add a new numbered migration instead.",
    };
    super(
      `${stage} failed (${code}). ${hints[code] ?? "Check the database service and migration identified above."}`,
    );
    this.name = "MigrationError";
    this.code = code;
  }
}

// The factory/directory overrides support isolated tests; hosted/manual callers
// use the real pg client and packaged migrations, never browser input.
export async function runMigrations(
  databaseUrl,
  log = (line) => process.stdout.write(`${line}\n`),
  options = {},
) {
  const directory = options.directory ?? migrationsDirectory;
  const limits = { ...migrationLimits, ...options.limits };
  let stage = "Reading packaged migrations";
  let client;
  let closing;
  let disconnected = false;
  let connectionError;
  const started = Date.now();
  const progress =
    limits.progressMs > 0
      ? setInterval(
          () => log(`${stage}; ${Math.floor((Date.now() - started) / 1000)}s elapsed.`),
          limits.progressMs,
        )
      : null;
  progress?.unref();
  const close = () => {
    disconnected = true;
    closing ??= client
      ? Promise.resolve()
          .then(() => client.end())
          .catch(() => {})
      : Promise.resolve();
    return closing;
  };
  async function bounded(work, milliseconds, code) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            void close();
            reject(new MigrationError(stage, code));
          }, milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function query(text, params) {
    if (connectionError) throw connectionError;
    return bounded(() => client.query(text, params), limits.queryMs, "MIGRATION_QUERY_TIMEOUT");
  }
  async function inLockedTransaction(work) {
    await query("BEGIN");
    try {
      // SET LOCAL is compatible with transaction-pooled PostgreSQL connections.
      await query(`SET LOCAL lock_timeout = '${limits.lockMs}ms'`);
      await query(`SET LOCAL statement_timeout = '${limits.statementMs}ms'`);
      await query("SELECT pg_advisory_xact_lock($1)", [migrationLockKey]);
      const result = await work();
      await query("COMMIT");
      return result;
    } catch (error) {
      if (!disconnected) await query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
  const checksum = (source) => createHash("sha256").update(source).digest("hex");
  function checkApplied(name, expected, actual) {
    if (actual !== expected)
      throw new MigrationError(`Checking ${name}`, "MIGRATION_CHECKSUM_MISMATCH");
  }
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    const files = await Promise.all(
      names.map(async (name) => {
        const source = await readFile(join(directory, name));
        return { name, source, sha256: checksum(source) };
      }),
    );
    stage = "Connecting to PostgreSQL";
    log(`${stage} (timeout ${limits.connectMs / 1000}s).`);
    client = (options.createClient ?? ((config) => new pg.Client(config)))({
      connectionString: databaseUrl,
      connectionTimeoutMillis: limits.connectMs,
    });
    client.on("error", (error) => {
      connectionError = error;
    });
    await bounded(() => client.connect(), limits.connectMs, "MIGRATION_CONNECT_TIMEOUT");
    log("Database connected; checking migration ledger.");
    stage = "Reading migration ledger";
    let ledger;
    try {
      ledger = await query("SELECT name, sha256 FROM untold_migrations.applied");
    } catch (error) {
      if (error.code !== "42P01") throw error;
      stage = "Initializing migration ledger";
      log(`${stage}.`);
      await inLockedTransaction(async () => {
        await query("CREATE SCHEMA IF NOT EXISTS untold_migrations");
        await query(
          "CREATE TABLE IF NOT EXISTS untold_migrations.applied (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
        );
      });
      ledger = await query("SELECT name, sha256 FROM untold_migrations.applied");
    }
    // One snapshot validates all old files. An up-to-date restart performs no
    // DDL or per-file transactions (previously 4 round trips for every old file).
    const appliedFiles = new Map(ledger.rows.map((row) => [row.name, row.sha256]));
    const pending = files.filter((file) => {
      if (!appliedFiles.has(file.name)) return true;
      checkApplied(file.name, file.sha256, appliedFiles.get(file.name));
      return false;
    });
    log(
      `${files.length - pending.length} existing migration(s) verified; ${pending.length} pending.`,
    );
    let appliedCount = 0;
    for (const file of pending) {
      stage = `Waiting for migration lock: ${file.name}`;
      log(`${stage}.`);
      const applied = await inLockedTransaction(async () => {
        // A concurrent replica may have applied this since the snapshot.
        const { rows } = await query(
          "SELECT sha256 FROM untold_migrations.applied WHERE name = $1",
          [file.name],
        );
        if (rows[0]) {
          checkApplied(file.name, file.sha256, rows[0].sha256);
          return false;
        }
        stage = `Applying ${file.name}`;
        log(`${stage}.`);
        await query(file.source.toString("utf8"));
        await query("INSERT INTO untold_migrations.applied (name, sha256) VALUES ($1, $2)", [
          file.name,
          file.sha256,
        ]);
        return true;
      });
      if (applied) {
        appliedCount++;
        log(`Applied ${file.name}.`);
      }
    }
    log(
      `${appliedCount ? `Applied ${appliedCount} migration(s).` : "Database migrations are up to date."} Completed in ${Date.now() - started}ms.`,
    );
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    const code =
      typeof error?.code === "string" && /^[A-Z0-9_]{5,40}$/.test(error.code)
        ? error.code
        : "MIGRATION_FAILED";
    // Upstream messages can contain credentials, addresses, or SQL; never log them.
    throw new MigrationError(stage, code);
  } finally {
    clearInterval(progress);
    await close();
  }
}
