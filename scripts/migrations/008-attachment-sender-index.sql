CREATE INDEX IF NOT EXISTS untold_message_attachment_sender_idx
  ON untold_app.message_attachment (sender_id);
