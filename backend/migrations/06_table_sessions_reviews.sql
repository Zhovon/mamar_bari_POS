-- ==========================================
-- MIGRATION 06: Dining sessions, per-device membership, reviews
-- Run this against the live Neon database (after migration 05).
-- ==========================================
--
-- Model: ONE shared session per table visit (so everyone at the table sees one
-- combined bill), with a row per phone that joined it. Splitting it this way is
-- what lets a single device be released -- when its owner submits or dismisses
-- the review -- without kicking their friends off the shared session.
--
-- The session token handed to a phone is only a POINTER (session id + device
-- id). These rows are the authority, which is what makes revocation instant;
-- a stateless JWT cannot be revoked.

-- 1. The shared table visit.
CREATE TABLE IF NOT EXISTS table_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id UUID NOT NULL REFERENCES restaurant_tables(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  customer_id UUID REFERENCES customers(id) NULL,
  opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_reason VARCHAR(30)
);

-- At most one open session per table.
CREATE UNIQUE INDEX IF NOT EXISTS table_sessions_one_open_per_table
  ON table_sessions (table_id) WHERE status = 'open';

-- 2. Each phone that scanned into the session.
CREATE TABLE IF NOT EXISTS session_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
  device_id VARCHAR(64) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  guest_name VARCHAR(100),
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_reason VARCHAR(30) CHECK (closed_reason IN (
    'review_submitted', 'review_skipped', 'left', 'table_closed'
  ))
);

-- A device joins a given session exactly once; a rescan resumes this row.
CREATE UNIQUE INDEX IF NOT EXISTS session_devices_session_device_key
  ON session_devices (session_id, device_id);

-- 3. Orders belong to a session (staff-entered orders leave this NULL).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS table_session_id UUID REFERENCES table_sessions(id);

CREATE INDEX IF NOT EXISTS orders_table_session_id_idx ON orders (table_session_id);

-- 4. Reviews captured at payment.
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES table_sessions(id) ON DELETE SET NULL,
  device_id VARCHAR(64),
  table_id UUID REFERENCES restaurant_tables(id),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) NULL,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reviews_created_at_idx ON reviews (created_at DESC);
