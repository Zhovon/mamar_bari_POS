require('dotenv').config();
const db = require('./db');

async function seedDatabase() {
  try {
    console.log('Seeding database...');
    
    // Seed Tables
    await db.query(`
      INSERT INTO restaurant_tables (table_number, capacity) VALUES 
      (1, 2), (2, 4), (3, 4), (4, 6), (5, 8)
      ON CONFLICT DO NOTHING;
    `);

    // Seed Menu Items
    await db.query(`
      INSERT INTO menu_items (name, category, price, image_url) VALUES 
      ('Chicken Tikka Kebab', 'Grill', 350.00, 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=500&q=80'),
      ('Mutton Seekh Kebab', 'Grill', 450.00, 'https://images.unsplash.com/photo-1603360946369-dc9bb6258143?w=500&q=80'),
      ('Mamar Bari Special Platter', 'Grill', 1200.00, 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500&q=80'),
      ('Chicken Biryani', 'Biryani', 280.00, 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&q=80'),
      ('Mutton Karahi', 'Curry', 550.00, 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=500&q=80'),
      ('Garlic Naan', 'Bread', 60.00, 'https://images.unsplash.com/photo-1626200419199-391ae4be7a41?w=500&q=80'),
      ('Mango Lassi', 'Beverage', 120.00, 'https://images.unsplash.com/photo-1615486171448-472e3a1050cc?w=500&q=80'),
      ('Grilled Prawns', 'Grill', 650.00, 'https://images.unsplash.com/photo-1559742811-822873691df8?w=500&q=80'),
      ('Mint Lemonade', 'Beverage', 80.00, 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&q=80')
      ON CONFLICT DO NOTHING;
    `);

    // Seed Staff
    await db.query(`
      INSERT INTO users (full_name, role, pin_code) VALUES 
      ('John Waiter', 'waiter', '1234'),
      ('Chef Rahim', 'chef', '8888'),
      ('Manager Boss', 'manager', '9999'),
      ('Admin Shifat', 'admin', '0000')
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding:', error);
    process.exit(1);
  }
}

seedDatabase();
