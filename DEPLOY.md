# Deploying Sunshine on Render

## Why Render, not Vercel

| Needs of this app | Vercel | Render |
|---|---|---|
| WhatsApp (Baileys) keeps a permanent connection open | ✗ functions stop after each request | ✓ always-on server |
| WhatsApp session + uploaded photos saved to disk | ✗ disk is wiped | ✓ persistent disk |
| Live tape chart (Socket.IO) | ✗ no long-lived websockets | ✓ |
| Nightly auto-checkout / rate jobs (node-cron) | ✗ nothing running to fire them | ✓ |
| PostgreSQL | external only | ✓ managed, same region |
| Website (React) | ✓ | ✓ served by the same service |

One Render **web service** runs the API *and* serves the built website from the
same address, plus one Render **Postgres** database. Everything is described in
[`render.yaml`](render.yaml), so Render sets it up in one go.

**Cost (approx., check render.com/pricing):** Starter web service ~$7/mo +
1 GB disk ~$0.25/mo + Postgres basic ~$6/mo. The free plan is not usable here:
free services sleep after 15 minutes (WhatsApp disconnects, jobs don't run)
and cannot have a disk.

---

## Step 1 — Put the code on GitHub (private)

In PowerShell, from the `Sunshine-master` folder:

```powershell
cd "C:\Users\Aswin\Downloads\Sunshine-master (1)\Sunshine-master"
git init
git add .
git status
```

Check the `git status` list: **`backend/.env`, `backend/.env.vercel`,
`backend/.baileys_auth` and `backend/uploads` must NOT appear** (they are in
`.gitignore`). Then:

```powershell
git commit -m "Prepare Sunshine for Render"
gh repo create sunshine-pms --private --source . --push
```

(`gh` is the GitHub CLI, already installed. Run `gh auth login` first if asked.)

## Step 2 — Create everything on Render from the blueprint

1. Sign in at https://dashboard.render.com (sign up with GitHub).
2. **New → Blueprint** → connect GitHub → pick the `sunshine-pms` repo.
3. Render reads `render.yaml` and shows: web service `sunshine-pms`,
   database `sunshine-db`, a 1 GB disk. It asks for the secret values:

   | Key | What to enter |
   |---|---|
   | `PLATFORM_ADMIN_PASSWORD` | a strong password for the `/platform` page |
   | `OWNER_EMAIL` | `aswinvensiva@gmail.com` |
   | `OWNER_PHONE` | `8903001533` |
   | `GMAIL_USER` | `aswinvensiva@gmail.com` |
   | `GMAIL_PASS` | your Gmail **app password** (same as in `backend/.env`) |
   | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | leave empty until you have them |

   `JWT_SECRET` is generated automatically; database values are wired automatically.
4. Click **Apply**. Render creates the database, builds the site, runs
   `db:deploy` (creates tables + roles on the empty database), then starts the
   server. The first deploy takes ~5–10 minutes. Watch it under **Events / Logs**.

## Step 3 — Create your owner login (once)

Service `sunshine-pms` → **Shell** tab, run:

```bash
cd backend && BOOTSTRAP_OWNER_PASSWORD='choose-a-strong-password' npm run bootstrap-owner -- --username admin
```

(`admin`/`admin123` is only for your own computer; the script that sets it
refuses to run against a hosted database.)

## Step 4 — Open the site

Your address is shown at the top of the service page, e.g.
`https://sunshine-pms.onrender.com`.

- Website: `https://sunshine-pms.onrender.com`
- Staff admin: `https://sunshine-pms.onrender.com/admin` → `admin` + the password from Step 3
- Platform (multi-resort) page: `https://sunshine-pms.onrender.com/platform` → `admin` + `PLATFORM_ADMIN_PASSWORD`

## Step 5 — Link WhatsApp

1. Admin → grid menu → **Notifications** → *Setup Checklist* → *WhatsApp Web*
   shows the QR (or open the service **Logs** tab, it is printed there too).
2. Phone: WhatsApp → Settings → Linked devices → Link a device → scan.
3. The session is stored on the disk (`/var/data/baileys_auth`), so it survives
   restarts and redeploys. Re-scan only if WhatsApp logs it out — the server
   then archives the old session and shows a fresh QR automatically.

## Updating the site later

```powershell
git add .
git commit -m "describe the change"
git push
```

Render redeploys automatically and runs the database migrations first.
(Services with a disk restart in place, so expect ~30–60 s of downtime per deploy.)

## Optional — your own domain

Service → **Settings → Custom Domains** → add e.g. `sunshineresort.in`, then
add the DNS record Render shows at your domain registrar. Nothing else changes:
`DEFAULT_TENANT_SLUG=sunshine-original` already points every request at your resort.

## Troubleshooting

- **Deploy fails at "pre-deploy"** → open the deploy log; it's the database step.
  Fix and click *Manual Deploy → Deploy latest commit*.
- **"Unknown resort"** → `DEFAULT_TENANT_SLUG` must be `sunshine-original`
  (Environment tab).
- **Emails not sending** → `GMAIL_PASS` must be a Google *app password*, not
  your normal Gmail password.
- **Know the limit:** the app and admin share one database login on Render, so
  tenant isolation relies on the application code (Postgres row-level security
  is not a separate barrier). Fine for one resort; revisit before onboarding
  other resorts.
