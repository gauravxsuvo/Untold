ALTER TABLE untold_app.device ADD COLUMN IF NOT EXISTS approval jsonb;
ALTER TABLE untold_app.device ADD COLUMN IF NOT EXISTS approval_response jsonb;
ALTER TABLE untold_app.device ADD COLUMN IF NOT EXISTS link_hash text;
ALTER TABLE untold_app.device ADD COLUMN IF NOT EXISTS link_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS untold_app.account_identity (
  user_id text PRIMARY KEY REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  agreement_key text NOT NULL,
  signing_key text NOT NULL
);
-- Anchor existing accounts to their oldest remaining device. Only that device
-- starts approved; additional devices require an explicit signed approval.
INSERT INTO untold_app.account_identity (user_id, device_id, agreement_key, signing_key)
SELECT DISTINCT ON (user_id) user_id, id, agreement_key, signing_key
FROM untold_app.device
WHERE revoked_at IS NULL
ORDER BY user_id, created_at, id
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS untold_app.contact_verification (
  owner_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  proof jsonb NOT NULL,
  PRIMARY KEY (owner_id, contact_id),
  CHECK (owner_id <> contact_id)
);
