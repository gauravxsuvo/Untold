# Startup migrations and deployment diagnostics

The 2026-10-16 Portways log shows a successful Linux production build followed by repeated `npm start` invocations. Each invocation stops producing output before the first Next.js startup banner. The start command runs migrations first, but that log contains no database error or exit code that establishes the original cause.

The migration runner now logs connection, ledger verification, pending file, and completion stages, plus progress every five seconds. An up-to-date database needs one ledger read instead of a transaction for every historical migration. Pending files still acquire the same transaction advisory lock, recheck their checksum under that lock, and commit SQL with their ledger entry. Applied migration files must remain unchanged.

Wait limits are 10 seconds for connection, 10 seconds for acquiring database locks, 120 seconds per database statement, and 125 seconds per client query if the transport stops responding. Timeout closes the connection; PostgreSQL rolls back an uncommitted transaction when the connection closes. A failed startup exits before Next.js serves requests. Logs include the stage and error code, with hints for connectivity, credentials, lock contention, and checksum mismatches. Upstream error text, database URLs, and SQL are omitted.

The root Dockerfile selects Node.js 24 because the installed `@zxing/library` dependency requires Node >=24. The reported Node 22 engine warning is separate from the unproven migration failure. Portways must build the repository root so it picks up this Dockerfile. The build remains the default Turbopack build; the webpack fallback is for local verification only. Environment files and local build artifacts are excluded from the image context.

## Local verification

- `npm test`: includes migration restart, pending-file, concurrent-start, checksum, rollback, timeout, and real PostgreSQL-client handshake-stall tests. The handshake test opens only a temporary loopback TCP server.
- `npm run test:calls:database`: applies all 18 real migrations against isolated PGlite databases, exercises call history, and verifies the migration runner's second startup issues one ledger query.
- `npm run lint`, `npx tsc --noEmit`, and a production build check the application. Tests do not connect to the linked production database.

## Next deployment

1. Confirm the build selects `node:24-alpine` from the repository Dockerfile.
2. Look for `[startup]`, `[migrate] Connecting to PostgreSQL`, ledger counts, and any pending migration filename.
3. Success prints `[startup] Database ready; starting Next.js.` followed by the Next.js ready banner. Check the deployed sign-in page and authenticated Calls/chat flows.
4. If startup fails, use the named stage and error code to check the linked database, concurrent transactions, or the identified migration. Preserve the failure log before retrying. Do not bypass failed migrations or edit already-applied SQL.

The supplied log cannot prove a specific database failure. These changes require a fresh Portways deployment to confirm live startup; a local build or isolated database test does not establish production availability.
