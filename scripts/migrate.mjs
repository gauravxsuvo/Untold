import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Set DATABASE_URL to the local Portways bridge connection string first.");
}

const parsedUrl = new URL(databaseUrl);
if (!/^postgres(ql)?:$/.test(parsedUrl.protocol)) {
  throw new Error("DATABASE_URL must use the postgresql protocol.");
}
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsedUrl.hostname)) {
  throw new Error("Migrations only run through the local Portways bridge on loopback.");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(scriptDirectory, "migrations");
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query("CREATE SCHEMA IF NOT EXISTS untold_migrations");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS untold_migrations.applied (
      name text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const name of migrationNames) {
    const source = await readFile(join(migrationsDirectory, name));
    const sha256 = createHash("sha256").update(source).digest("hex");
    const result = await pool.query(
      "SELECT sha256 FROM untold_migrations.applied WHERE name = $1",
      [name],
    );
    const appliedChecksum = result.rows[0]?.sha256;

    if (appliedChecksum) {
      if (appliedChecksum !== sha256) {
        throw new Error(`Applied migration ${name} has changed. Add a new migration instead.`);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(source.toString("utf8"));
      await client.query(
        "INSERT INTO untold_migrations.applied (name, sha256) VALUES ($1, $2)",
        [name, sha256],
      );
      await client.query("COMMIT");
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  process.stdout.write("Database migrations are up to date.\n");
} finally {
  await pool.end();
}
