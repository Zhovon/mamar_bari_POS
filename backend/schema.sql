-- Mamar Bari POS & CRM - PostgreSQL Schema

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users (Staff & Admin) Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'waiter', 'chef')),
  pin_code VARCHAR(10) NOT NULL UNIQUE, -- For quick POS login
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Customers (CRM) Table
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(100),
  loyalty_points INT DEFAULT 0,
  visit_count INT DEFAULT 0,
  last_visit TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tables Table
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_number INT NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Occupied', 'Billed')),
  capacity INT NOT NULL DEFAULT 4,
  session_version INT NOT NULL DEFAULT 1,
  -- Short, permanent, opaque code encoded in the QR printed for this table.
  -- Names the table only; it never authorises ordering on its own.
  qr_code VARCHAR(16) NOT NULL UNIQUE
);

-- 3a. Dining sessions: ONE shared session per table visit, so everyone at the
-- table sees a single combined bill.
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

CREATE UNIQUE INDEX IF NOT EXISTS table_sessions_one_open_per_table
  ON table_sessions (table_id) WHERE status = 'open';

-- 3b. One row per phone in a session. Splitting devices out from the session is
-- what lets a single phone be released (on review submit or dismiss) without
-- ending the visit for everyone else at the table.
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

CREATE UNIQUE INDEX IF NOT EXISTS session_devices_session_device_key
  ON session_devices (session_id, device_id);

-- 4. Menu Items Table
-- Restaurant-editable menu categories (Kichuri, Chowmein, Chinese, ...).
-- sort_order drives section order on the waiter POS and customer QR menus.
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL, -- denormalised display name, synced from category_id
  category_id UUID REFERENCES menu_categories(id),
  price DECIMAL(10,2) NOT NULL,
  image_url TEXT,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS menu_items_category_id_idx ON menu_items (category_id);

-- 5. Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id UUID REFERENCES restaurant_tables(id),
  table_session_id UUID REFERENCES table_sessions(id) NULL, -- NULL for staff-entered orders
  waiter_id UUID REFERENCES users(id),
  customer_id UUID REFERENCES customers(id) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Unconfirmed', 'Pending', 'Cooking', 'Ready', 'Served', 'Paid', 'Completed', 'Cancelled')),
  source VARCHAR(20) NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'qr')),
  order_type VARCHAR(20) NOT NULL DEFAULT 'dine_in' CHECK (order_type IN ('dine_in', 'takeout')),
  guest_name VARCHAR(100),
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id),
  quantity INT NOT NULL DEFAULT 1,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Cooking', 'Ready', 'Served')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('Cash', 'Card', 'bKash', 'Other')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Reviews Table (captured on the customer's phone once the bill is settled)
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
CREATE INDEX IF NOT EXISTS orders_table_session_id_idx ON orders (table_session_id);
