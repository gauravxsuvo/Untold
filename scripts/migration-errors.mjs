// Report PostgreSQL's actual reason without dumping the client, connection
// configuration, query text, or row values from the error's detail field.
export function migrationFailureMessage(error, databaseUrl = "") {
  let message = `[migrate] Failed: ${error instanceof Error ? error.message : String(error)}`;
  let current = error?.cause;
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) {
      message += `\n[migrate] PostgreSQL ${current.code}: ${current.message}`;
      for (const field of ["schema", "table", "constraint", "hint", "position"]) {
        if (current[field] != null) message += `\n[migrate] ${field}: ${current[field]}`;
      }
      break;
    }
    current = current.cause;
  }
  const secrets = [databaseUrl];
  try {
    const url = new URL(databaseUrl);
    for (const value of [url.username, url.password]) {
      if (value) {
        secrets.push(value);
        secrets.push(decodeURIComponent(value));
      }
    }
  } catch {
    /* A malformed URL must not replace the original startup error. */
  }
  // Mask the whole URL first, including independently embedded PostgreSQL URLs.
  message = message.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]");
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
    message = message.split(secret).join("[redacted]");
  // Remove terminal control sequences from database-supplied diagnostics.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strip control characters from logs.
  return message.replace(/[\r\x00-\x08\x0b-\x1f\x7f]/g, " ");
}
