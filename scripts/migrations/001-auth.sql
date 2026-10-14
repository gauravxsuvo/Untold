CREATE SCHEMA IF NOT EXISTS untold_auth;

CREATE TABLE IF NOT EXISTS untold_auth."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS untold_auth_user_email_unique
  ON untold_auth."user" (email);

CREATE TABLE IF NOT EXISTS untold_auth.session (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS untold_auth_session_token_unique
  ON untold_auth.session (token);
CREATE INDEX IF NOT EXISTS untold_auth_session_user_id_idx
  ON untold_auth.session (user_id);

CREATE TABLE IF NOT EXISTS untold_auth.account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES untold_auth."user" (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS untold_auth_account_provider_account_unique
  ON untold_auth.account (provider_id, account_id);
CREATE INDEX IF NOT EXISTS untold_auth_account_user_id_idx
  ON untold_auth.account (user_id);

CREATE TABLE IF NOT EXISTS untold_auth.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS untold_auth_verification_identifier_idx
  ON untold_auth.verification (identifier);

CREATE TABLE IF NOT EXISTS untold_auth.rate_limit (
  id text PRIMARY KEY,
  key text NOT NULL,
  count integer NOT NULL,
  last_request bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS untold_auth_rate_limit_key_unique
  ON untold_auth.rate_limit (key);
