import { runMigrations } from "./migrate-core.mjs";

// Runs before `next start` in the hosted container. Without a database URL the app still starts
// (pages render and the API answers 503); a failed migration exits non-zero so the deploy fails
// loudly instead of serving against a half-migrated schema.
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  process.stdout.write("DATABASE_URL is not set; skipping database migrations.\n");
} else {
  process.stdout.write(
    `[startup] Node ${process.versions.node}; preparing database before starting Untold.\n`,
  );
  try {
    await runMigrations(databaseUrl, (line) => process.stdout.write(`[migrate] ${line}\n`));
    process.stdout.write("[startup] Database ready; starting Next.js.\n");
  } catch (error) {
    process.stderr.write(`[migrate] Failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
