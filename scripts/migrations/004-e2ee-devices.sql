CREATE TABLE IF NOT EXISTS untold_app.device (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  name text NOT NULL,
  agreement_key text NOT NULL,
  signing_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS untold_device_user_id_idx
  ON untold_app.device (user_id);
