export const databaseEnvironmentKeys = ["DATABASE_URL"] as const;

export type Environment = Record<string, string | undefined>;

export function getMissingDatabaseKeys(environment: Environment): string[] {
  return databaseEnvironmentKeys.filter((key) => !environment[key]?.trim());
}

export function readDatabaseConnectionString(environment: Environment): string | null {
  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString) return null;

  try {
    const parsed = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) return null;
  } catch {
    return null;
  }

  return connectionString;
}

export const authEnvironmentKeys = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const;

export function getAuthEnvironmentIssues(environment: Environment): string[] {
  const issues: string[] = [];
  if (!readDatabaseConnectionString(environment)) {
    issues.push(
      environment.DATABASE_URL?.trim()
        ? "DATABASE_URL (must be a valid PostgreSQL connection URL)"
        : "DATABASE_URL",
    );
  }

  for (const key of authEnvironmentKeys) {
    if (!environment[key]?.trim()) issues.push(key);
  }

  const secret = environment.BETTER_AUTH_SECRET;
  if (secret && secret.length < 32) {
    issues.push("BETTER_AUTH_SECRET (must be at least 32 characters)");
  }

  const baseUrl = environment.BETTER_AUTH_URL;
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
        issues.push("BETTER_AUTH_URL (must use HTTPS outside localhost)");
      }
    } catch {
      issues.push("BETTER_AUTH_URL (must be a valid absolute URL)");
    }
  }

  return [...new Set(issues)];
}

export function hasAblyApiKey(environment: Environment): boolean {
  return Boolean(environment.ABLY_API_KEY?.trim());
}
