# Mamar Bari POS/CRM — Handover

A restaurant POS + CRM for Mamar Bari. It runs the staff till, the kitchen
display, a manager dashboard, QR‑based customer self‑ordering (dine‑in and
take‑out), inventory, split‑bill payments, and customer reviews.

This document is the operational handover: where things run, how to deploy, how
to run migrations, day‑to‑day operations, and known risks. It reflects the
**actual** production setup (which differs from the generic `RENDER_DEPLOYMENT.md`).

---

## 1. Architecture & production topology

| Piece | Where | Notes |
|-------|-------|-------|
| **Backend API** | Render Web Service — `https://mamar-bari-pos.onrender.com` | Root dir `backend`, start `node server.js`. Serves `/health`, `/api/*`, and Socket.IO. The name sounds like a frontend but it is the API. Free tier **sleeps after 15 min** — kept awake by UptimeRobot hitting `/health`. |
| **Database** | **Neon Postgres** (NOT Render Postgres) | The prod `DATABASE_URL` is the one in local `backend/.env`. ⚠️ **Running any script locally hits production directly.** |
| **Frontend** | Static site — `https://mamar-bari-pos.vercel.app` (confirm host with owner) | Vite build (`dist/`). SPA rewrites in `frontend/vercel.json`. |

- **Deploys are automatic on push to `main`** (Render rebuilds the backend; the
  static host rebuilds the frontend). There is no manual deploy step.
- Real‑time updates (new orders, status changes, bill‑paid, review prompts) flow
  over Socket.IO; `io.emit(...)` events are consumed by the staff screens and the
  customer phones.

## 2. Repository layout

```
backend/
  server.js            # the entire API + Socket.IO (single file, ~1550 lines)
  db.js                # pg Pool (connectionString = DATABASE_URL)
  tokens.js            # table QR codes + signed customer-session tokens
  schema.sql           # full schema (fresh installs)
  migrations/0X_*.sql  # incremental, idempotent; run against live Neon in order
  seed.js, init_db.js  # local bootstrap helpers
frontend/
  src/App.jsx          # routes
  src/views/           # Login, MPOS (waiter), KDS (kitchen), Manager, Admin,
                       # TableOrder (dine-in QR), TakeoutOrder (parcel QR)
  src/components/PaymentModal.jsx
  src/utils/menu.js    # groupMenuByCategory / categoryNames
```

## 3. Routes & roles

**Staff (JWT via 4‑digit PIN login at `/login`):**

| Route | Who | Purpose |
|-------|-----|---------|
| `/mpos` | waiter+ | Take dine‑in / take‑out orders, serve, take payment |
| `/kds` | kitchen | Live cooking queue |
| `/manager` | manager/admin | Floor status, QR‑order confirmation, table + take‑out QR codes, menu/categories, reviews |
| `/admin` | admin | Users, inventory, (optional) web terminal |

Roles: `admin` > `manager` > `waiter`. Enforced by `requireAdmin` /
`requireAdminOrManager` middleware on sensitive endpoints.

**Customer (no login — identity comes from the scanned QR):**

| Route | Purpose |
|-------|---------|
| `/order?t=<code>` | Dine‑in: scan the table QR → shared table session → order, track, request bill, review |
| `/takeout` | Take‑out/parcel: one shared QR → order → track → **pay at counter** |

## 4. Environment variables

**Backend (Render):**

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | Neon connection string |
| `JWT_SECRET` | yes in prod | **Server refuses to boot in production without it.** Signs staff tokens + customer session tokens. |
| `NODE_ENV` | prod | `production` |
| `FRONTEND_URL` | yes | Baked into **printed table QR codes**. If wrong, printed stickers point to the wrong site. Fallback is the prod URL on purpose. |
| `ENABLE_ADMIN_TERMINAL` | no | Leave **unset**. See Security. |

**Frontend (host env):** `VITE_API_URL` = backend URL.

Local dev: `backend/.env` only needs `DATABASE_URL` (which points at prod Neon).
`JWT_SECRET`/`FRONTEND_URL` fall back to safe dev defaults. For a fully local
frontend, set `FRONTEND_URL=http://localhost:5173` so generated QR links are local.

## 5. Local development

```bash
# Backend  (http://localhost:4000)
cd backend && npm install && node server.js

# Frontend (http://localhost:5173)
cd frontend && npm install && npm run dev
```

⚠️ Local `backend/.env` points at the **production Neon DB** — local runs read
and write live data. Use a separate database URL if you need a real sandbox.

## 6. Database & migrations

- Fresh install: apply `backend/schema.sql`.
- Incremental changes live in `backend/migrations/0X_*.sql`, applied **in order**
  against live Neon. They are written idempotently (`IF NOT EXISTS` / `ADD COLUMN
  IF NOT EXISTS`), so re‑running is safe.
- There is **no migration runner**. Apply with `psql "$DATABASE_URL" -f
  backend/migrations/0X_name.sql`, or a one‑off node script using `pg`.
- Latest applied: **`08_takeout.sql`** (adds `orders.order_type` +
  `dine_in`/`takeout`), applied to prod on 2026‑08‑22.

## 7. Common operations

- **Add a table:** Manager → add table → a permanent QR `qr_code` is generated.
  Print from **Manager → Table QR Codes**. **Check the URL under each QR before
  printing a batch** — it must be the live site.
- **Rotate a compromised QR:** Manager → Table QR Codes → Reset (admin only).
  Old sticker dies immediately; only that table needs reprinting.
- **Take‑out QR:** Manager → Table QR Codes → the amber "Take‑out / Parcel" card
  (one shared, tokenless QR to `/takeout`). Place it at the counter/entrance.
- **Menu edits** propagate live to open customer phones (`menu_updated` socket).
- **"Coming Soon" items:** modeled as `is_available=false`, `price=0`, name
  suffixed " (Coming Soon)". Customers see only available items (59); waiters see
  all (70). Fewer items on the customer menu is this split, not a bug.
- **Take‑out order lifecycle:** customer `/takeout` order lands **Unconfirmed** →
  manager confirms → kitchen cooks → waiter serves → **Take Payment** in MPOS →
  pay at counter. Take‑out orders never occupy a table and never appear on the
  manager floor grid (by design).

## 8. Security review — findings & risks

Reviewed 2026‑08‑22. No critical vulnerabilities in normal operation. Items to
be aware of for the handover:

1. **`POST /api/admin/terminal` runs arbitrary shell commands** on the server.
   It is gated behind admin role **and** `ENABLE_ADMIN_TERMINAL=true`, and is OFF
   by default. **Action: confirm `ENABLE_ADMIN_TERMINAL` is unset in Render.**
   Because staff auth is a 4‑digit PIN, "admin only" is a weak gate — never leave
   this enabled.
2. **Staff PINs are 4 digits, stored in plaintext.** Brute force is mitigated by
   a login limiter (30 wrong attempts / 10 min, wrong‑PIN only). Consider longer
   PINs or hashing if the threat model grows.
3. **`JWT_SECRET` must be a strong random value in prod** (the server enforces its
   presence but not its strength). Anyone with the secret can mint admin tokens.
4. **CORS is open (`*`)** for both HTTP and Socket.IO. The public ordering surface
   needs to be open; staff tokens live in `localStorage` (not cookies), so this
   isn't directly CSRF‑exploitable, but tightening origins for `/api` is a
   hardening option.
5. **Good practices already in place:** all SQL is parameterized (no injection);
   public order pricing is recomputed server‑side (client prices ignored); table
   identity is derived from the verified session/QR, never from the request body;
   public endpoints are rate‑limited (keyed per device/phone); customer session
   tokens are signed and validated against live DB rows.

## 9. Known limitations / roadmap

- **Deleting a menu item** that appears in past orders will fail (FK). Use the
  availability toggle / "Coming Soon" instead of deleting.
- **Inventory can go negative** (no floor at 0) — informational, by design.
- **Staff‑entered order totals are trusted** (server recomputes only for *public*
  QR orders). Fine while staff are trusted; worth revisiting.
- **Printing** is browser print (CSS `@page 80mm`). Native Bluetooth ESC/POS for
  the Xprinter XP‑P502A is a future phase (iOS Safari can't reach a BT printer).
- Planned: two‑level menu categories + per‑item variants; native print wrapper;
  full endpoint audit.
