import "server-only";

import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getMissingDatabaseKeys, readDatabaseConnectionString } from "@/lib/server/portways-config";
import * as schema from "@/lib/server/schema";

export class BackendConfigurationError extends Error {
  constructor(
    public readonly missingKeys: string[],
    public readonly service: "account" | "realtime" = "account",
  ) {
    super("Backend service configuration is incomplete.");
    this.name = "BackendConfigurationError";
  }
}

type UntoldDatabase = NodePgDatabase<typeof schema>;
type DatabaseSingleton = { pool: Pool; db: UntoldDatabase };

const globalForDatabase = globalThis as typeof globalThis & {
  untoldDatabase?: DatabaseSingleton;
};

export function getDatabase(): DatabaseSingleton {
  if (globalForDatabase.untoldDatabase) return globalForDatabase.untoldDatabase;

  const connectionString = readDatabaseConnectionString(process.env);
  if (!connectionString) {
    const missingKeys = getMissingDatabaseKeys(process.env);
    throw new BackendConfigurationError(
      missingKeys.length ? missingKeys : ["DATABASE_URL (must be a valid PostgreSQL connection URL)"],
    );
  }

  const pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 5 * 60 * 1000,
    allowExitOnIdle: true,
  });
  const db = drizzle(pool, { schema });
  globalForDatabase.untoldDatabase = { pool, db };

  return globalForDatabase.untoldDatabase;
}
