CREATE TABLE IF NOT EXISTS untold_app.message_receipt (
  message_id uuid NOT NULL REFERENCES untold_app.message_envelope (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT untold_message_receipt_pk PRIMARY KEY (message_id, user_id),
  CONSTRAINT untold_message_receipt_read_after_received CHECK (read_at IS NULL OR read_at >= received_at)
);
CREATE INDEX IF NOT EXISTS untold_message_receipt_user_idx
  ON untold_app.message_receipt (user_id);
