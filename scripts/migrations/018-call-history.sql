-- Persistent system activity, separate from encrypted messages and transient SDP.
ALTER TABLE untold_app.call ADD COLUMN answered_at timestamptz;
ALTER TABLE untold_app.call ADD COLUMN ended_at timestamptz;
ALTER TABLE untold_app.call ADD COLUMN end_reason text;
ALTER TABLE untold_app.call ADD COLUMN caller_connected_at timestamptz;
ALTER TABLE untold_app.call ADD COLUMN callee_connected_at timestamptz;
ALTER TABLE untold_app.call ADD COLUMN caller_camera_off boolean NOT NULL DEFAULT false;
ALTER TABLE untold_app.call ADD COLUMN callee_camera_off boolean NOT NULL DEFAULT false;
ALTER TABLE untold_app.call ADD COLUMN caller_sharing boolean NOT NULL DEFAULT false;
ALTER TABLE untold_app.call ADD COLUMN callee_sharing boolean NOT NULL DEFAULT false;
ALTER TABLE untold_app.call_participant ADD COLUMN connected_at timestamptz;

CREATE TABLE untold_app.call_history (
  id text PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('direct', 'group')),
  source_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES untold_app.conversation(id) ON DELETE CASCADE,
  initiator_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('voice', 'video')),
  status text NOT NULL CHECK (status IN ('live', 'ended')),
  outcome text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL,
  ring_until timestamptz NOT NULL,
  answered_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy boolean NOT NULL DEFAULT false,
  UNIQUE(source, source_id)
);
CREATE INDEX call_history_conversation_idx ON untold_app.call_history(conversation_id, created_at DESC, id DESC);
CREATE INDEX call_history_recent_idx ON untold_app.call_history(created_at DESC, id DESC);
CREATE TABLE untold_app.call_history_audience (
  history_id text NOT NULL REFERENCES untold_app.call_history(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'invited',
  acknowledged_at timestamptz,
  PRIMARY KEY(history_id, user_id)
);
CREATE INDEX call_history_audience_user_idx ON untold_app.call_history_audience(user_id, history_id);
CREATE TABLE untold_app.call_attendance (
  id bigserial PRIMARY KEY,
  history_id text NOT NULL REFERENCES untold_app.call_history(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES untold_auth."user"(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  left_at timestamptz
);
CREATE UNIQUE INDEX call_attendance_open_idx ON untold_app.call_attendance(history_id, user_id) WHERE left_at IS NULL;

-- Unknown legacy durations/outcomes stay unknown. Historical group audiences
-- cannot safely be inferred from today's membership, so they are not backfilled.
INSERT INTO untold_app.call_history(id, source, source_id, conversation_id, initiator_id, kind, status, created_at, ring_until, legacy)
SELECT 'direct:' || id, 'direct', id, conversation_id, caller_id, kind,
  CASE WHEN status = 'ended' OR expires_at <= now() THEN 'ended' ELSE 'live' END,
  created_at, created_at + interval '75 seconds', true FROM untold_app.call;
INSERT INTO untold_app.call_history_audience(history_id, user_id)
SELECT 'direct:' || id, caller_id FROM untold_app.call UNION ALL SELECT 'direct:' || id, callee_id FROM untold_app.call;

CREATE FUNCTION untold_app.record_direct_call() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hid text := 'direct:' || NEW.id; connected timestamptz; final_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO untold_app.call_history(id, source, source_id, conversation_id, initiator_id, kind, status, created_at, ring_until)
      VALUES(hid, 'direct', NEW.id, NEW.conversation_id, NEW.caller_id, NEW.kind, 'live', NEW.created_at, NEW.expires_at);
    INSERT INTO untold_app.call_history_audience(history_id, user_id, status) VALUES(hid, NEW.caller_id, 'joined'), (hid, NEW.callee_id, 'invited');
    RETURN NEW;
  END IF;
  IF OLD.status = 'ended' THEN RETURN NEW; END IF;
  IF NEW.answered_at IS NOT NULL THEN
    UPDATE untold_app.call_history_audience SET status = 'joined' WHERE history_id = hid;
  ELSIF NEW.end_reason = 'declined' THEN
    UPDATE untold_app.call_history_audience SET status = 'declined' WHERE history_id = hid AND user_id = NEW.callee_id;
  END IF;
  IF NEW.caller_connected_at IS NOT NULL AND NEW.callee_connected_at IS NOT NULL THEN
    connected := greatest(NEW.caller_connected_at, NEW.callee_connected_at);
  END IF;
  final_reason := coalesce(NEW.end_reason, CASE
    WHEN NEW.expires_at <= now() AND NEW.answered_at IS NULL THEN 'missed'
    WHEN connected IS NOT NULL THEN 'completed'
    WHEN NEW.answered_at IS NOT NULL THEN 'failed' ELSE 'unknown' END);
  UPDATE untold_app.call_history SET
    status = CASE WHEN NEW.status = 'ended' THEN 'ended' ELSE 'live' END,
    answered_at = coalesce(answered_at, NEW.answered_at),
    connected_at = coalesce(connected_at, connected),
    ended_at = CASE WHEN NEW.status = 'ended' THEN coalesce(NEW.ended_at, least(now(), NEW.expires_at)) ELSE NULL END,
    outcome = CASE WHEN NEW.status = 'ended' THEN final_reason ELSE outcome END,
    updated_at = now() WHERE id = hid AND status <> 'ended';
  RETURN NEW;
END $$;
CREATE TRIGGER record_direct_call AFTER INSERT OR UPDATE ON untold_app.call FOR EACH ROW EXECUTE FUNCTION untold_app.record_direct_call();

CREATE FUNCTION untold_app.record_group_room() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hid text := 'group:' || NEW.id; finish timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO untold_app.call_history(id, source, source_id, conversation_id, initiator_id, kind, status, created_at, ring_until)
      VALUES(hid, 'group', NEW.id, NEW.conversation_id, NEW.created_by, NEW.kind, 'live', NEW.created_at, NEW.ring_until);
  ELSIF NEW.status = 'ended' AND OLD.status <> 'ended' THEN
    finish := least(now(), NEW.expires_at);
    UPDATE untold_app.call_history SET status = 'ended', ended_at = finish, updated_at = now(),
      outcome = CASE WHEN connected_at IS NOT NULL THEN 'completed' WHEN NEW.ring_until <= now() THEN 'missed' ELSE 'cancelled' END
      WHERE id = hid AND status <> 'ended';
    UPDATE untold_app.call_attendance SET left_at = greatest(joined_at, finish) WHERE history_id = hid AND left_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_group_room AFTER INSERT OR UPDATE ON untold_app.call_room FOR EACH ROW EXECUTE FUNCTION untold_app.record_group_room();

CREATE FUNCTION untold_app.record_group_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hid text := 'group:' || NEW.room_id; connected timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM untold_app.call_history WHERE id = hid AND NOT legacy) THEN RETURN NEW; END IF;
  INSERT INTO untold_app.call_history_audience(history_id, user_id, status) VALUES(hid, NEW.user_id, NEW.status)
    ON CONFLICT(history_id, user_id) DO UPDATE SET status = EXCLUDED.status;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'joined' AND (NEW.status <> 'joined' OR NEW.instance_id IS DISTINCT FROM OLD.instance_id) THEN
      UPDATE untold_app.call_attendance SET left_at = greatest(joined_at, least(now(), coalesce(OLD.seen_at + interval '60 seconds', now())) )
        WHERE history_id = hid AND user_id = NEW.user_id AND left_at IS NULL;
    END IF;
  END IF;
  IF NEW.status = 'joined' THEN
    INSERT INTO untold_app.call_attendance(history_id, user_id, instance_id, connected_at)
      VALUES(hid, NEW.user_id, NEW.instance_id, NEW.connected_at)
      ON CONFLICT(history_id, user_id) WHERE left_at IS NULL DO UPDATE SET
        connected_at = coalesce(untold_app.call_attendance.connected_at, EXCLUDED.connected_at);
    SELECT a.connected_at INTO connected FROM untold_app.call_attendance a
      JOIN untold_app.call_participant p ON p.room_id = NEW.room_id AND p.user_id = a.user_id
      WHERE a.history_id = hid AND a.left_at IS NULL AND a.connected_at IS NOT NULL
        AND p.status = 'joined' AND p.seen_at > now() - interval '60 seconds'
      ORDER BY a.connected_at LIMIT 1 OFFSET 1;
    IF connected IS NOT NULL THEN
      UPDATE untold_app.call_history SET connected_at = coalesce(connected_at, connected), updated_at = now() WHERE id = hid AND status = 'live';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_group_attendance AFTER INSERT OR UPDATE ON untold_app.call_participant FOR EACH ROW EXECUTE FUNCTION untold_app.record_group_attendance();
