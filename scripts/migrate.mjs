import { runMigrations } from "./migrate-core.mjs";

// Manual runs from a workstation: only through the local Portways bridge on loopback, so a
// developer machine never points this at a remote database by accident.
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

await runMigrations(databaseUrl);
