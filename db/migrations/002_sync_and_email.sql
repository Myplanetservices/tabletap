-- Neon is now the app's source of truth. Browsers load the whole store from
-- /api/db, write back changed records, and poll for other devices' changes.

-- Deletes are tombstones so polling devices learn about them. A deleted row
-- keeps its last data; live reads filter on deleted_at IS NULL.
ALTER TABLE tt_docs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- The change feed: "everything touched since <cursor>".
CREATE INDEX IF NOT EXISTS tt_docs_updated_idx ON tt_docs (updated_at);

-- Every email the app asks to send, sent or not. Also the source for the
-- send-rate limits in api/email.js.
CREATE TABLE IF NOT EXISTS tt_email_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  type        text        NOT NULL,
  recipient   text        NOT NULL,
  subject     text        NOT NULL,
  status      text        NOT NULL,   -- sent | failed | not_configured | rate_limited
  provider_id text,
  error       text,
  ip          text
);

CREATE INDEX IF NOT EXISTS tt_email_log_recipient_idx ON tt_email_log (lower(recipient), created_at DESC);
CREATE INDEX IF NOT EXISTS tt_email_log_ip_idx ON tt_email_log (ip, created_at DESC);
