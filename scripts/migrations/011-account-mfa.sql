ALTER TABLE untold_auth."user"
  ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS untold_auth.two_factor (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  failed_verification_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  CONSTRAINT untold_auth_two_factor_user_unique UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS untold_auth.used_totp (
  user_id text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, fingerprint)
);
