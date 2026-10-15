CREATE TABLE IF NOT EXISTS untold_app.profile_photo (
  user_id text PRIMARY KEY REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  version uuid NOT NULL,
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 65536),
  updated_at timestamptz NOT NULL DEFAULT now()
);
