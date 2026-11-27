-- Guest web-push subscriptions, one per order and phone. Kept out of tt_docs
-- (which every browser downloads). A row is deleted once the review reminder
-- is sent, or when the order is rejected.
CREATE TABLE IF NOT EXISTS tt_push (
  order_id      text        NOT NULL,
  endpoint      text        NOT NULL,
  p256dh        text        NOT NULL,
  auth          text        NOT NULL,
  return_path   text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  ready_sent_at timestamptz,
  review_due_at timestamptz,
  ip            text,
  PRIMARY KEY (order_id, endpoint)
);

CREATE INDEX IF NOT EXISTS tt_push_due_idx ON tt_push (review_due_at) WHERE review_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS tt_push_ip_idx ON tt_push (ip, created_at DESC);
