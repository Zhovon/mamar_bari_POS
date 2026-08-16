-- Migration 03: Table Session Version
-- Adds a session_version to restaurant_tables to allow invalidating active customer sessions
-- when a table is checked out, without changing the permanent printed QR token.

ALTER TABLE restaurant_tables
  ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 1;
