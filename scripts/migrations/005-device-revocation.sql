ALTER TABLE untold_app.device
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
CREATE INDEX IF NOT EXISTS untold_device_active_user_idx
  ON untold_app.device (user_id)
  WHERE revoked_at IS NULL;
