-- Migration 02: QR table ordering
-- Adds a customer-facing QR ordering flow where orders land as 'Unconfirmed'
-- and must be accepted by staff before they enter the kitchen queue.

-- 1. Track where an order came from.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'staff'
  CHECK (source IN ('staff', 'qr'));

-- 2. Add the 'Unconfirmed' pre-kitchen state to the orders status constraint.
--    (Live DB already allows Pending/Cooking/Ready/Served/Paid/Completed/Cancelled.)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'Unconfirmed', 'Pending', 'Cooking', 'Ready',
    'Served', 'Paid', 'Completed', 'Cancelled'
  ));

-- 3. Optional guest name captured at QR checkout when no customer record is linked.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS guest_name VARCHAR(100);
