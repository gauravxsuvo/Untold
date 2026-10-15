-- Remove every stored message that is not a structurally valid Untold E2EE v1 envelope.
-- Pre-encryption message bodies were stored as readable JSON and cannot be retroactively
-- encrypted with the device keys created later. This permanently removes that history.
CREATE OR REPLACE FUNCTION untold_app.is_valid_e2ee_v1_envelope(payload bytea)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $function$
DECLARE
  document jsonb;
  wrapped jsonb;
BEGIN
  document := convert_from(payload, 'UTF8')::jsonb;

  IF jsonb_typeof(document) IS DISTINCT FROM 'object'
    OR document ->> 'protocol' IS DISTINCT FROM 'untold-e2ee'
    OR document -> 'version' IS DISTINCT FROM '1'::jsonb
  THEN
    RETURN FALSE;
  END IF;

  IF jsonb_typeof(document -> 'wrappedKeys') IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;

  IF jsonb_array_length(document -> 'wrappedKeys') < 1
    OR jsonb_array_length(document -> 'wrappedKeys') > 32
  THEN
    RETURN FALSE;
  END IF;

  IF jsonb_typeof(document -> 'conversationId') IS DISTINCT FROM 'string'
    OR NULLIF(document ->> 'conversationId', '') IS NULL
    OR jsonb_typeof(document -> 'messageId') IS DISTINCT FROM 'string'
    OR NULLIF(document ->> 'messageId', '') IS NULL
    OR jsonb_typeof(document -> 'senderId') IS DISTINCT FROM 'string'
    OR NULLIF(document ->> 'senderId', '') IS NULL
    OR jsonb_typeof(document -> 'senderDeviceId') IS DISTINCT FROM 'string'
    OR NULLIF(document ->> 'senderDeviceId', '') IS NULL
    OR jsonb_typeof(document -> 'nonce') IS DISTINCT FROM 'string'
    OR NULLIF(document ->> 'nonce', '') IS NULL
    OR jsonb_typeof(document -> 'ciphertext') IS DISTINCT FROM 'string'
    OR NULLIF(document ->> 'ciphertext', '') IS NULL
    OR jsonb_typeof(document -> 'signature') IS DISTINCT FROM 'string'
    OR NULLIF(document ->> 'signature', '') IS NULL
  THEN
    RETURN FALSE;
  END IF;

  FOR wrapped IN SELECT value FROM jsonb_array_elements(document -> 'wrappedKeys') LOOP
    IF jsonb_typeof(wrapped) IS DISTINCT FROM 'object'
      OR jsonb_typeof(wrapped -> 'deviceId') IS DISTINCT FROM 'string'
      OR NULLIF(wrapped ->> 'deviceId', '') IS NULL
      OR jsonb_typeof(wrapped -> 'salt') IS DISTINCT FROM 'string'
      OR NULLIF(wrapped ->> 'salt', '') IS NULL
      OR jsonb_typeof(wrapped -> 'nonce') IS DISTINCT FROM 'string'
      OR NULLIF(wrapped ->> 'nonce', '') IS NULL
      OR jsonb_typeof(wrapped -> 'ciphertext') IS DISTINCT FROM 'string'
      OR NULLIF(wrapped ->> 'ciphertext', '') IS NULL
    THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
EXCEPTION
  WHEN data_exception THEN
    RETURN FALSE;
  WHEN SQLSTATE '54001' THEN
    RETURN FALSE;
END;
$function$;

DO $block$
DECLARE
  purged_count bigint;
BEGIN
  DELETE FROM untold_app.message_envelope
  WHERE NOT untold_app.is_valid_e2ee_v1_envelope(envelope);

  GET DIAGNOSTICS purged_count = ROW_COUNT;
  RAISE NOTICE 'Removed % plaintext, malformed, or unsupported message envelope(s).', purged_count;
END;
$block$;

DROP FUNCTION untold_app.is_valid_e2ee_v1_envelope(bytea);
