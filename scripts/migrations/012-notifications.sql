CREATE TABLE IF NOT EXISTS untold_app.push_keys (
  id text PRIMARY KEY,
  public_key text NOT NULL,
  private_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS untold_app.push_subscription (
  endpoint_hash text PRIMARY KEY,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES untold_auth.session(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS untold_push_subscription_user_idx ON untold_app.push_subscription(user_id);
CREATE TABLE IF NOT EXISTS untold_app.push_outbox (
  message_id uuid PRIMARY KEY REFERENCES untold_app.message_envelope(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS untold_push_outbox_due_idx ON untold_app.push_outbox(next_attempt_at);
CREATE TABLE IF NOT EXISTS untold_app.push_delivery (
  message_id uuid NOT NULL REFERENCES untold_app.push_outbox(message_id) ON DELETE CASCADE,
  endpoint_hash text NOT NULL,
  PRIMARY KEY(message_id, endpoint_hash)
);
