# Mamar Bari POS & CRM - Development Journal

## Date: August 15, 2026

### 1. UI Redesign (Flat Light-Mode)
- Replaced the initial "AI-generated" dark-mode glassmorphism theme with a strict, professional, human-written flat light-mode aesthetic.
- Updated `index.css` global theme variables (`--color-background` to `gray-50`, `--color-surface` to `white`).
- Refactored `Login.jsx`, `MPOS.jsx`, `Manager.jsx`, `KDS.jsx`, and `Admin.jsx` to use high-contrast text (`text-gray-900`), solid white backgrounds, and subtle borders (`border-gray-200`) with soft shadows (`shadow-sm`).
- Removed all `backdrop-blur`, `text-white`, and excessive gradients/animations.

### 2. Phase 6 Kickoff (Enterprise Features)
- Finalized and user-approved the Phase 6 implementation plan for Inventory, Split Billing, and Menu Management (parking CRM for later).
- **Database Schema Updates:** Added `ingredients`, `recipes`, and `payments` tables to PostgreSQL schema.
- Piped the schema updates successfully into the active `mamrbari` database container.

### 3. Menu Management GUI Implementation
- **Backend:** Added `POST`, `PUT`, and `DELETE` routes to `/api/menu` in `server.js`.
- **Security:** Added strict `requireAdminOrManager` JWT middleware to protect the new routes.
- **Frontend Dashboard:** Overhauled the Manager Dashboard (`Manager.jsx`) to include a tabbed navigation system.
- **Menu Editor:** Built a clean, flat-UI data table for viewing menu items, and a side-form for adding/editing items and toggling availability (`is_available` boolean).
- **MPOS Update:** Ensured the Waiter POS filters out any items marked as unavailable by the Manager.

### 4. Integration Testing
- Wrote and executed an automated Node.js test script (`test_menu_api.js`) against the live backend to verify the Menu API (Create, Read, Update, Delete). All tests passed perfectly.
- Rebuilt frontend and backend Docker containers to deploy the new features and design updates to the local environment.

## Date: August 16, 2026

### 5. QR Table Ordering (customer self-order)
- **Goal:** each table gets a QR; customers scan it to order for *that table only* — a user must not be able to order for another table by editing the URL/payload.
- **Security model:** table identity always comes from a signed token, never a client-supplied value.
  - `backend/tokens.js` — `makeTableToken` (HMAC, no expiry, printed on the QR; only names a table) → exchanged for a short-lived `makeTableSession` (3h). Order endpoint reads `table_id` from the verified session only.
  - Verified end-to-end: tampered token → 401; bogus `table_id` in the order body is ignored (order landed on the session's table, not the attacker's); garbage/expired session → 401.
- **DB migration** `backend/migrations/02_qr_ordering.sql` (applied live + `schema.sql` reconciled): `orders.source` ('staff'|'qr'), `orders.guest_name`, and `'Unconfirmed'` added to the status CHECK.
- **Backend routes** (`server.js`): `GET /api/tables/:id/qr` (staff), public `POST /api/public/table-session`, `GET /api/public/menu`, `POST /api/public/orders` (server-side pricing — never trusts client prices; optional phone → upserts `customers` for CRM; lands as `Unconfirmed`). Staff queue: `GET /api/orders/pending-confirmation`, `POST /api/orders/:id/confirm` (→ Pending, enters KDS), `POST /api/orders/:id/reject` (→ Cancelled). Used a pooled `db.getClient()` for the order transaction (fixes the pool-BEGIN/COMMIT bug).
- **Frontend:** public `/order?t=<token>` page (`views/TableOrder.jsx`) — token→session, mobile menu, cart, optional name/phone, "waiting for staff confirmation" state. Manager dashboard gained two tabs: **QR Orders** (Accept/Reject queue with a live count badge, socket `qr_order_pending`) and **Table QR Codes** (generate + print per-table QR via the `qrcode` npm pkg).
- Rebuilt both containers; verified pages serve and Vite resolves `qrcode`.

### 6. QR Session Expiration & Security Fix
- **Dynamic Device Sessions:** Added a `session_version` counter to the `restaurant_tables` database schema (via `migrations/03_table_session_version.sql`).
- Modified `backend/tokens.js` to embed the table's `session_version` inside the 3-hour JWT session when a customer scans the permanent table QR code.
- Enforced session validation in `POST /api/public/orders` to ensure the session hasn't expired.
- When staff settles a bill (`PUT /api/orders/:id/status` -> `Completed`), the backend automatically increments the table's `session_version` and emits a `table_cleared` socket event. This instantly invalidates all active mobile sessions for that table.
- **Frontend Real-time Expire:** `TableOrder.jsx` listens for `table_cleared` and instantly kicks customers to an "Expired Session" state, requiring them to rescan the permanent QR code.
- **Critical Bug Fix:** Refactored the legacy waitstaff order endpoint (`POST /api/orders`) to use `await db.getClient()` instead of standard pool `.query()` calls, fixing a severe transaction stranding/deadlock issue related to PostgreSQL connection pooling.
- Verified end-to-end flow manually via a headless API test script.
