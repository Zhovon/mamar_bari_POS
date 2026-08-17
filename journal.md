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

### 6. QR Session Invalidation on Checkout (added via VS Code)
- Prevents a table's QR session from being reused after the guests leave / the table is checked out.
- `restaurant_tables.session_version` counter, embedded as `sv` in the customer session token (`tokens.js`).
- `POST /api/public/orders` verifies the token's `sv` against the table's current `session_version` inside the transaction and rejects stale sessions with 401.
- Manager checkout (`/api/orders/:id/status` → `Completed`) bumps `session_version` and emits a `table_cleared` socket event; `TableOrder.jsx` listens and switches to a **Session Expired** screen prompting a rescan.

### 6. QR Session Expiration & Security Fix
- **Dynamic Device Sessions:** Added a `session_version` counter to the `restaurant_tables` database schema (via `migrations/03_table_session_version.sql`).
- Modified `backend/tokens.js` to embed the table's `session_version` inside the 3-hour JWT session when a customer scans the permanent table QR code.
- Enforced session validation in `POST /api/public/orders` to ensure the session hasn't expired.
- When staff settles a bill (`PUT /api/orders/:id/status` -> `Completed`), the backend automatically increments the table's `session_version` and emits a `table_cleared` socket event. This instantly invalidates all active mobile sessions for that table.
- **Frontend Real-time Expire:** `TableOrder.jsx` listens for `table_cleared` and instantly kicks customers to an "Expired Session" state, requiring them to rescan the permanent QR code.
- **Critical Bug Fix:** Refactored the legacy waitstaff order endpoint (`POST /api/orders`) to use `await db.getClient()` instead of standard pool `.query()` calls, fixing a severe transaction stranding/deadlock issue related to PostgreSQL connection pooling.
- Verified end-to-end flow manually via a headless API test script.

### 7. Phase 6 Completion: Inventory, Split Billing, & Table Management
- **Add Table Functionality:** Added an `Add Table` button and modal to the `Manager.jsx` Floor Plan tab, backed by a protected `POST /api/tables` route in `server.js`.
- **Inventory Engine:** 
  - Added `ingredients` and `recipes` tables to Postgres. 
  - Added CRUD API routes (`/api/inventory` and `/api/recipes`). 
  - Updated `POST /api/orders` (waitstaff) and `POST /api/orders/:id/confirm` (manager QR accept) to use a database transaction that automatically deducts ingredient `current_stock` based on menu item recipes whenever an order is placed.
  - Added the **Inventory** tab to `Manager.jsx` to list, add, and edit ingredients and their stock alerts.
  - Added a **Recipe Modal** to the Menu tab in `Manager.jsx` to map ingredients to menu items.
- **Split Billing:**
  - Added a `payments` table to Postgres.
  - Added `GET /api/orders/:id/payments` and `POST /api/orders/:id/payments` routes.
  - The payment creation route calculates the total paid. If the balance reaches 0, it automatically marks the order status as `Paid`.
  - Replaced the "Print Invoice & Close" button with a "Process Payment" button on active tables. This opens a modal showing the total bill, remaining balance, and a form to add payments via Cash, Card, bKash, etc. Once fully paid, the modal reveals the final "Print Invoice & Close Table" button to settle the session.
- **Tech Debt/Dependencies:** Swapped out `bcrypt` for `bcryptjs` on the backend to permanently avoid native C++ build errors during `npm install` across environments.
- **Verification:** Ran `node -c server.js` and `npm run build` locally to verify syntax and bundle integrity. Connected to the live Neon DB using a custom Node script and confirmed all Phase 6 tables (`ingredients`, `recipes`, `payments`) are successfully migrated and exist in the `public` schema. All changes were pushed to GitHub, triggering a live Vercel/Render deployment.

---
**Current Database Schema (Live on Neon):**
- `restaurant_tables` (id, table_number, capacity, status, session_version, created_at, updated_at)
- `users` (id, pin_code, role, name, created_at, updated_at)
- `menu_items` (id, name, category, price, is_available, image_url, created_at, updated_at)
- `customers` (id, name, phone, created_at)
- `orders` (id, table_id, waiter_id, customer_id, subtotal, discount, total, status, source, guest_name, created_at, updated_at)
- `order_items` (id, order_id, menu_item_id, quantity, notes, status, created_at)
- `ingredients` (id, name, unit, current_stock, alert_threshold, created_at)
- `recipes` (id, menu_item_id, ingredient_id, quantity_required, created_at)
- `payments` (id, order_id, amount, payment_method, created_at)

**Handoff Notes for Future AI / Developer:**
- The foundation for Phase 6 (Inventory and Split Billing) is fully built and deployed. 
- You can find the frontend components in `frontend/src/views/Manager.jsx`. 
- The backend routes for these features are at the bottom of `backend/server.js`.
- If CRM features (like tracking customer visit history or loyalty points) are requested in the future, the `customers` table is already primed and linked to `orders` via `customer_id`.

---

### 8. Permanent Table QR, Dining Sessions & Review-at-Payment

**The `localhost` QR bug.** Not a code fault: `FRONTEND_URL` was never set on Render, so `server.js` fell back to its dev default and baked `http://localhost:5173` into every printed QR. The fallback is now the production URL, and the Manager QR card prints the target URL beneath each code and *refuses to print* when it contains `localhost` — this class of mistake must be caught before the laminator, not after.

**QR payload is now a short opaque code, not a JWT.** The old QR encoded a ~180-char signed token. For a laminated sticker that was fragile: it would have died the instant `JWT_SECRET` was set or rotated on Render, and the dense QR scanned poorly in low light. Each table now owns an 8-char code (`restaurant_tables.qr_code`, migration 05) — permanent, revocable per table via `POST /api/tables/:id/qr/rotate`, and unaffected by secret rotation. `resolveScannedCode()` still accepts the legacy JWT format, so stickers printed earlier keep working.

**Sessions live in the database (migration 06).** The requirement — a device's token expires when its owner reviews or dismisses — is *revocation*, which a stateless JWT cannot do. Model is split in two:
- `table_sessions` — one shared session per table visit, so the whole table sees one combined bill.
- `session_devices` — one row per phone. This split is the point: releasing one phone leaves its friends' phones ordering.

The token is now only a pointer (`sid` + `did` + `tid`); `requireActiveSession` loads both rows and rejects unless the session is `open` **and** the device is `active`. The 12h JWT expiry is a backstop only.

**Bill scope.** `getSessionBill()` counts every non-cancelled order on the table since the session opened — including waiter-entered orders that carry no session id. Anything narrower would show the guest a different number from the one staff are collecting.

**Review at payment.** Settling the *whole table* (not one order) emits `bill_paid` into the `session:<id>` socket room; the phone shows 1–5 stars plus a plain "No thanks". Both paths release that device; only submitting writes a `reviews` row. Reviews attach to the visit's customer — a phone number given on the *first* order still counts, so later anonymous rounds don't lose the CRM link. New **Reviews** tab in Manager shows the average and recent comments.

**Payment from both sides.** The split-billing modal lived only in Manager; extracted to `frontend/src/components/PaymentModal.jsx` and mounted in MPOS too, so a waiter at the table and the manager at the desk hit the same endpoint and both trigger the review push. `GET /api/waiter/orders` now returns `total`/`table_id` and includes `Served` orders so they can be paid at the table.

**Stale-session guard.** Deliberately *not* a background sweeper. Checked at join time: if the table is `Available` and the open session has been idle >6h, the scan opens a fresh session. Without it, a guest who walks out unpaid leaves the session open and the next customer inherits their bill. An `Occupied` table is never cut off, so a long meal is safe.

**Security fixes (same pass):**
- **Login brute force.** Staff sign in with a 4-digit PIN and `/api/login` had no limit — 10,000 guesses got you an admin token. Now rate-limited, but applied *after* the PIN check so a correct PIN is never throttled: the whole restaurant shares one public IP, and a limiter in front of the handler would let one fumbled PIN lock every till on the floor.
- **Admin web terminal.** `POST /api/admin/terminal` runs arbitrary shell commands, gated only by that 4-digit PIN. Now **off unless `ENABLE_ADMIN_TERMINAL=true`**, logs a warning at boot when on, and the Admin view explains the disabled state instead of looking broken.
- `JWT_SECRET` is now required at boot in production (was falling back to a hardcoded string).
- Public endpoints rate-limited, keyed by device rather than IP for the same shared-wifi reason.
- Socket rooms are derived from the verified token — a client can never name the room it joins.
- `backend/.env.example` had a live Neon password; replaced with a placeholder. Confirmed via `git log -S` that it was **never committed** — exposure was local only.

**Verification.** Ran against a real Postgres 16 in Docker: migrations 04→06 applied over the *old* schema (code backfill verified unique and well-formed across 8 tables), then 24 end-to-end API checks and 6 socket checks, all passing. Covered: two phones sharing one bill, phone A reviewing while phone B stays live, skip writing no row, closed devices rejected, tampered `table_id` ignored, staff checkout releasing everyone, next customer starting at zero, legacy JWT stickers still resolving, socket room isolation, per-device rate limiting, brute-force lockout with real PINs still working.

**Deploy checklist:** apply migrations `04` → `05` → `06` (04 first: 05/06 need `payments`); set `FRONTEND_URL`, `JWT_SECRET`, `NODE_ENV=production` on Render; reprint stickers to get the smaller QR (old ones keep working meanwhile).
