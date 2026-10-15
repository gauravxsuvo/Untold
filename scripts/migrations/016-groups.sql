ALTER TABLE untold_app.conversation ADD COLUMN group_name text;
ALTER TABLE untold_app.conversation ADD COLUMN group_owner_id text REFERENCES untold_auth."user"(id);
ALTER TABLE untold_app.conversation ADD CONSTRAINT conversation_group_shape CHECK (
  (group_name IS NULL AND group_owner_id IS NULL) OR
  (group_name IS NOT NULL AND group_owner_id IS NOT NULL AND direct_key IS NULL AND length(group_name) BETWEEN 1 AND 80)
);
ALTER TABLE untold_app.conversation_member ADD COLUMN left_at timestamptz;
CREATE TABLE untold_app.group_photo (
  conversation_id uuid PRIMARY KEY REFERENCES untold_app.conversation(id) ON DELETE CASCADE,
  version uuid NOT NULL,
  image bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE untold_app.message_recipient (
  message_id uuid NOT NULL REFERENCES untold_app.message_envelope(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
INSERT INTO untold_app.message_recipient (message_id, user_id)
SELECT m.id, cm.user_id FROM untold_app.message_envelope m
JOIN untold_app.conversation_member cm ON cm.conversation_id = m.conversation_id
WHERE cm.user_id <> m.sender_id;
CREATE INDEX message_recipient_user_idx ON untold_app.message_recipient(user_id, message_id);
