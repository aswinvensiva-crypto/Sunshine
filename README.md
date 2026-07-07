# Sunshine — Resort Booking Platform

A full-stack resort website you can run on your own computer (localhost).

- **client/** — the website (React + Vite) → runs on `http://localhost:5173`
- **backend/** — the API (Express + PostgreSQL) → runs on `http://localhost:5000`
- **PostgreSQL** — the database that stores rooms, availability, and bookings

The website talks to the API, and the API talks to PostgreSQL:

```
  Browser  ──►  React (5173)  ──/api──►  Express API (5000)  ──►  PostgreSQL (5432)
```

> You can open the website **before** setting up the database — it will show
> sample data. To make real bookings (and prevent double-bookings), follow all
> the steps below to connect PostgreSQL.

---

## 0. What you need to install first

1. **Node.js** (version 18 or newer) — https://nodejs.org → download the "LTS" version.
   Check it works: open a terminal and run `node -v` (you should see a version number).
2. **PostgreSQL** — installed in Step 1 below.

> "Open in localhost on Google" = run the project, then type the address
> (`http://localhost:5173`) into the Google Chrome address bar.

---

## 1. Install PostgreSQL (step by step)

### Windows
1. Go to https://www.postgresql.org/download/windows/ and click
   **"Download the installer"** (EnterpriseDB).
2. Run the installer. Keep clicking **Next**. When asked:
   - **Password** for the `postgres` superuser → type a password you'll remember
     (for example `postgres`). **Write it down** — you need it in Step 3.
   - **Port** → leave it as **5432**.
   - Leave the rest as default and finish.
3. The installer also offers **pgAdmin** (a visual tool) and **Stack Builder**
   (skip Stack Builder). pgAdmin is useful for browsing your data later.

### macOS
Easiest is **Postgres.app**:
1. Download from https://postgresapp.com → drag to Applications → open it →
   click **Initialize**. That starts a server on port **5432**.
2. (Optional) The default user is your Mac username with no password. If so,
   set `DB_USER` to your Mac username and leave `DB_PASSWORD` blank in Step 3.

Or with Homebrew: `brew install postgresql@16 && brew services start postgresql@16`.

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo service postgresql start
# set a password for the postgres user:
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
```

**Verify PostgreSQL is running** (any OS) — this should print a version:
```bash
psql --version
```

---

## 2. Create the database

You only need to create an **empty** database named `sunshine`.
The tables are created automatically in Step 4.

**Option A — command line** (works on all OS). On Windows, open
"SQL Shell (psql)" from the Start menu and press Enter through the prompts
(using the password from Step 1):
```sql
CREATE DATABASE sunshine;
```
Then type `\q` to quit.

One-liner alternative (Mac/Linux terminal):
```bash
createdb -U postgres sunshine
```

**Option B — pgAdmin (visual):** open pgAdmin → expand *Servers* → right-click
**Databases** → *Create* → *Database…* → name it `sunshine` → Save.

---

## 3. Configure the backend connection

```bash
cd backend
cp .env.example .env        # Windows PowerShell:  copy .env.example .env
```

Open `backend/.env` and set the values to match your PostgreSQL install:
```
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres        # the password you set when installing PostgreSQL
DB_NAME=sunshine
```

---

## 4. Install backend packages and load the tables + sample data

From the `backend/` folder:
```bash
npm install
npm run db:setup
```
`npm run db:setup` creates all the tables and fills 365 days of room
availability. You should see: `Database is ready.`

> If it fails, the message tells you why — usually a wrong password in `.env`
> or the `sunshine` database not existing yet (redo Step 2/3).

---

## 5. Start the backend (the API)

Still in `backend/`:
```bash
npm run dev
```
Leave this terminal open. You should see:
```
  Sunshine API running → http://localhost:5000
```
Test it: open `http://localhost:5000/api/health` in your browser — you should
see `{"ok":true,...}`.

---

## 6. Start the website (the React app)

Open a **second** terminal (keep the backend running in the first one):
```bash
cd client
npm install
npm run dev
```
You'll see a line like:
```
  ➜  Local:   http://localhost:5173/
```

---

## 7. Open it in your browser

Type **http://localhost:5173** into Google Chrome (or click the link in the
terminal). The resort website loads.

- Pick dates → **Check Availability** → it asks the API, which reads PostgreSQL.
- Click **Reserve** on a room → fill your name → **Confirm Reservation**.
  The booking is saved to PostgreSQL and you get a reference like `AZ-2026-001234`.
  Book the same room/dates until it's gone and the API correctly says **sold out**
  — that's the overbooking guard working.

---

## How it all connects (quick mental model)

| Piece | Folder | Port | Job |
|---|---|---|---|
| Website | `client/` | 5173 | What guests see; calls `/api/...` |
| API | `backend/` | 5000 | Business logic; the only thing that touches the DB |
| Database | PostgreSQL | 5432 | Stores rooms, availability, bookings |

The website never talks to PostgreSQL directly. It calls the API
(`/api/availability`, `/api/bookings`), and Vite forwards those `/api` requests
to the backend (see `client/vite.config.js`). The backend reads `.env` to
connect to PostgreSQL (see `backend/server/config/db.js`).

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Is the server up? |
| GET | `/api/rooms` | All room categories |
| GET | `/api/availability?check_in=&check_out=&guests=` | Bookable rooms for dates |
| POST | `/api/bookings` | Create a booking (overbooking-safe) |
| GET | `/api/bookings` | Recent bookings (for a future admin screen) |
| POST | `/api/auth/login` | Staff login → returns a token |
| GET | `/api/admin/dashboard` | KPIs (token required) |
| GET/PATCH | `/api/admin/bookings` | List bookings / change status (token required) |
| GET | `/api/admin/calendar` | Month occupancy (token required) |
| GET/PATCH | `/api/admin/rooms` | Rooms, rates, statuses (token required) |
| GET | `/api/admin/guests` | Guest list (token required) |
| GET/POST | `/api/admin/expenses` | Expenses (token required) |
| GET/POST | `/api/admin/users` | Staff accounts (owner/manager only) |

---

## Troubleshooting

- **"password authentication failed"** → `DB_PASSWORD` in `.env` is wrong.
- **"database sunshine does not exist"** → redo Step 2.
- **"ECONNREFUSED ... 5432"** → PostgreSQL isn't running. Start it
  (Windows: it runs as a service; Mac: open Postgres.app; Linux:
  `sudo service postgresql start`).
- **Website loads but shows "(sample data)"** → the backend isn't running.
  Do Step 5 in a separate terminal.
- **Port already in use** → change `PORT` in `.env` (backend) or the `port` in
  `client/vite.config.js` (frontend).

---

---

## The admin page (staff dashboard)

There's a separate, password-protected admin area for running the resort —
everything beyond taking direct bookings.

**How to open it:** go to **http://localhost:5173/admin**, or scroll to the
website footer and click **"Staff login"**. You'll be asked for a username and
password before anything loads.

**Default login** (created by `npm run db:setup`):

| Username | Password |
|---|---|
| `admin` | `admin123` |

Change these by editing `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `backend/.env`
before running `npm run db:setup` (or add more staff from the Staff page).

**What's inside the admin page:**

| Section | What it does |
|---|---|
| **Dashboard** | Occupancy %, in-house/arrivals/departures, ADR, RevPAR, monthly revenue, expenses, profit, revenue by channel, recent bookings |
| **New Booking** | Front-desk / walk-in / phone bookings: pick an existing guest or add a new one, choose room and dates, take an advance, apply tax, and print a receipt |
| **Bookings** | Every reservation (direct + OTA); filter by status; edit dates (re-checks availability and reprices), record payments, change status, or cancel (releases the rooms); print a receipt |
| **Calendar** | Month grid showing rooms booked / total for each night |
| **Rooms** | Room types with today's rate & availability; set dynamic rates for a date range; mark physical rooms available / maintenance / unavailable |
| **Guests** | Guest list with number of stays, last stay, and lifetime value |
| **Expenses** | Record and review operating costs (pool, salaries, utilities…) that feed the profit figure |
| **Staff** | (owners/managers only) Create staff accounts with roles |

How it's secured: login returns a signed **JWT** that the browser sends on every
admin request. The backend verifies it on `/api/admin/*` routes; staff
management additionally requires an owner/manager role. Passwords are stored
**hashed** (bcrypt), never in plain text.

---

## Next steps (from the technical framework)

1. **Payments** — add Razorpay before flipping a booking to `confirmed`.
2. **Admin/PMS** — a staff dashboard using the existing `GET /api/bookings`.
3. **OTA sync** — connect a channel manager (STAAH / eZee / SiteMinder /
   Cloudbeds) so Booking.com, Agoda, and MakeMyTrip read/write the same
   `inventory` table. Both your site and every OTA must go through it — that's
   what keeps them in sync.
