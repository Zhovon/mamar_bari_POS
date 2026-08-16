const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
require('dotenv').config();

const db = require('./db');
const { makeTableToken, readTableToken, makeTableSession, readTableSession } = require('./tokens');

// Where the customer-facing ordering page lives (used to build QR links).
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_mamar_bari_key';

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token == null) return res.status(401).json({ error: "Missing Token" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid Token" });
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

const requireAdminOrManager = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return res.status(403).json({ error: "Manager access required" });
  }
  next();
};

// --- ROUTES ---

// 0. Health Check Route (For Uptime Robot)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// 1. Auth & Staff Route
app.post('/api/login', async (req, res) => {
  const { pin_code } = req.body;
  try {
    const { rows } = await db.query('SELECT id, full_name, role FROM users WHERE pin_code = $1', [pin_code]);
    if (rows.length > 0) {
      const user = rows[0];
      const token = jwt.sign({ id: user.id, role: user.role, name: user.full_name }, JWT_SECRET, { expiresIn: '12h' });
      res.json({ success: true, user, token });
    } else {
      res.status(401).json({ success: false, message: 'Invalid PIN' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Menu Routes (Protected)
app.get('/api/menu', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM menu_items ORDER BY category, name');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/menu', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { name, category, price, image_url } = req.body;
  try {
    const { rows } = await db.query(
      'INSERT INTO menu_items (name, category, price, image_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, category, price, image_url]
    );
    res.json({ success: true, item: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/menu/:id', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  const { name, category, price, image_url, is_available } = req.body;
  try {
    const { rows } = await db.query(
      'UPDATE menu_items SET name=$1, category=$2, price=$3, image_url=$4, is_available=$5 WHERE id=$6 RETURNING *',
      [name, category, price, image_url, is_available, id]
    );
    res.json({ success: true, item: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/menu/:id', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM menu_items WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// PHASE 6.1: INVENTORY & RECIPES
// ==========================================

// Get all ingredients
app.get('/api/inventory', authenticateToken, requireAdminOrManager, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM ingredients ORDER BY name');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new ingredient
app.post('/api/inventory', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { name, unit, current_stock, alert_threshold } = req.body;
  try {
    const { rows } = await db.query(
      'INSERT INTO ingredients (name, unit, current_stock, alert_threshold) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, unit, current_stock || 0, alert_threshold || 0]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update ingredient
app.put('/api/inventory/:id', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  const { name, unit, current_stock, alert_threshold } = req.body;
  try {
    const { rows } = await db.query(
      'UPDATE ingredients SET name=$1, unit=$2, current_stock=$3, alert_threshold=$4 WHERE id=$5 RETURNING *',
      [name, unit, current_stock, alert_threshold, id]
    );
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete ingredient
app.delete('/api/inventory/:id', authenticateToken, requireAdminOrManager, async (req, res) => {
  try {
    await db.query('DELETE FROM ingredients WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recipes for a menu item
app.get('/api/menu/:id/recipes', authenticateToken, requireAdminOrManager, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT r.id, r.ingredient_id, r.quantity_required, i.name, i.unit 
      FROM recipes r
      JOIN ingredients i ON r.ingredient_id = i.id
      WHERE r.menu_item_id = $1
    `, [req.params.id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add recipe mapping
app.post('/api/menu/:id/recipes', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { ingredient_id, quantity_required } = req.body;
  try {
    const { rows } = await db.query(
      'INSERT INTO recipes (menu_item_id, ingredient_id, quantity_required) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, ingredient_id, quantity_required]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete recipe mapping
app.delete('/api/recipes/:id', authenticateToken, requireAdminOrManager, async (req, res) => {
  try {
    await db.query('DELETE FROM recipes WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Tables Route (Protected)
app.get('/api/tables', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM restaurant_tables ORDER BY table_number');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3a. Add a new table (Admin/Manager only)
app.post('/api/tables', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { table_number, capacity } = req.body;
  if (!table_number) return res.status(400).json({ error: 'Table number is required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO restaurant_tables (table_number, capacity) VALUES ($1, $2) RETURNING *',
      [table_number, capacity || 4]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') { // unique violation
      return res.status(400).json({ error: 'Table number already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// 3b. Get a printable QR token for a table (Staff only)
app.get('/api/tables/:id/qr', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT id, table_number FROM restaurant_tables WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Table not found' });
    const token = makeTableToken(rows[0].id);
    res.json({
      table_number: rows[0].table_number,
      token,
      url: `${FRONTEND_URL}/order?t=${token}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PUBLIC QR ORDERING (no staff login) -- table identity is ALWAYS taken from a
// signed token, never from a URL param or request body, so a customer cannot
// order for a different table by editing the link or the payload.
// ============================================================================

// P1. Exchange a table QR token for a short-lived ordering session.
app.post('/api/public/table-session', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing table token' });
  let tableId;
  try {
    tableId = readTableToken(token); // verifies signature; throws if tampered
  } catch {
    return res.status(401).json({ error: 'Invalid or tampered table code' });
  }
  try {
    const { rows } = await db.query('SELECT table_number, session_version FROM restaurant_tables WHERE id = $1', [tableId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Table not found' });
    res.json({ session: makeTableSession(tableId, rows[0].session_version), table_number: rows[0].table_number, table_id: tableId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// P2. Public menu (available items only, no auth).
app.get('/api/public/menu', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, category, price, image_url FROM menu_items WHERE is_available = TRUE ORDER BY category, name'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// P3. Place a QR order. Lands as 'Unconfirmed' pending staff acceptance.
app.post('/api/public/orders', async (req, res) => {
  const { session, items, name, phone } = req.body;

  // Table id comes ONLY from the verified session -- ignore any client table_id.
  let tableId;
  let sessionVersion;
  try {
    const payload = readTableSession(session);
    tableId = payload.tableId;
    sessionVersion = payload.sessionVersion;
  } catch {
    return res.status(401).json({ error: 'Session expired -- please rescan the table QR' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Your order is empty' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Verify session version hasn't changed
    const { rows: tableRows } = await client.query('SELECT session_version FROM restaurant_tables WHERE id = $1', [tableId]);
    if (tableRows.length === 0 || tableRows[0].session_version !== sessionVersion) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Session expired -- please rescan the table QR' });
    }

    // Server-side pricing: never trust prices from the client.
    const ids = items.map((i) => i.menu_item_id);
    const { rows: priced } = await client.query(
      'SELECT id, price FROM menu_items WHERE id = ANY($1) AND is_available = TRUE',
      [ids]
    );
    const priceById = Object.fromEntries(priced.map((r) => [r.id, parseFloat(r.price)]));

    let subtotal = 0;
    const lines = [];
    for (const i of items) {
      const price = priceById[i.menu_item_id];
      const qty = parseInt(i.quantity, 10);
      if (price === undefined || !Number.isFinite(qty) || qty < 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'One or more items are unavailable' });
      }
      subtotal += price * qty;
      lines.push({ menu_item_id: i.menu_item_id, quantity: qty, notes: (i.notes || '').slice(0, 200) });
    }

    // Optional CRM link: upsert the customer if a phone was given.
    let customerId = null;
    if (phone && phone.trim()) {
      const { rows: cust } = await client.query(
        `INSERT INTO customers (phone_number, full_name)
         VALUES ($1, $2)
         ON CONFLICT (phone_number) DO UPDATE
           SET full_name = COALESCE(EXCLUDED.full_name, customers.full_name),
               visit_count = customers.visit_count + 1,
               last_visit = NOW()
         RETURNING id`,
        [phone.trim(), name ? name.trim() : null]
      );
      customerId = cust[0].id;
    }

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (table_id, customer_id, guest_name, subtotal, discount, total, status, source)
       VALUES ($1, $2, $3, $4, 0, $4, 'Unconfirmed', 'qr') RETURNING id`,
      [tableId, customerId, name ? name.trim() : null, subtotal]
    );
    const orderId = orderRows[0].id;

    for (const l of lines) {
      await client.query(
        'INSERT INTO order_items (order_id, menu_item_id, quantity, notes, status) VALUES ($1, $2, $3, $4, $5)',
        [orderId, l.menu_item_id, l.quantity, l.notes, 'Pending']
      );
    }
    await client.query('COMMIT');

    io.emit('qr_order_pending', { orderId, tableId });
    res.json({ success: true, order_id: orderId, total: subtotal });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// P4. Staff: list QR orders awaiting confirmation.
app.get('/api/orders/pending-confirmation', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT
        o.id as order_id, o.total, o.guest_name, o.created_at,
        t.table_number,
        json_agg(json_build_object('name', m.name, 'quantity', oi.quantity, 'notes', oi.notes)) as items
      FROM orders o
      JOIN restaurant_tables t ON o.table_id = t.id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE o.status = 'Unconfirmed' AND o.source = 'qr'
      GROUP BY o.id, t.table_number
      ORDER BY o.created_at ASC;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: Deduct inventory stock for an order
const deductInventoryForOrder = async (orderId, client) => {
  const { rows: items } = await client.query('SELECT menu_item_id, quantity FROM order_items WHERE order_id = $1', [orderId]);
  for (let item of items) {
    const { rows: recipes } = await client.query('SELECT ingredient_id, quantity_required FROM recipes WHERE menu_item_id = $1', [item.menu_item_id]);
    for (let recipe of recipes) {
      const totalRequired = recipe.quantity_required * item.quantity;
      await client.query('UPDATE ingredients SET current_stock = current_stock - $1 WHERE id = $2', [totalRequired, recipe.ingredient_id]);
    }
  }
};

// P5. Staff: accept a QR order -> enters the kitchen queue.
app.post('/api/orders/:id/confirm', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE orders SET status = 'Pending', waiter_id = $1 WHERE id = $2 AND status = 'Unconfirmed' RETURNING *",
      [req.user.id, id]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found or already handled' });
    }
    await client.query("UPDATE restaurant_tables SET status = 'Occupied' WHERE id = $1", [rows[0].table_id]);
    
    // Phase 6.1: Deduct inventory
    await deductInventoryForOrder(id, client);
    
    await client.query('COMMIT');
    io.emit('new_order', { orderId: id, tableId: rows[0].table_id });
    res.json({ success: true, order: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// P6. Staff: reject a QR order.
app.post('/api/orders/:id/reject', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      "UPDATE orders SET status = 'Cancelled' WHERE id = $1 AND status = 'Unconfirmed' RETURNING *",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found or already handled' });
    io.emit('order_status_updated', rows[0]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Create Order (Protected)
app.post('/api/orders', authenticateToken, async (req, res) => {
  const { table_id, customer_id, items, subtotal, discount, total } = req.body;
  const waiter_id = req.user.id; // Get from JWT
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      'INSERT INTO orders (table_id, waiter_id, customer_id, subtotal, discount, total, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [table_id, waiter_id, customer_id, subtotal, discount, total, 'Pending']
    );
    const order = orderRes.rows[0];

    for (let item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, menu_item_id, quantity, notes, status) VALUES ($1, $2, $3, $4, $5)',
        [order.id, item.menu_item_id, item.quantity, item.notes, 'Pending']
      );
    }
    await client.query("UPDATE restaurant_tables SET status = 'Occupied' WHERE id = $1", [table_id]);
    
    // Phase 6.1: Deduct inventory
    await deductInventoryForOrder(order.id, client);

    await client.query('COMMIT');
    
    io.emit('new_order', { orderId: order.id, tableId: table_id });
    res.json({ success: true, order });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// 5. Update Order Status (Protected)
app.put('/api/orders/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const { rows } = await db.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    if (rows.length > 0) {
      if (status === 'Ready') {
        await db.query("UPDATE order_items SET status = 'Ready' WHERE order_id = $1", [id]);
      } else if (status === 'Completed') {
        await db.query("UPDATE restaurant_tables SET status = 'Available', session_version = session_version + 1 WHERE id = $1", [rows[0].table_id]);
        io.emit('table_cleared', { tableId: rows[0].table_id });
      }
      io.emit('order_status_updated', rows[0]);
      res.json({ success: true, order: rows[0] });
    } else {
      res.status(404).json({ error: 'Order not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// PHASE 6.2: SPLIT BILLING (PAYMENTS)
// ==========================================

// Get payments for an order
app.get('/api/orders/:id/payments', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at ASC', [req.params.id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a payment to an order
app.post('/api/orders/:id/payments', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { amount, payment_method } = req.body;
  
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // Insert the payment
    const { rows: paymentRows } = await client.query(
      'INSERT INTO payments (order_id, amount, payment_method) VALUES ($1, $2, $3) RETURNING *',
      [id, amount, payment_method]
    );
    
    // Calculate total paid vs order total
    const { rows: orderRows } = await client.query('SELECT total, table_id FROM orders WHERE id = $1', [id]);
    const { rows: sumRows } = await client.query('SELECT SUM(amount) as total_paid FROM payments WHERE order_id = $1', [id]);
    
    const totalPaid = parseFloat(sumRows[0].total_paid || 0);
    const orderTotal = parseFloat(orderRows[0].total || 0);
    
    let isFullyPaid = false;
    if (totalPaid >= orderTotal) {
      // Auto-update order to Paid if fully covered
      await client.query("UPDATE orders SET status = 'Paid' WHERE id = $1 AND status != 'Completed'", [id]);
      isFullyPaid = true;
    }
    
    await client.query('COMMIT');
    
    // Notify clients of status change if it became fully paid
    if (isFullyPaid) {
      io.emit('order_status_updated', { id, status: 'Paid', table_id: orderRows[0].table_id });
    }
    
    res.status(201).json({
      success: true,
      payment: paymentRows[0],
      totalPaid,
      orderTotal,
      isFullyPaid
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// 6. Kitchen Display Queue (Protected)
app.get('/api/kitchen/queue', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        o.id as order_id, t.table_number, o.status as order_status, o.created_at,
        json_agg(json_build_object('item_id', oi.id, 'name', m.name, 'category', m.category, 'quantity', oi.quantity, 'notes', oi.notes, 'status', oi.status)) as items
      FROM orders o
      JOIN restaurant_tables t ON o.table_id = t.id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE o.status IN ('Pending', 'Cooking')
      GROUP BY o.id, t.table_number, o.status, o.created_at
      ORDER BY o.created_at ASC;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Waiter Active Orders (Protected)
app.get('/api/waiter/orders', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT o.id as order_id, t.table_number, o.status, o.created_at
      FROM orders o
      JOIN restaurant_tables t ON o.table_id = t.id
      WHERE o.status IN ('Pending', 'Cooking', 'Ready')
      ORDER BY o.created_at DESC;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Manager Dashboard (Protected)
app.get('/api/manager/dashboard', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        t.id as table_id, t.table_number, t.status as table_status,
        o.id as order_id, o.status as order_status, o.total
      FROM restaurant_tables t
      LEFT JOIN orders o ON t.id = o.table_id AND o.status IN ('Pending', 'Cooking', 'Ready', 'Served')
      ORDER BY t.table_number;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Fetch Order Receipt (Protected)
app.get('/api/orders/:id/receipt', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const orderQuery = `
      SELECT o.*, t.table_number, u.full_name as waiter_name 
      FROM orders o 
      JOIN restaurant_tables t ON o.table_id = t.id 
      LEFT JOIN users u ON o.waiter_id = u.id
      WHERE o.id = $1
    `;
    const orderRes = await db.query(orderQuery, [id]);
    if(orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    
    const itemsQuery = `
      SELECT oi.quantity, m.name, m.price, (oi.quantity * m.price) as subtotal
      FROM order_items oi
      JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE oi.order_id = $1
    `;
    const itemsRes = await db.query(itemsQuery, [id]);
    
    const receipt = {
      ...orderRes.rows[0],
      items: itemsRes.rows
    };
    res.json(receipt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. ADMIN TERMINAL EXECUTION (Protected by JWT & Admin Role)
app.post('/api/admin/terminal', authenticateToken, requireAdmin, (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'No command provided' });

  // Extremely dangerous in production without proper sanitization/containerization. 
  // Since this is explicitly requested for the admin to inspect the system, we execute it.
  exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
    res.json({
      output: stdout || stderr,
      error: error ? error.message : null
    });
  });
});

// Socket.IO Connection Handler (Also optionally secure this later, but leave open for now)
io.on('connection', (socket) => {
  console.log(`[Socket] A client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Mamar Bari Backend Server running on port ${PORT}`);
});
