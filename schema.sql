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
--  Lectura: abierta a todos (clientes del mini-program necesitan
--  ver su propio plan/comidas sin login).
--  Escritura (INSERT/UPDATE/DELETE): solo usuarios autenticados
--  de Supabase Auth (la web, y el admin del mini-program una vez
--  que tenga su propio JWT vía wx-login).
-- ============================================================

ALTER TABLE plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu             ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_selections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist        ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_status  ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_library     ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE address_changes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_plans"           ON plans;
DROP POLICY IF EXISTS "allow_all_clients"         ON clients;
DROP POLICY IF EXISTS "allow_all_menu"            ON menu;
DROP POLICY IF EXISTS "allow_all_meal_selections" ON meal_selections;
DROP POLICY IF EXISTS "allow_all_checklist"       ON checklist;
DROP POLICY IF EXISTS "allow_all_delivery"        ON delivery_status;
DROP POLICY IF EXISTS "allow_all_meal_library"    ON meal_library;
DROP POLICY IF EXISTS "allow_all_new_orders"      ON new_orders;
DROP POLICY IF EXISTS "allow_all_settings"        ON settings;
DROP POLICY IF EXISTS "Allow all"                 ON address_changes;
DROP POLICY IF EXISTS "Allow all"                 ON notifications;

-- ── Catálogo / planes: lectura libre, escritura solo admin ──
CREATE POLICY "select_all_plans"   ON plans FOR SELECT USING (true);
CREATE POLICY "write_auth_plans"   ON plans FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "update_auth_plans"  ON plans FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_plans"  ON plans FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "select_all_menu"    ON menu FOR SELECT USING (true);
CREATE POLICY "write_auth_menu"    ON menu FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "update_auth_menu"   ON menu FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_menu"   ON menu FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "select_all_meal_library"   ON meal_library FOR SELECT USING (true);
CREATE POLICY "write_auth_meal_library"   ON meal_library FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "update_auth_meal_library"  ON meal_library FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_meal_library"  ON meal_library FOR DELETE USING (auth.role() = 'authenticated');

-- ── Clientes: lectura libre (mini-program lee su propio registro
--    por id), escritura solo admin ──
CREATE POLICY "select_all_clients"  ON clients FOR SELECT USING (true);
CREATE POLICY "write_auth_clients"  ON clients FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "update_auth_clients" ON clients FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_clients" ON clients FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "select_all_meal_selections"  ON meal_selections FOR SELECT USING (true);
CREATE POLICY "write_auth_meal_selections"  ON meal_selections FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "update_auth_meal_selections" ON meal_selections FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_meal_selections" ON meal_selections FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "select_all_checklist"  ON checklist FOR SELECT USING (true);
CREATE POLICY "write_auth_checklist"  ON checklist FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "update_auth_checklist" ON checklist FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_checklist" ON checklist FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "select_all_delivery"  ON delivery_status FOR SELECT USING (true);
CREATE POLICY "write_auth_delivery"  ON delivery_status FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "update_auth_delivery" ON delivery_status FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_delivery" ON delivery_status FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "select_all_settings"  ON settings FOR SELECT USING (true);
CREATE POLICY "write_auth_settings"  ON settings FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "update_auth_settings" ON settings FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_settings" ON settings FOR DELETE USING (auth.role() = 'authenticated');

-- ── new_orders: clientes nuevos insertan sin login (registro),
--    pero leer/aprobar/rechazar pedidos requiere admin ──
CREATE POLICY "insert_anon_new_orders"  ON new_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "select_auth_new_orders"  ON new_orders FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "update_auth_new_orders"  ON new_orders FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_new_orders"  ON new_orders FOR DELETE USING (auth.role() = 'authenticated');

-- ── address_changes: cliente inserta su pedido de cambio sin login,
--    admin lee/aprueba/rechaza ──
CREATE POLICY "insert_anon_address_changes" ON address_changes FOR INSERT WITH CHECK (true);
CREATE POLICY "select_auth_address_changes" ON address_changes FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "update_auth_address_changes" ON address_changes FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_address_changes" ON address_changes FOR DELETE USING (auth.role() = 'authenticated');

-- ── notifications: el cliente lee/marca como leídas las suyas sin
--    login (no tiene auth propio); el admin crea/borra cualquiera ──
CREATE POLICY "select_all_notifications"  ON notifications FOR SELECT USING (true);
CREATE POLICY "update_all_notifications"  ON notifications FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "insert_auth_notifications" ON notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "delete_auth_notifications" ON notifications FOR DELETE USING (auth.role() = 'authenticated');
