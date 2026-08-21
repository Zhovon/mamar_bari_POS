const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
require('dotenv').config();

const db = require('./db');
const {
  generateTableCode,
  looksLikeTableCode,
  readTableToken,
  makeTableSession,
  readTableSession,
} = require('./tokens');

// Where the customer-facing ordering page lives (used to build QR links).
// The fallback is PRODUCTION on purpose: table QRs get printed and laminated, so a
// missing env var must never silently bake "localhost" into a sticker. For local
// dev, set FRONTEND_URL=http://localhost:5173 in backend/.env.
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mamar-bari-pos.vercel.app';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Render (and Vercel) put the app behind one reverse proxy. Without this,
// req.ip is the proxy's address for every request, which would make the public
// rate limits apply to the whole restaurant at once.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_mamar_bari_key';

// Every staff login and every customer session is signed with this. Booting
// production on the public fallback would let anyone mint an admin token.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start in production.');
  process.exit(1);
}

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

// Staff sign in with a 4-digit PIN -- only 10,000 combinations, so without a
// limit an attacker can simply try them all and walk in as admin.
//
// This throttles WRONG PINs only, and is applied after the PIN is checked (see
// below) so a correct PIN always gets through. That matters here: the whole
// restaurant shares one public IP, so a limiter placed in front of the handler
// would let one person fumbling their PIN lock every till on the floor.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many failed sign-in attempts. Please wait a few minutes.' },
});

// 1. Auth & Staff Route
app.post('/api/login', async (req, res) => {
  const { pin_code } = req.body;
  try {
    const { rows } = await db.query('SELECT id, full_name, role FROM users WHERE pin_code = $1', [pin_code]);
    if (rows.length > 0) {
      // Correct PIN: never throttled, so staff can always reach the POS.
      const user = rows[0];
      const token = jwt.sign({ id: user.id, role: user.role, name: user.full_name }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ success: true, user, token });
    }
    // Wrong PIN: count it. Once the limit is hit the limiter answers with 429
    // itself and never reaches the callback.
    loginLimiter(req, res, () => {
      res.status(401).json({ success: false, message: 'Invalid PIN' });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Menu Routes (Protected)
// Resolve a menu item's category from either a category_id (preferred) or a
// raw name (find-or-create, so the manager form can add a category inline).
// Returns { id, name } or null when nothing usable was supplied.
async function resolveCategory({ category_id, category }, runner = db) {
  if (category_id) {
    const { rows } = await runner.query('SELECT id, name FROM menu_categories WHERE id = $1', [category_id]);
    return rows[0] || null;
  }
  if (category && category.trim()) {
    const { rows } = await runner.query(
      `INSERT INTO menu_categories (name, sort_order)
       VALUES ($1, COALESCE((SELECT MAX(sort_order) FROM menu_categories), 0) + 10)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`,
      [category.trim()]
    );
    return rows[0] || null;
  }
  return null;
}

app.get('/api/menu', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.*, COALESCE(c.sort_order, 999999) AS category_sort
       FROM menu_items m
       LEFT JOIN menu_categories c ON c.id = m.category_id
       ORDER BY category_sort, m.category, m.name`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/menu', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { name, price, image_url } = req.body;
  try {
    const cat = await resolveCategory(req.body);
    if (!cat) return res.status(400).json({ error: 'A valid category is required' });
    const { rows } = await db.query(
      'INSERT INTO menu_items (name, category, category_id, price, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, cat.name, cat.id, price, image_url]
    );
    io.emit('menu_updated'); // tell open customer phones + POS to re-fetch
    res.json({ success: true, item: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/menu/:id', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  const { name, price, image_url, is_available } = req.body;
  try {
    const cat = await resolveCategory(req.body);
    if (!cat) return res.status(400).json({ error: 'A valid category is required' });
    const { rows } = await db.query(
      'UPDATE menu_items SET name=$1, category=$2, category_id=$3, price=$4, image_url=$5, is_available=$6 WHERE id=$7 RETURNING *',
      [name, cat.name, cat.id, price, image_url, is_available, id]
    );
    io.emit('menu_updated');
    res.json({ success: true, item: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/menu/:id', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM menu_items WHERE id=$1', [id]);
    io.emit('menu_updated');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Menu categories (managed by Admin/Manager) --------------------------
app.get('/api/categories', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM menu_categories ORDER BY sort_order, name');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/categories', authenticateToken, requireAdminOrManager, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO menu_categories (name, sort_order)
       VALUES ($1, COALESCE((SELECT MAX(sort_order) FROM menu_categories), 0) + 10)
       RETURNING *`,
      [name]
    );
    io.emit('menu_updated');
    res.json({ success: true, category: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That category already exists' });
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/categories/:id', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  const { name, sort_order, is_active } = req.body;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE menu_categories
       SET name = COALESCE($2, name),
           sort_order = COALESCE($3, sort_order),
           is_active = COALESCE($4, is_active)
       WHERE id = $1 RETURNING *`,
      [id, name ? name.trim() : null, sort_order ?? null, typeof is_active === 'boolean' ? is_active : null]
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Category not found' }); }
    // Keep the denormalised name on items in sync when a category is renamed.
    if (name && name.trim()) {
      await client.query('UPDATE menu_items SET category = $2 WHERE category_id = $1', [id, name.trim()]);
    }
    await client.query('COMMIT');
    io.emit('menu_updated');
    res.json({ success: true, category: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'That category already exists' });
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.delete('/api/categories/:id', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM menu_items WHERE category_id = $1', [id]);
    if (rows[0].n > 0) {
      return res.status(409).json({ error: `Cannot delete: ${rows[0].n} item(s) still use this category. Reassign or move them first.` });
    }
    await db.query('DELETE FROM menu_categories WHERE id = $1', [id]);
    io.emit('menu_updated');
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
      'INSERT INTO restaurant_tables (table_number, capacity, qr_code) VALUES ($1, $2, $3) RETURNING *',
      [table_number, capacity || 4, generateTableCode()]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') { // unique violation
      return res.status(400).json({ error: 'Table number already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// 3b. Get the printable QR link for a table (Staff only).
// The code is permanent -- printing the same table twice yields the same link,
// so a reprint always matches the sticker already on the table.
app.get('/api/tables/:id/qr', authenticateToken, requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT table_number, qr_code FROM restaurant_tables WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Table not found' });
    res.json({
      table_number: rows[0].table_number,
      token: rows[0].qr_code,
      url: `${FRONTEND_URL}/order?t=${rows[0].qr_code}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3c. Rotate a table's code (Admin only). Use when a sticker is photographed or
// copied: the old printed QR stops working immediately and only THIS table
// needs reprinting.
app.post('/api/tables/:id/qr/rotate', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Retry on the (vanishingly rare) unique collision rather than failing.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateTableCode();
      try {
        const { rows } = await db.query(
          'UPDATE restaurant_tables SET qr_code = $1 WHERE id = $2 RETURNING table_number, qr_code',
          [code, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Table not found' });
        return res.json({
          table_number: rows[0].table_number,
          token: rows[0].qr_code,
          url: `${FRONTEND_URL}/order?t=${rows[0].qr_code}`,
        });
      } catch (err) {
        if (err.code !== '23505') throw err; // not a collision -- real failure
      }
    }
    res.status(500).json({ error: 'Could not allocate a unique code, please retry' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PUBLIC QR ORDERING (no staff login) -- table identity is ALWAYS resolved
// server-side from the scanned code, never taken from a URL param or request
// body, so a customer cannot order for a different table by editing the link
// or the payload.
//
// Session model: ONE shared session per table visit (everyone at the table
// sees one combined bill) with a row per phone that joined it. Releasing a
// single phone -- when its owner submits or dismisses the review -- leaves the
// shared session and their friends' phones untouched.
// ============================================================================

// A phone that never talks to us again shouldn't be able to hold a table's
// session open forever. Rather than run a background sweeper, we check staleness
// at join time: an untouched session on a table staff have already freed is
// abandoned, so the next scan starts fresh instead of inheriting its bill.
const STALE_SESSION_HOURS = 6;

// Public endpoints are unauthenticated and internet-facing. Without a limit,
// anyone who scans one sticker can flood the kitchen queue.
//
// Keyed by phone rather than by IP: every guest on the restaurant's wifi shares
// one public address, so an IP-keyed limit would have the whole dining room
// competing for a single bucket. IP is only the fallback.
const phoneKey = (req) => {
  const bodyDevice = req.body && typeof req.body.device_id === 'string' ? req.body.device_id : null;
  const header = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  return bodyDevice || header || ipKeyGenerator(req.ip);
};

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: phoneKey,
  message: { error: 'Too many requests, please slow down.' },
});
const publicOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: phoneKey,
  message: { error: 'Too many orders in a row, please wait a moment.' },
});
app.use('/api/public', publicLimiter);

// Resolve a scanned code to a table. Accepts the short printed code, and falls
// back to the legacy JWT format so stickers printed before migration 05 keep
// working. Returns null when the code names no table.
async function resolveScannedCode(code) {
  if (typeof code !== 'string' || !code.trim()) return null;
  const value = code.trim();

  if (looksLikeTableCode(value)) {
    const { rows } = await db.query(
      'SELECT id, table_number, status FROM restaurant_tables WHERE qr_code = $1',
      [value.toUpperCase()]
    );
    if (rows.length > 0) return rows[0];
    // Fall through: an 8-char string could still be a (malformed) legacy token.
  }

  try {
    const tableId = readTableToken(value); // verifies signature; throws if tampered
    const { rows } = await db.query(
      'SELECT id, table_number, status FROM restaurant_tables WHERE id = $1',
      [tableId]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

// The guest's bill is everything ordered at their table since the session
// opened -- including orders a waiter punched in at the POS, which carry no
// session id. Anything else would show the guest a bill that doesn't match the
// one staff are collecting on.
async function getSessionBill(sessionId, runner = db) {
  const { rows: sess } = await runner.query(
    'SELECT id, table_id, opened_at FROM table_sessions WHERE id = $1',
    [sessionId]
  );
  if (sess.length === 0) return null;
  const { table_id: tableId, opened_at: openedAt } = sess[0];

  const { rows: orders } = await runner.query(
    `SELECT
       o.id, o.status, o.total, o.source, o.created_at,
       json_agg(json_build_object(
         'name', m.name, 'quantity', oi.quantity, 'notes', oi.notes, 'status', oi.status
       ) ORDER BY m.name) AS items
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN menu_items m ON m.id = oi.menu_item_id
     WHERE o.table_id = $1 AND o.created_at >= $2 AND o.status <> 'Cancelled'
     GROUP BY o.id
     ORDER BY o.created_at ASC`,
    [tableId, openedAt]
  );

  const { rows: paidRows } = await runner.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS paid
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE o.table_id = $1 AND o.created_at >= $2 AND o.status <> 'Cancelled'`,
    [tableId, openedAt]
  );

  const total = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
  const paid = parseFloat(paidRows[0].paid || 0);
  return {
    orders,
    total,
    paid,
    due: Math.max(0, total - paid),
    // Only a table that actually ordered something can be "settled".
    settled: total > 0 && paid >= total,
  };
}

// The open session on a table, if any. Staff actions look this up so the phones
// at that table hear about confirmations, payments and checkout.
async function findOpenSessionId(tableId, runner = db) {
  if (!tableId) return null;
  const { rows } = await runner.query(
    "SELECT id FROM table_sessions WHERE table_id = $1 AND status = 'open'",
    [tableId]
  );
  return rows.length > 0 ? rows[0].id : null;
}

// Tell every phone at this table that something changed, and -- when the bill
// is fully settled -- that it is time to ask for a review.
async function notifyTableSession(tableId, reason) {
  try {
    const sessionId = await findOpenSessionId(tableId);
    if (!sessionId) return;
    io.to(`session:${sessionId}`).emit('session_updated', { reason });

    const bill = await getSessionBill(sessionId);
    if (bill && bill.settled) {
      io.to(`session:${sessionId}`).emit('bill_paid', { total: bill.total, paid: bill.paid });
    }
  } catch (error) {
    console.error('[Session] Failed to notify table session:', error.message);
  }
}

// Rejects unless BOTH the shared session is open AND this phone is still a live
// member of it. The DB rows are the authority -- that is what makes releasing a
// single device take effect on its very next request.
async function requireActiveSession(req, res, next) {
  const header = req.headers['authorization'] || '';
  const raw = header.replace(/^Bearer\s+/i, '').trim() || (req.body && req.body.session);
  if (!raw) return res.status(401).json({ error: 'Missing session', code: 'NO_SESSION' });

  let payload;
  try {
    payload = readTableSession(raw);
  } catch {
    return res.status(401).json({ error: 'Your session has ended -- please scan the table QR again.', code: 'SESSION_ENDED' });
  }

  try {
    const { rows } = await db.query(
      `SELECT d.id AS device_row_id, d.device_id, d.status AS device_status, d.closed_reason,
              s.id AS session_id, s.table_id, s.status AS session_status,
              t.table_number
       FROM session_devices d
       JOIN table_sessions s ON s.id = d.session_id
       JOIN restaurant_tables t ON t.id = s.table_id
       WHERE d.id = $1 AND d.session_id = $2`,
      [payload.deviceRowId, payload.sessionId]
    );
    if (rows.length === 0 || rows[0].session_status !== 'open' || rows[0].device_status !== 'active') {
      return res.status(401).json({
        error: 'Your session has ended -- please scan the table QR again.',
        code: 'SESSION_ENDED',
      });
    }
    req.tableSession = rows[0];
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Release one phone from the session. The shared session stays open for
// everyone else; only staff checkout closes that.
async function closeDevice(deviceRowId, reason, runner = db) {
  await runner.query(
    `UPDATE session_devices
     SET status = 'closed', closed_at = NOW(), closed_reason = $2
     WHERE id = $1 AND status = 'active'`,
    [deviceRowId, reason]
  );
}

// P1. Scan a table QR -> join (or open) that table's shared session.
app.post('/api/public/session', async (req, res) => {
  const { code, device_id } = req.body;
  if (typeof device_id !== 'string' || device_id.length < 8 || device_id.length > 64) {
    return res.status(400).json({ error: 'Missing device id' });
  }

  const table = await resolveScannedCode(code);
  if (!table) return res.status(401).json({ error: 'Invalid table code -- please scan the QR printed on your table.' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Lock the table row so two phones scanning at once cannot open two
    // sessions for the same table.
    const { rows: locked } = await client.query(
      'SELECT id, table_number, status FROM restaurant_tables WHERE id = $1 FOR UPDATE',
      [table.id]
    );

    const { rows: open } = await client.query(
      `SELECT id, last_activity_at FROM table_sessions
       WHERE table_id = $1 AND status = 'open'`,
      [table.id]
    );

    let sessionId;
    if (open.length > 0) {
      const ageHours = (Date.now() - new Date(open[0].last_activity_at).getTime()) / 3600000;
      const abandoned = locked[0].status === 'Available' && ageHours > STALE_SESSION_HOURS;
      if (abandoned) {
        await client.query(
          `UPDATE table_sessions
           SET status = 'closed', closed_at = NOW(), closed_reason = 'stale'
           WHERE id = $1`,
          [open[0].id]
        );
        await client.query(
          `UPDATE session_devices SET status = 'closed', closed_at = NOW(), closed_reason = 'table_closed'
           WHERE session_id = $1 AND status = 'active'`,
          [open[0].id]
        );
      } else {
        sessionId = open[0].id;
      }
    }

    if (!sessionId) {
      const { rows } = await client.query(
        'INSERT INTO table_sessions (table_id) VALUES ($1) RETURNING id',
        [table.id]
      );
      sessionId = rows[0].id;
    }

    // Rescanning resumes the same membership rather than fragmenting the visit
    // across half-sessions -- and lets a phone that already reviewed come back
    // for dessert, since the printed QR is proof they are still at the table.
    const { rows: device } = await client.query(
      `INSERT INTO session_devices (session_id, device_id)
       VALUES ($1, $2)
       ON CONFLICT (session_id, device_id) DO UPDATE
         SET status = 'active', closed_at = NULL, closed_reason = NULL
       RETURNING id`,
      [sessionId, device_id]
    );

    await client.query('UPDATE table_sessions SET last_activity_at = NOW() WHERE id = $1', [sessionId]);
    await client.query('COMMIT');

    res.json({
      session: makeTableSession({ sessionId, deviceRowId: device[0].id, tableId: table.id }),
      session_id: sessionId,
      table_id: table.id,
      table_number: locked[0].table_number,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// P1b. Live state for the phone: every order on the table this visit, plus the
// running bill. Drives the tracking screen and the review prompt.
app.get('/api/public/session/state', requireActiveSession, async (req, res) => {
  try {
    const bill = await getSessionBill(req.tableSession.session_id);
    if (!bill) return res.status(404).json({ error: 'Session not found' });

    const { rows: reviewed } = await db.query(
      'SELECT 1 FROM reviews WHERE session_id = $1 AND device_id = $2 LIMIT 1',
      [req.tableSession.session_id, req.tableSession.device_id]
    );

    res.json({
      table_number: req.tableSession.table_number,
      ...bill,
      already_reviewed: reviewed.length > 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// P1c. Customer taps "End / Leave" -- releases THIS phone only.
app.post('/api/public/session/leave', requireActiveSession, async (req, res) => {
  try {
    await closeDevice(req.tableSession.device_row_id, 'left');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// P1d. Ask a waiter to come with the bill.
app.post('/api/public/session/request-bill', requireActiveSession, async (req, res) => {
  io.emit('bill_requested', {
    tableId: req.tableSession.table_id,
    tableNumber: req.tableSession.table_number,
    sessionId: req.tableSession.session_id,
  });
  res.json({ success: true });
});

// P1e. Leave a review. Saving it releases this phone -- the token stops working
// on its next request, while the rest of the table carries on.
app.post('/api/public/reviews', requireActiveSession, async (req, res) => {
  const { rating, comment } = req.body;
  const stars = parseInt(rating, 10);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Please choose a rating from 1 to 5' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Attribute to the most recent order of this visit, and to whichever
    // customer the visit identified -- a phone number given on the FIRST order
    // still counts, so reviews feed the CRM even when later rounds were
    // ordered anonymously.
    const { rows: lastOrder } = await client.query(
      `SELECT o.id, o.customer_id, s.customer_id AS session_customer_id
       FROM table_sessions s
       LEFT JOIN LATERAL (
         SELECT id, customer_id FROM orders
         WHERE table_id = s.table_id AND created_at >= s.opened_at AND status <> 'Cancelled'
         ORDER BY created_at DESC LIMIT 1
       ) o ON TRUE
       WHERE s.id = $1`,
      [req.tableSession.session_id]
    );
    const row = lastOrder[0] || {};

    await client.query(
      `INSERT INTO reviews (session_id, device_id, table_id, order_id, customer_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.tableSession.session_id,
        req.tableSession.device_id,
        req.tableSession.table_id,
        row.id || null,
        row.session_customer_id || row.customer_id || null,
        stars,
        (comment || '').trim().slice(0, 1000) || null,
      ]
    );
    await closeDevice(req.tableSession.device_row_id, 'review_submitted', client);
    await client.query('COMMIT');

    io.emit('review_submitted', { tableId: req.tableSession.table_id, rating: stars });
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// P1f. Dismiss the review -- same release, no review row written.
app.post('/api/public/reviews/skip', requireActiveSession, async (req, res) => {
  try {
    await closeDevice(req.tableSession.device_row_id, 'review_skipped');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// P2. Public menu (available items only, no auth).
app.get('/api/public/menu', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.id, m.name, m.category, m.category_id, m.price, m.image_url,
              COALESCE(c.sort_order, 999999) AS category_sort
       FROM menu_items m
       LEFT JOIN menu_categories c ON c.id = m.category_id
       WHERE m.is_available = TRUE AND (c.is_active IS DISTINCT FROM FALSE)
       ORDER BY category_sort, m.category, m.name`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// P3. Place a QR order. Lands as 'Unconfirmed' pending staff acceptance.
// A session can place as many orders as it likes across the visit.
app.post('/api/public/orders', publicOrderLimiter, requireActiveSession, async (req, res) => {
  const { items, name, phone } = req.body;

  // Table id comes ONLY from the verified session -- ignore any client table_id.
  const tableId = req.tableSession.table_id;
  const sessionId = req.tableSession.session_id;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Your order is empty' });
  }
  if (items.length > 40) {
    return res.status(400).json({ error: 'That is too many items for one order' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

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
      if (price === undefined || !Number.isFinite(qty) || qty < 1 || qty > 50) {
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
      // Remember the diner on the shared session so later orders and the review
      // attach to the same CRM record.
      await client.query(
        'UPDATE table_sessions SET customer_id = COALESCE(customer_id, $2) WHERE id = $1',
        [sessionId, customerId]
      );
    }

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (table_id, table_session_id, customer_id, guest_name, subtotal, discount, total, status, source)
       VALUES ($1, $2, $3, $4, $5, 0, $5, 'Unconfirmed', 'qr') RETURNING id`,
      [tableId, sessionId, customerId, name ? name.trim() : null, subtotal]
    );
    const orderId = orderRows[0].id;

    for (const l of lines) {
      await client.query(
        'INSERT INTO order_items (order_id, menu_item_id, quantity, notes, status) VALUES ($1, $2, $3, $4, $5)',
        [orderId, l.menu_item_id, l.quantity, l.notes, 'Pending']
      );
    }
    if (name && name.trim()) {
      await client.query('UPDATE session_devices SET guest_name = $2 WHERE id = $1', [
        req.tableSession.device_row_id, name.trim().slice(0, 100),
      ]);
    }
    await client.query('UPDATE table_sessions SET last_activity_at = NOW() WHERE id = $1', [sessionId]);
    await client.query('COMMIT');

    io.emit('qr_order_pending', { orderId, tableId });
    io.to(`session:${sessionId}`).emit('session_updated', { reason: 'order_placed' });
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
    notifyTableSession(rows[0].table_id, 'order_confirmed');
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
    notifyTableSession(rows[0].table_id, 'order_rejected');
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
        // Checking the table out ends the visit for everyone still on it.
        const sessionId = await findOpenSessionId(rows[0].table_id);
        if (sessionId) {
          await db.query(
            `UPDATE session_devices SET status = 'closed', closed_at = NOW(), closed_reason = 'table_closed'
             WHERE session_id = $1 AND status = 'active'`,
            [sessionId]
          );
          await db.query(
            `UPDATE table_sessions SET status = 'closed', closed_at = NOW(), closed_reason = 'staff_checkout'
             WHERE id = $1`,
            [sessionId]
          );
          io.to(`session:${sessionId}`).emit('session_closed', { reason: 'staff_checkout' });
        }
        io.emit('table_cleared', { tableId: rows[0].table_id });
      }
      io.emit('order_status_updated', rows[0]);
      if (status !== 'Completed') notifyTableSession(rows[0].table_id, 'order_status');
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

    // Recomputed against the WHOLE table bill, not just this order: with several
    // orders on one table, settling the first one must not pop the review while
    // the guests are still eating.
    notifyTableSession(orderRows[0].table_id, 'payment_recorded');

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
      SELECT o.id as order_id, o.table_id, t.table_number, o.status, o.total, o.created_at,
             COALESCE(json_agg(json_build_object('name', m.name, 'quantity', oi.quantity)) FILTER (WHERE m.name IS NOT NULL), '[]') as items
      FROM orders o
      JOIN restaurant_tables t ON o.table_id = t.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN menu_items m ON oi.menu_item_id = m.id
      -- 'Served' is included so a waiter can take payment at the table.
      WHERE o.status IN ('Pending', 'Cooking', 'Ready', 'Served')
      GROUP BY o.id, t.table_number
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
        o.id as order_id, o.status as order_status, o.total,
        (
           SELECT COALESCE(json_agg(json_build_object('name', m.name, 'quantity', oi.quantity)), '[]')
           FROM order_items oi
           JOIN menu_items m ON oi.menu_item_id = m.id
           WHERE oi.order_id = o.id
        ) as items
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

// 9. Customer reviews (Manager/Admin)
app.get('/api/reviews', authenticateToken, requireAdminOrManager, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              t.table_number,
              COALESCE(c.full_name, sd.guest_name) AS guest_name,
              c.phone_number
       FROM reviews r
       LEFT JOIN restaurant_tables t ON t.id = r.table_id
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN LATERAL (
         SELECT guest_name FROM session_devices
         WHERE session_id = r.session_id AND device_id = r.device_id
         LIMIT 1
       ) sd ON TRUE
       ORDER BY r.created_at DESC
       LIMIT $1`,
      [limit]
    );
    const { rows: stats } = await db.query(
      `SELECT COUNT(*)::int AS count, ROUND(AVG(rating)::numeric, 2) AS average
       FROM reviews`
    );
    res.json({
      reviews: rows,
      count: stats[0].count,
      average: stats[0].average ? parseFloat(stats[0].average) : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. ADMIN TERMINAL EXECUTION (Protected by JWT & Admin Role)
//
// This runs arbitrary shell commands on the server. Staff sign in with a
// 4-digit PIN, so "admin only" is a much weaker gate than it sounds -- anyone
// who guesses the PIN owns the machine. It is therefore OFF unless explicitly
// switched on, and is meant for short debugging sessions, not for staying
// enabled in production.
const ADMIN_TERMINAL_ENABLED = process.env.ENABLE_ADMIN_TERMINAL === 'true';

if (ADMIN_TERMINAL_ENABLED) {
  console.warn(
    '[SECURITY] Admin terminal is ENABLED -- any admin PIN grants shell access ' +
    'on this server. Unset ENABLE_ADMIN_TERMINAL when you are done debugging.'
  );
}

app.post('/api/admin/terminal', authenticateToken, requireAdmin, (req, res) => {
  if (!ADMIN_TERMINAL_ENABLED) {
    return res.status(403).json({
      error: 'The web terminal is disabled. Set ENABLE_ADMIN_TERMINAL=true on the server to turn it on temporarily.',
      code: 'TERMINAL_DISABLED',
    });
  }

  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'No command provided' });

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

  // A customer phone asks to receive its own table's events. The server derives
  // the room from the verified token -- a client is never allowed to name the
  // room it joins, or one phone could listen in on another table.
  socket.on('join_session', async (token) => {
    try {
      const { sessionId, deviceRowId } = readTableSession(token);
      const { rows } = await db.query(
        `SELECT 1 FROM session_devices d
         JOIN table_sessions s ON s.id = d.session_id
         WHERE d.id = $1 AND d.session_id = $2 AND d.status = 'active' AND s.status = 'open'`,
        [deviceRowId, sessionId]
      );
      if (rows.length === 0) {
        socket.emit('session_closed', { reason: 'not_active' });
        return;
      }
      socket.join(`session:${sessionId}`);
    } catch {
      socket.emit('session_closed', { reason: 'invalid_token' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Mamar Bari Backend Server running on port ${PORT}`);
});
