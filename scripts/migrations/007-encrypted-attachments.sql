CREATE TABLE IF NOT EXISTS untold_app.message_attachment (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES untold_app.conversation (id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  object_key text NOT NULL,
  ciphertext_bytes integer NOT NULL CHECK (ciphertext_bytes BETWEEN 16 AND 20971536),
  ciphertext_sha256 text NOT NULL CHECK (ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS untold_message_attachment_object_key_unique
  ON untold_app.message_attachment (object_key);
CREATE INDEX IF NOT EXISTS untold_message_attachment_conversation_created_idx
  ON untold_app.message_attachment (conversation_id, created_at);

ALTER TABLE untold_app.message_envelope
  ADD COLUMN IF NOT EXISTS attachment_id uuid
  REFERENCES untold_app.message_attachment (id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS untold_message_attachment_unique
  ON untold_app.message_envelope (attachment_id);
