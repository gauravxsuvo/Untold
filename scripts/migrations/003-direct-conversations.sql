-- One conversation per pair of people: direct_key is "<smaller user id>:<larger user id>".
ALTER TABLE untold_app.conversation ADD COLUMN IF NOT EXISTS direct_key text;
CREATE UNIQUE INDEX IF NOT EXISTS untold_conversation_direct_key_unique
  ON untold_app.conversation (direct_key);

-- Starting a conversation looks people up by email without case sensitivity.
CREATE INDEX IF NOT EXISTS untold_auth_user_email_lower_idx
  ON untold_auth."user" (lower(email));

-- Fixed-window, per-user limits for the app's own API routes.
CREATE TABLE IF NOT EXISTS untold_app.rate_limit (
  key text PRIMARY KEY,
  count integer NOT NULL,
  window_started_at bigint NOT NULL
);
