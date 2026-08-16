# Mamar Bari POS & CRM - Project Memory

## Architecture Overview
- **Type**: Self-hosted, Dockerized Restaurant Management System.
- **Frontend**: React (Vite), Tailwind CSS (Flat UI Light-Mode), Socket.io-client.
- **Backend**: Node.js, Express.js, Socket.io (WebSockets), JSON Web Tokens (JWT).
- **Database**: PostgreSQL (containerized natively).
- **Ports**: 
  - Frontend: `3000`
  - Backend: `4000`
  - Database: `5432`
  - Adminer (DB GUI): `8080`

## Core User Roles & Pins
- **Developer/Admin** (`0000`): Access to `/admin` bash terminal and database GUI.
- **Manager** (`9999`): Access to `/manager` (Dashboard, Menu Management, Printing, Analytics).
- **Chef** (`8888`): Access to `/kds` (Kitchen Display System with WebSocket auto-refresh).
- **Waiter** (`1234`): Access to `/mpos` (Order taking, Cart, Active order status notifications).

## Database Schema (PostgreSQL)
- `users`: Stores staff profiles and PIN codes.
- `restaurant_tables`: Tracks table capacity and status (Available/Occupied/Billed).
- `menu_items`: Stores dishes, prices, images, and availability (`is_available` boolean).
- `orders`: Tracks the overall bill per table (`subtotal`, `discount`, `total`, `status`).
- `order_items`: Tracks individual dishes requested within an order.
- `ingredients`: [Phase 6] Tracks raw material inventory.
- `recipes`: [Phase 6] Maps menu items to required ingredients for auto-deduction.
- `payments`: [Phase 6] Tracks split tenders (Cash, Card, bKash).

## Implemented Features
1. **Core Loop**: Waiters can create orders which instantly appear on the Chef's KDS via WebSockets. Chefs mark items as "Ready", instantly notifying Waiters to pick them up.
2. **Thermal Printing**: Web-native ESC/POS styling (58mm/80mm) implemented in the Manager Dashboard to print invoices and auto-clear tables.
3. **Menu Management GUI**: Fully functional CRUD interface for Managers to add, edit, and toggle availability of dishes without touching SQL.
4. **Security**: Strict JWT RBAC middleware blocking unauthorized access to backend routes.
5. **Design**: Strict, human-written flat light-mode design with high contrast cards, stripping away all "AI-generated" glassmorphism.

## QR Table Ordering (added Aug 16, 2026)
- Customers scan a per-table QR → `/order?t=<token>` → order for that table only.
- **Security:** table id is always derived from a signed token (`backend/tokens.js`: table token → 3h session), never from the URL/body. Server prices orders itself. QR orders land as `Unconfirmed` and staff Accept/Reject them in the Manager "QR Orders" tab before they hit the kitchen.
- New: `orders.source`/`guest_name`/`Unconfirmed` status; public `/api/public/*` routes; Manager "QR Orders" + "Table QR Codes" tabs; `qrcode` frontend dep; `db.getClient()` for real transactions.

## Pending Roadmap (Phase 6 Expansion)
- [ ] **Inventory Engine**: Backend transaction logic to subtract raw ingredients from `ingredients` table when an order is placed.
- [ ] **Split Billing GUI**: Manager checkout modal to accept multiple tender types per order.
- [ ] **Sales Analytics**: Charting daily/weekly revenue and top-selling items.
- [ ] **CRM / Loyalty**: Parked for future phase.
- [ ] **Security hardening (pre-Render):** kill/sandbox the `/api/admin/terminal` RCE endpoint; hash PINs + rate-limit login; rotate `JWT_SECRET` out of `RENDER_DEPLOYMENT.md`.
