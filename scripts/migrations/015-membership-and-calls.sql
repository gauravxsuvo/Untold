CREATE TABLE untold_app.membership (
  user_id text PRIMARY KEY REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text REFERENCES untold_auth."user"(id) ON DELETE SET NULL
);
-- Keep existing members working. Every account created after this migration
-- starts pending, including accounts with an existing authentication session.
INSERT INTO untold_app.membership (user_id, status, requested_at, reviewed_at)
SELECT id, 'approved', created_at, now() FROM untold_auth."user";
CREATE INDEX membership_review_idx ON untold_app.membership(status, requested_at);
CREATE TABLE untold_app.call (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES untold_app.conversation(id) ON DELETE CASCADE,
  caller_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  callee_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  caller_device_id uuid NOT NULL REFERENCES untold_app.device(id),
  callee_device_id uuid REFERENCES untold_app.device(id),
  kind text NOT NULL CHECK (kind IN ('voice', 'video')),
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended')),
  offer jsonb,
  answer jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  caller_seen_at timestamptz NOT NULL DEFAULT now(),
  callee_seen_at timestamptz,
  expires_at timestamptz NOT NULL,
  CHECK (caller_id <> callee_id)
);
CREATE INDEX call_caller_idx ON untold_app.call(caller_id, expires_at);
CREATE INDEX call_callee_idx ON untold_app.call(callee_id, expires_at);
