-- ==========================================
-- MIGRATION: Phase 6 (Inventory & Split Billing)
-- Run this in Adminer to update the live Neon database!
-- ==========================================

-- 7. Ingredients Table (Inventory)
CREATE TABLE IF NOT EXISTS ingredients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  unit VARCHAR(20) NOT NULL, -- e.g., 'g', 'ml', 'pcs'
  current_stock DECIMAL(10,2) NOT NULL DEFAULT 0,
  alert_threshold DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Recipes Table (Menu Item to Ingredient Mapping)
CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity_required DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Payments Table (Split Billing)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('Cash', 'Card', 'bKash', 'Nagad', 'Other')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: In Phase 6.2 we added "Paid" as a status, but orders.status is a VARCHAR(20) without an ENUM check constraint in the original schema, so no ALTER TABLE is needed for orders.status.
