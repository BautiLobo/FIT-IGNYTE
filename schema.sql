-- ============================================================
--  FIT IGNYTE — Supabase Schema
--  Run this in the Supabase SQL Editor (Database → SQL Editor)
-- ============================================================

-- ── PLANS ────────────────────────────────────────────────────
CREATE TABLE plans (
  id         TEXT PRIMARY KEY,           -- e.g. "lf", "ab"
  name       TEXT NOT NULL UNIQUE,
  kcal       INTEGER NOT NULL DEFAULT 0,
  meals      INTEGER NOT NULL DEFAULT 1,
  price      INTEGER NOT NULL DEFAULT 0,
  tier       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '#38BDF8',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CLIENTS ──────────────────────────────────────────────────
CREATE TABLE clients (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT DEFAULT '',
  language        TEXT DEFAULT 'EN',
  district        TEXT DEFAULT '',
  address         TEXT DEFAULT '',
  access          TEXT DEFAULT '',
  deliveries      INTEGER DEFAULT 1,
  delivery_time   TEXT DEFAULT '',
  plan            TEXT REFERENCES plans(name) ON UPDATE CASCADE,
  status          TEXT DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Paused','Trial')),
  start_date      DATE,
  expiry_date     DATE,
  paid            BOOLEAN DEFAULT FALSE,
  amount_paid     INTEGER DEFAULT 0,
  goal            TEXT DEFAULT '',
  allergies       TEXT DEFAULT '',
  customizations  TEXT DEFAULT '',
  acq_channel     TEXT DEFAULT '',
  ltv             INTEGER DEFAULT 0,
  weeks           INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── MENU ─────────────────────────────────────────────────────
-- One row per day, meals stored as a JSON array of 3 strings
CREATE TABLE menu (
  day     TEXT PRIMARY KEY CHECK (day IN ('Monday','Tuesday','Wednesday','Thursday','Friday')),
  meal1   TEXT DEFAULT '',
  meal2   TEXT DEFAULT '',
  meal3   TEXT DEFAULT '',
  snack   TEXT DEFAULT ''
);

-- Pre-populate with default menu so it's never empty
INSERT INTO menu (day, meal1, meal2, meal3, snack) VALUES
  ('Monday',    'Minced Beef & Sweet Potato Bowl (Chimichurri)', 'Tomato Parm Chicken Pasta (Tomato)',          'Tender Chx Thigh & Grain Bowl (Mango)',              'Hummus'),
  ('Tuesday',   'Norwegian Salmon Rice Bowl (Asia Mix)',         'Juicy Chx & Sweet Potato Bowl (BBQ)',         'Juicy Chx Power Wrap (Mustard Honey)',               'PB Cookie'),
  ('Wednesday', 'Tender Chx Thigh & Sweet Potato Bowl (Asia Mix)','Herb Pesto Chicken Pasta (Pesto)',           'Minced Beef & Egg Frittata Grain Bowl (Chimichurri)','Hummus'),
  ('Thursday',  'Juicy Chx Grain Blend Bowl (Curry)',            'Beef & Egg Power Wrap (Mango)',               'Pork & Pumpkin Rice Bowl (Mustard Honey)',           'PB Cookie'),
  ('Friday',    'Norwegian Salmon & Sweet Potato Bowl (Mango)',  'Tender Chx Thigh & Rice Bowl (Chimichurri)', 'Creamy Chicken Pasta (Cream)',                       'Tofu');

-- ── MEAL SELECTIONS ──────────────────────────────────────────
-- One row per client per day
CREATE TABLE meal_selections (
  id         SERIAL PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day        TEXT NOT NULL CHECK (day IN ('Monday','Tuesday','Wednesday','Thursday','Friday')),
  meal1      TEXT DEFAULT '',
  meal2      TEXT DEFAULT '—',
  meal3      TEXT DEFAULT '—',
  snack      TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  UNIQUE (client_id, day)
);

-- ── CHECKLIST ────────────────────────────────────────────────
-- Persists weekly checkbox state; reset each Monday
CREATE TABLE checklist (
  key        TEXT PRIMARY KEY,   -- e.g. "f1", "m2"
  checked    BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── DELIVERY STATUS ──────────────────────────────────────────
-- Tracks per-client delivered/pending each day
CREATE TABLE delivery_status (
  id         SERIAL PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day        TEXT NOT NULL CHECK (day IN ('Monday','Tuesday','Wednesday','Thursday','Friday')),
  delivered  BOOLEAN DEFAULT FALSE,
  date       DATE DEFAULT CURRENT_DATE,
  UNIQUE (client_id, day, date)
);

-- ============================================================
--  ROW LEVEL SECURITY (RLS)
--  For now: full access (you'll tighten this once you add auth)
-- ============================================================
ALTER TABLE plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu             ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_selections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist        ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_status  ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (open policy — replace with auth policy later)
CREATE POLICY "allow_all_plans"           ON plans           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_clients"         ON clients         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_menu"            ON menu            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_meal_selections" ON meal_selections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_checklist"       ON checklist       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_delivery"        ON delivery_status FOR ALL USING (true) WITH CHECK (true);
