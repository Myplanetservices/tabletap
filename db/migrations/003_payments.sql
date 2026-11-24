-- Razorpay plan purchases. Kept out of tt_docs on purpose: tt_docs is synced to
-- every browser, and this table holds buyer emails and payment ids.
CREATE TABLE IF NOT EXISTS tt_payments (
  order_id      text        PRIMARY KEY,           -- Razorpay order id (order_...)
  created_at    timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'created',   -- created | paid
  plan_id       text        NOT NULL,
  amount        integer     NOT NULL,              -- smallest currency unit (paise)
  currency      text        NOT NULL,
  restaurant    text        NOT NULL,
  owner_name    text        NOT NULL,
  email         text        NOT NULL,
  country       text        NOT NULL,
  city          text        NOT NULL,
  phone         text,
  ip            text,
  payment_id    text,                              -- Razorpay payment id (pay_...)
  paid_at       timestamptz,
  invite_id     text,                              -- tt_docs invite created after payment
  email_status  text                               -- sent | failed | not_configured
);

CREATE INDEX IF NOT EXISTS tt_payments_ip_idx ON tt_payments (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS tt_payments_email_idx ON tt_payments (lower(email), created_at DESC);
