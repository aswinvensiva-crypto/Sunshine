# Implementation Prompt: Multi-Tenant Admin for Sunshine

Paste this into Claude Code (or another coding agent) inside the `Sunshine` repo to drive the implementation.

---

## Context

Sunshine is a single-tenant resort booking platform: Express + PostgreSQL backend (`backend/`), React/Vite admin SPA (`client/src/admin/`). One database, one resort, no tenant concept anywhere. Goal: convert the **admin side** (`/api/admin/*`, `/api/auth`, `/api/employee`, the React admin app) into a multi-tenant system where multiple resorts/properties run on the same deployment, each with fully isolated data, users, and settings — while keeping the public guest-facing booking flow (`/api/rooms`, `/api/availability`, `/api/bookings`, `/api/check-in`, `/api/feedback`) working per-property.

Non-negotiable constraint: **no tenant's admin can ever see or mutate another tenant's data**, even via a bug in one route handler. Defense must exist at more than one layer.

## Current architecture (read these before touching anything)

- `backend/server/config/db.js` — single shared `pg` Pool, one database (`sunshine`).
- `backend/server/middleware/auth.js` — `requireAuth` verifies a JWT and checks `users.is_blocked`; `requireAdmin`/`requireOwner` check `req.user.role`. JWT payload has no tenant concept today.
- `backend/server/routes/*.js` — `admin.js`, `auth.js`, `bookings.js`, `calendar.js`, `rooms.js`, `availability.js`, `checkin.js`, `feedback.js`, `payments.js`, `employee-auth.js`. Every query in these files hits the tables below with **no scoping filter**.
- `backend/db/schema.sql` — 21 tables, none of which have a `tenant_id`: `room_types`, `rooms`, `inventory`, `guests`, `bookings`, `payments`, `users`, `expenses`, `employees`, `shift_schedules`, `tasks`, `routines`, `routine_completions`, `operations_log`, `employee_routines`, `notification_logs`, `payment_transactions`, `competitor_rates`, `suppressed_yield_log`, `check_in_tokens`, `guest_feedback`.
- `backend/server/server.js` — boots Express + Socket.IO (global `io`, no namespacing), runs cron jobs and ad-hoc `ALTER TABLE ... IF NOT EXISTS` migrations at startup, and starts **one process-wide WhatsApp Baileys session** (`services/whatsapp.js`) plus Razorpay/Twilio integrations that assume a single set of credentials.
- `client/src/admin/adminContext.js`, `AdminApp.jsx`, `client/src/api/client.js` — no notion of "which tenant am I in."

## Decisions to lock in before coding

1. **Isolation model: shared database, `tenant_id` on every tenant-scoped table** (not schema-per-tenant, not database-per-tenant). Justification: 21 tables, moderate data volume, simplest to operate; row-level isolation is sufficient given the defense-in-depth plan below. Revisit only if a customer requires physical data separation.
2. **Tenant resolution: subdomain-based** (`<slug>.sunshine.app` in production, `<slug>.localhost:5173` in dev) resolved to a `tenant_id` on every request, both for the guest-facing site and the admin app. Fall back to an explicit `X-Tenant-Slug` header for local/API testing. Do not rely solely on a value embedded in the JWT for row scoping (a stale/forged token shouldn't be able to widen scope) — cross-check host-resolved tenant against the JWT's tenant on every admin request.
3. **New `super_admin` role**, tenant-less, for platform operators to create/suspend tenants and impersonate for support. Lives outside the tenant JWT scheme entirely (separate login route, separate token type).
4. **Defense in depth**: (a) app-layer `WHERE tenant_id = $1` on every query, enforced via a query-building helper so it can't be forgotten, and (b) Postgres Row-Level Security policies on every tenant table using a session variable (`SET app.current_tenant_id`) set per request as a backstop against a missed `WHERE` clause.

## Implementation plan

### Phase 1 — Schema
- Add `tenants` table: `id, slug (unique), name, status ('active'|'suspended'), created_at`, plus a `tenant_settings` table (or JSONB column) for per-tenant config currently hardcoded/in `.env`: Razorpay keys, WhatsApp sender number, GST number, early-checkin/late-checkout fee defaults (currently `special_requests.fee_per_hour` default 150), branding.
- Add `tenant_id INTEGER NOT NULL REFERENCES tenants(id)` to all 21 tables listed above. Write a migration script (extend `backend/db/migrate.js` — don't hand-edit `schema.sql` only) that: creates `tenants`, inserts one row for the existing resort (`slug='sunshine-original'`), backfills every existing row's `tenant_id` to that row's id, then adds the `NOT NULL` constraint and an index on `(tenant_id, id)` for every table (and any other index that currently assumes global uniqueness — e.g. `employees.username`, `bookings.reference` — must become unique **per tenant**, not globally).
- Add RLS policies: `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` plus a `USING (tenant_id = current_setting('app.current_tenant_id')::int)` policy per table. Update `config/db.js` so every request-scoped query runs `SET LOCAL app.current_tenant_id = $1` at the start of a transaction (this likely means switching hot-path admin routes from `pool.query` to a per-request client checked out via middleware — plan for that refactor, don't bolt it on per-route).

### Phase 2 — Backend request pipeline
- New middleware `resolveTenant` (runs before `requireAuth`): parses subdomain (or `X-Tenant-Slug` header in dev), looks up `tenants` by slug, 404s if missing, 403s if `status = 'suspended'`, attaches `req.tenant`.
- Update `requireAuth` in `middleware/auth.js`: JWT payload gains `tenant_id`; after verifying the token, assert `decoded.tenant_id === req.tenant.id` (reject otherwise — this is what stops a leaked/reused token from crossing tenants). Continue honoring the existing `is_blocked` check, scoped to that tenant.
- Update `routes/auth.js` and `routes/employee-auth.js` login handlers to look up users scoped by `req.tenant.id` and mint the JWT with `tenant_id` included.
- Add a `super_admin` auth path: separate route (e.g. `routes/platform-auth.js`), separate token type (`type: 'platform'`), separate middleware that skips `resolveTenant`. Add `routes/platform.js` for tenant CRUD (create tenant + seed default owner account, suspend/reactivate, list all tenants).
- Audit every query in `routes/admin.js`, `routes/bookings.js`, `routes/calendar.js`, `routes/rooms.js`, `routes/availability.js`, `routes/checkin.js`, `routes/feedback.js`, `routes/payments.js` and add `tenant_id = $n` to every `WHERE`/`INSERT`/`UPDATE`. Prefer a small helper (e.g. `req.db.query(text, params)` that auto-injects the session tenant var, or a `scopedQuery(tenantId, text, params)` wrapper) over ad-hoc edits so this can't silently regress as new routes are added.
- `server.js`: Socket.IO must be tenant-namespaced (`io.of('/tenant/:id')` or a room-per-tenant join on connect, gated by the same JWT check) so calendar/task updates don't broadcast across tenants. Move the file-based migrations at the bottom of `server.js` into `db/migrate.js` as part of this work rather than growing the startup block further.
- `services/whatsapp.js`, `services/notify.js`, `services/rateShop.js`: currently singleton/global. Decide and implement one of: (a) per-tenant WhatsApp session keyed by `tenant_id` (multiple Baileys auth folders under `.baileys_auth/<tenant_id>/`), or (b) explicitly scope this as Phase 2-not-yet and document that notifications are shared/disabled per-tenant until follow-up work. Do not silently leave it sending guest data cross-tenant.
- `backend/uploads`: namespace uploaded files under `uploads/<tenant_id>/...` and update `multer` destination + the static file route in `server.js` accordingly, so tenants can't guess/access each other's uploaded files.

### Phase 3 — Frontend admin app
- `client/src/api/client.js`: derive tenant slug from `window.location.hostname` (or a dev override), send it so the backend's `resolveTenant` can match; store the tenant-scoped JWT the same way auth is stored today.
- `client/src/admin/adminContext.js` / `AdminApp.jsx`: surface `tenant` (name, branding) in context; if a user can belong to multiple tenants, add a tenant switcher, otherwise keep it implicit from the subdomain.
- `LoginPage.jsx` / `Authentication.jsx`: no functional change beyond what the API client already handles, but surface a clear error state for "unknown resort" / "this account isn't part of this resort" distinctly from "wrong password."
- New minimal platform-admin UI (can be a separate small page/app, doesn't need full admin polish) for the `super_admin` to create tenants — this unblocks onboarding new resorts without a manual DB insert.

### Phase 4 — Verification
- Migration dry run against a copy of the current `sunshine` database: confirm row counts match pre/post migration, confirm `NOT NULL` constraints apply cleanly, confirm no orphaned rows.
- Seed a second tenant with its own owner/employee/rooms/bookings. Manually (or via a script) attempt cross-tenant access for every admin route: correct-tenant JWT against wrong-tenant subdomain, wrong-tenant JWT against correct subdomain, tenant A's owner token hitting a tenant B booking ID directly by ID/URL manipulation. All must fail.
- Confirm RLS actually blocks a query that "forgets" the app-layer filter (temporarily strip a `WHERE tenant_id` clause in one route during testing and confirm the RLS policy — not the missing app code — is what prevents leakage).
- Confirm Socket.IO events for tenant A never reach a tenant B admin session open in another browser.
- Load-test or at least sanity-check the `SET LOCAL app.current_tenant_id` + per-request client checkout doesn't regress the connection pool (`max: 10` in `db.js` may need raising once this is per-request rather than per-query).

## Deliverable format

Work in a feature branch. Land Phase 1 (schema + migration) as its own reviewable commit before touching route code, since it's the highest-risk, hardest-to-undo step. Keep the plan above as a checklist and report status against it rather than declaring the whole thing "done" in one pass — this is large enough that partial completion with a clear list of what's left is more useful than a rushed full pass.
