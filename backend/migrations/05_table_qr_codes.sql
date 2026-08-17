-- ==========================================
-- MIGRATION 05: Short permanent table QR codes
-- Run this against the live Neon database.
-- ==========================================
--
-- The printed QR used to encode a full JWT. That is bad for something you
-- laminate to a table: it dies the day JWT_SECRET is rotated, it makes a dense
-- QR that scans poorly in dim light, and a single table's code cannot be
-- revoked without reprinting every sticker in the restaurant.
--
-- Instead each table gets a short, random, opaque code stored here. The code
-- only NAMES a table -- it never authorises ordering by itself. Legacy JWT
-- stickers keep working (the server falls back to verifying them).

ALTER TABLE restaurant_tables
  ADD COLUMN IF NOT EXISTS qr_code VARCHAR(16);

-- Backfill every existing table with a unique 8-char Crockford-style base32
-- code (no I/L/O/U -- they get misread off a printed sticker).
DO $$
DECLARE
  t RECORD;
  alphabet TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate TEXT;
  i INT;
BEGIN
  FOR t IN SELECT id FROM restaurant_tables WHERE qr_code IS NULL LOOP
    LOOP
      candidate := '';
      FOR i IN 1..8 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM restaurant_tables WHERE qr_code = candidate);
    END LOOP;
    UPDATE restaurant_tables SET qr_code = candidate WHERE id = t.id;
  END LOOP;
END $$;

ALTER TABLE restaurant_tables ALTER COLUMN qr_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_tables_qr_code_key
  ON restaurant_tables (qr_code);
