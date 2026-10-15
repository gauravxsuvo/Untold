-- An empty chat belongs in the list only for people who explicitly started it.
-- Any committed message makes the conversation visible to both members.
ALTER TABLE untold_app.conversation_member
  ADD COLUMN IF NOT EXISTS initiated_at timestamptz;

-- Preserve the original starter's existing empty chats. Other members become
-- visible through message history, or by explicitly starting the chat themselves.
UPDATE untold_app.conversation_member AS member
SET initiated_at = conversation.created_at
FROM untold_app.conversation AS conversation
WHERE member.conversation_id = conversation.id
  AND member.user_id = conversation.created_by
  AND member.initiated_at IS NULL;
