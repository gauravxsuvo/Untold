import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAuthEnvironmentIssues,
  getMissingDatabaseKeys,
  readDatabaseConnectionString,
} from "../lib/server/portways-config";

describe("Portways-hosted database configuration", () => {
  it("reports a missing linked Postgres connection without exposing credentials", () => {
    assert.deepEqual(getMissingDatabaseKeys({ BETTER_AUTH_URL: "https://untold.portways.app" }), [
      "DATABASE_URL",
    ]);
  });

  it("validates local bridge and linked Postgres URLs", () => {
    const localUrl = "postgresql://user:password@127.0.0.1:5432/untold?sslmode=disable";
    const hostedUrl = "postgres://pw_app_12:secret@portways-svc-db:5432/untold";

    assert.equal(readDatabaseConnectionString({ DATABASE_URL: localUrl }), localUrl);
    assert.equal(readDatabaseConnectionString({ DATABASE_URL: hostedUrl }), hostedUrl);
    assert.equal(readDatabaseConnectionString({ DATABASE_URL: "not-a-url" }), null);
    assert.equal(readDatabaseConnectionString({ DATABASE_URL: "https://db.example" }), null);
  });

  it("requires a long authentication secret and HTTPS outside localhost", () => {
    const issues = getAuthEnvironmentIssues({
      DATABASE_URL: "postgresql://user:password@127.0.0.1:5432/untold",
      BETTER_AUTH_SECRET: "short",
      BETTER_AUTH_URL: "http://example.com",
    });

    assert.ok(issues.includes("BETTER_AUTH_SECRET (must be at least 32 characters)"));
    assert.ok(issues.includes("BETTER_AUTH_URL (must use HTTPS outside localhost)"));
  });

  it("accepts Portways project URL and linked database configuration", () => {
    const issues = getAuthEnvironmentIssues({
      DATABASE_URL: "postgresql://pw_app_12:secret@portways-svc-db:5432/untold",
      BETTER_AUTH_SECRET: "a-secure-secret-with-more-than-thirty-two-chars",
      BETTER_AUTH_URL: "https://untold.portways.app",
    });

    assert.deepEqual(issues, []);
  });
});
