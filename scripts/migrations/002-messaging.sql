CREATE SCHEMA IF NOT EXISTS untold_app;

CREATE TABLE IF NOT EXISTS untold_app.conversation (
  id uuid PRIMARY KEY,
  created_by text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS untold_app.conversation_member (
  conversation_id uuid NOT NULL REFERENCES untold_app.conversation (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT untold_conversation_member_pk PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS untold_conversation_member_user_id_idx
  ON untold_app.conversation_member (user_id);

CREATE TABLE IF NOT EXISTS untold_app.message_envelope (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES untold_app.conversation (id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  client_message_id uuid NOT NULL,
  envelope bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS untold_message_client_id_unique
  ON untold_app.message_envelope (sender_id, client_message_id);
CREATE INDEX IF NOT EXISTS untold_message_conversation_created_idx
  ON untold_app.message_envelope (conversation_id, created_at, id);
