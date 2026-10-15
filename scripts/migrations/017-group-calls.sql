CREATE TABLE untold_app.call_room (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES untold_app.conversation(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('voice', 'video')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ring_until timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX call_room_conversation_active_idx ON untold_app.call_room(conversation_id) WHERE status = 'active';
CREATE TABLE untold_app.call_participant (
  room_id uuid NOT NULL REFERENCES untold_app.call_room(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  device_id uuid REFERENCES untold_app.device(id),
  instance_id uuid,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'joined', 'left', 'declined')),
  seen_at timestamptz,
  sharing boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  camera_off boolean NOT NULL DEFAULT false,
  PRIMARY KEY(room_id, user_id),
  CHECK (status <> 'joined' OR (device_id IS NOT NULL AND instance_id IS NOT NULL AND seen_at IS NOT NULL))
);
CREATE INDEX call_participant_user_idx ON untold_app.call_participant(user_id, status, room_id);
CREATE TABLE untold_app.call_link (
  id uuid NOT NULL UNIQUE,
  room_id uuid NOT NULL REFERENCES untold_app.call_room(id) ON DELETE CASCADE,
  lower_user_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  upper_user_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  offer jsonb,
  answer jsonb,
  PRIMARY KEY(room_id, lower_user_id, upper_user_id),
  CHECK (lower_user_id <> upper_user_id)
);
