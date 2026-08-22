-- ==========================================
-- MIGRATION 08: Take-out (parcel) orders
-- Run this against the live Neon database (after migration 07).
-- ==========================================
--
-- Phase 2 adds orders that belong to no table: a waiter can ring up a "Take Out"
-- order on the handheld, and a customer can scan a single take-out QR (separate
-- from the per-table QRs) to place a parcel order that lands in the same staff
-- pending queue and pays at the counter.
--
-- orders.table_id is already nullable and orders.guest_name already exists, so
-- the only new column is order_type, which tells every screen whether to show a
-- table number or a "Takeout — <name>" label.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type VARCHAR(20) NOT NULL DEFAULT 'dine_in'
  CHECK (order_type IN ('dine_in', 'takeout'));

CREATE INDEX IF NOT EXISTS orders_order_type_idx ON orders (order_type);
