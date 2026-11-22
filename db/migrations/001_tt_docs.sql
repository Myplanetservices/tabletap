-- TableTap document store on Lakebase Postgres (Neon).
--
-- The app keeps its data as named collections of JSON records (clients, owners,
-- tables, items, orders, ...). Each record is one row here, keyed by
-- (collection, id), so the existing sync/order/menu API keeps its shape.
--
-- client_id is lifted out of the JSON so per-restaurant reads (and the Realtime
-- live query on orders) can filter on an indexed column. The primary key gives
-- Neon Realtime the stable replica identity it needs. No row-level security:
-- Realtime rejects live queries on RLS tables, so authorization happens in the
-- API before a query is sealed.

CREATE TABLE IF NOT EXISTS tt_docs (
  collection text        NOT NULL,
  id         text        NOT NULL,
  data       jsonb       NOT NULL,
  client_id  text        GENERATED ALWAYS AS (data->>'clientId') STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS tt_docs_client_idx
  ON tt_docs (collection, client_id, updated_at DESC);

-- Owner lookups by email when authorizing a signed-in Neon Auth user.
CREATE INDEX IF NOT EXISTS tt_docs_owner_email_idx
  ON tt_docs ((lower(data->>'email')))
  WHERE collection = 'owners';
