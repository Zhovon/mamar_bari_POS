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
  session_version INT NOT NULL DEFAULT 1
);

-- 4. Menu Items Table
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('Grill', 'Curry', 'Biryani', 'Bread', 'Beverage', 'Dessert')),
  price DECIMAL(10,2) NOT NULL,
  image_url TEXT,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id UUID REFERENCES restaurant_tables(id),
  waiter_id UUID REFERENCES users(id),
  customer_id UUID REFERENCES customers(id) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Unconfirmed', 'Pending', 'Cooking', 'Ready', 'Served', 'Paid', 'Completed', 'Cancelled')),
  source VARCHAR(20) NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'qr')),
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
