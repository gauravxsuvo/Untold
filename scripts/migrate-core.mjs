import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "migrations");
// Arbitrary constant shared by every process that migrates this database.
const migrationLockKey = 7_224_301_855;

/**
 * Applies pending SQL migrations in name order. Each migration runs in its own transaction that
 * first takes a transaction-scoped advisory lock and re-checks what is applied, so concurrent
 * starts (several replicas, or a deploy overlapping a manual run) apply each file exactly once.
 * Transaction-scoped locks also work through PgBouncer in transaction-pooling mode.
 */
export async function runMigrations(databaseUrl, log = (line) => process.stdout.write(`${line}\n`)) {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  async function inLockedTransaction(work) {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [migrationLockKey]);
      const result = await work();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  try {
    await inLockedTransaction(async () => {
      await client.query("CREATE SCHEMA IF NOT EXISTS untold_migrations");
      await client.query(`
        CREATE TABLE IF NOT EXISTS untold_migrations.applied (
          name text PRIMARY KEY,
          sha256 text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    });

    let appliedCount = 0;
    for (const name of names) {
      const source = await readFile(join(migrationsDirectory, name));
      const sha256 = createHash("sha256").update(source).digest("hex");

      const applied = await inLockedTransaction(async () => {
        const { rows } = await client.query(
          "SELECT sha256 FROM untold_migrations.applied WHERE name = $1",
          [name],
        );
        if (rows[0]) {
          if (rows[0].sha256 !== sha256) {
            throw new Error(`Applied migration ${name} has changed. Add a new migration instead.`);
          }
          return false;
        }

        await client.query(source.toString("utf8"));
        await client.query("INSERT INTO untold_migrations.applied (name, sha256) VALUES ($1, $2)", [
          name,
          sha256,
        ]);
        return true;
      });

      if (applied) {
        appliedCount += 1;
        log(`Applied ${name}`);
      }
    }

    log(appliedCount ? `Applied ${appliedCount} migration(s).` : "Database migrations are up to date.");
  } finally {
    await client.end();
  }
}
