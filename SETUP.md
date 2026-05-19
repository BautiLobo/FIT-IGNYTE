# FIT IGNYTE — Setup Guide

## Files in this package

```
FitIgnyte_Supabase.jsx   ← Main React app (connected to Supabase)
supabase/
  schema.sql             ← Run this ONCE in Supabase to create all tables
  lib/supabase.js        ← Data layer — put your credentials here
```

---

## Step 1 — Create a Supabase Project

1. Go to https://supabase.com and sign in (free account is fine)
2. Click **New Project**
3. Give it a name (e.g. `fit-ignyte`), choose a region close to China
4. Wait ~2 min for the project to spin up

---

## Step 2 — Run the Schema

1. In your Supabase project, go to **SQL Editor** (left sidebar)
2. Click **New query**
3. Paste the full contents of `supabase/schema.sql`
4. Click **Run** (▶)
5. You should see `Success` — all tables created

---

## Step 3 — Get Your API Keys

1. In Supabase, go to **Project Settings → API**
2. Copy:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **anon / public key** (the long JWT string under "Project API keys")
3. Open `lib/supabase.js` and replace:
   ```js
   const SUPABASE_URL  = "https://YOUR_PROJECT_ID.supabase.co";
   const SUPABASE_ANON = "YOUR_ANON_PUBLIC_KEY";
   ```

---

## Step 4 — Set Up the React Project

If you don't have a project yet:

```bash
npm create vite@latest fit-ignyte -- --template react
cd fit-ignyte
npm install
npm install @supabase/supabase-js
```

Then:
- Replace `src/App.jsx` with `FitIgnyte_Supabase.jsx`
- Create `src/lib/supabase.js` with the contents of `supabase/lib/supabase.js`
- Update the import path in the app:
  ```js
  import { ... } from "./lib/supabase";   // already correct if files are in src/
  ```

Run locally:
```bash
npm run dev
```

---

## Step 5 — Deploy to Vercel

1. Push your project to a GitHub repo
2. Go to https://vercel.com → **New Project** → import the repo
3. Vercel auto-detects Vite — click **Deploy**
4. Done! You'll get a URL like `https://fit-ignyte.vercel.app`

> **Tip:** For security, add your Supabase keys as **Environment Variables** in Vercel
> instead of hardcoding them:
> - `VITE_SUPABASE_URL`
> - `VITE_SUPABASE_ANON_KEY`
>
> Then in `lib/supabase.js`:
> ```js
> const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
> const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
> ```

---

## Database Tables Overview

| Table | Purpose |
|---|---|
| `plans` | Meal plans (name, price, kcal, meals/day, color) |
| `clients` | All client data (contact, plan, payment, dates) |
| `menu` | Weekly menu — one row per day (Mon–Fri) |
| `meal_selections` | Per-client per-day meal choices |
| `checklist` | Weekly checklist checkbox states |
| `delivery_status` | Daily delivery done/pending per client |

---

## Notes

- **Row Level Security (RLS)** is enabled with open policies (all access).
  Once you add user authentication, replace the policies to restrict access
  to authenticated users only.
- The `plans` table uses a custom text `id` (e.g. `"lf"`, `"ab"`).
  You can add more plans directly from the app's Menu tab.
- Meal selections are upserted (insert or update) so you can safely
  re-run the app multiple times without duplicates.
