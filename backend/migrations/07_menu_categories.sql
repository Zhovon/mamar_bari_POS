-- ==========================================
-- MIGRATION 07: Managed menu categories
-- Run this against the live Neon database (after migration 06).
-- ==========================================
--
-- The menu category used to be a fixed CHECK list (Grill/Curry/Biryani/...),
-- which meant a new cuisine (Kichuri, Chowmein, Fried Rice, Chinese...) could
-- not be added without a schema change -- and any such insert was silently
-- rejected. This turns category into a first-class, restaurant-editable table
-- so managers can add/rename/reorder/hide categories from the dashboard, and
-- both the waiter POS and the customer QR menu can group + order by section.

-- 1. The category table. sort_order drives section order on every menu.
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Free the menu item category from its rigid CHECK list.
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_category_check;

-- 3. Point each item at a category row (the text column stays as a synced,
--    denormalised display name so existing consumers keep working untouched).
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES menu_categories(id);

-- 4. Seed the category table from whatever categories already exist, keeping a
--    stable, alphabetised order to start from.
INSERT INTO menu_categories (name, sort_order)
SELECT category, (ROW_NUMBER() OVER (ORDER BY category)) * 10
FROM (SELECT DISTINCT category FROM menu_items WHERE category IS NOT NULL AND category <> '') d
ON CONFLICT (name) DO NOTHING;

-- 5. Link existing items to their seeded category.
UPDATE menu_items m
SET category_id = c.id
FROM menu_categories c
WHERE m.category = c.name AND m.category_id IS NULL;

CREATE INDEX IF NOT EXISTS menu_items_category_id_idx ON menu_items (category_id);
