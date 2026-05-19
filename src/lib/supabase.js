// lib/supabase.js
// ─────────────────────────────────────────────────────────────────────────────
//  Replace the two values below with your actual Supabase project credentials.
//  Find them in: Supabase Dashboard → Project Settings → API
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://ychpcxloiwelyrwcsebf.supabase.co";   // ← replace
const SUPABASE_ANON = "sb_publishable_w005PkNGK7HYgPVU-Ps6-A_zWbb-MZj";                   // ← replace

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── PLANS ────────────────────────────────────────────────────────────────────

export async function getPlans() {
  const { data, error } = await supabase.from("plans").select("*").order("price");
  if (error) throw error;
  return data;
}

export async function upsertPlan(plan) {
  const { data, error } = await supabase.from("plans").upsert(plan).select().single();
  if (error) throw error;
  return data;
}

export async function deletePlan(id) {
  const { error } = await supabase.from("plans").delete().eq("id", id);
  if (error) throw error;
}

// ─── CLIENTS ──────────────────────────────────────────────────────────────────

export async function getClients() {
  const { data, error } = await supabase.from("clients").select("*").order("id");
  if (error) throw error;
  // Map snake_case DB columns → camelCase used in the app
  return data.map(dbToClient);
}

export async function upsertClient(client) {
  const row = clientToDb(client);
  const { data, error } = await supabase
    .from("clients")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return dbToClient(data);
}

export async function deleteClient(id) {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
}

// ─── MENU ─────────────────────────────────────────────────────────────────────

export async function getMenu() {
  const { data, error } = await supabase.from("menu").select("*");
  if (error) throw error;
  // Convert array of rows → { Monday: { meals:[...], snack }, ... }
  const menu = {};
  for (const row of data) {
    menu[row.day] = {
      meals: [row.meal1, row.meal2, row.meal3].filter(Boolean),
      snack: row.snack,
    };
  }
  return menu;
}

export async function updateMenuDay(day, { meal1, meal2, meal3, snack }) {
  const { error } = await supabase
    .from("menu")
    .update({ meal1, meal2, meal3, snack })
    .eq("day", day);
  if (error) throw error;
}

// ─── MEAL SELECTIONS ──────────────────────────────────────────────────────────

export async function getMealSelections() {
  const { data, error } = await supabase.from("meal_selections").select("*");
  if (error) throw error;
  // Convert rows → { [clientId]: { Monday: { meal1, meal2, snack, note }, ... } }
  const selections = {};
  for (const row of data) {
    if (!selections[row.client_id]) selections[row.client_id] = {};
    selections[row.client_id][row.day] = {
      meal1: row.meal1,
      meal2: row.meal2,
      meal3: row.meal3,
      snack: row.snack,
      note:  row.note,
    };
  }
  return selections;
}

export async function upsertMealSelection(clientId, day, { meal1, meal2, meal3, snack, note }) {
  const { error } = await supabase.from("meal_selections").upsert({
    client_id: clientId,
    day,
    meal1: meal1 || "",
    meal2: meal2 || "—",
    meal3: meal3 || "—",
    snack: snack || "",
    note:  note  || "",
  }, { onConflict: "client_id,day" });
  if (error) throw error;
}

// ─── CHECKLIST ────────────────────────────────────────────────────────────────

export async function getChecklist() {
  const { data, error } = await supabase.from("checklist").select("*");
  if (error) throw error;
  const checks = {};
  for (const row of data) checks[row.key] = row.checked;
  return checks;
}

export async function toggleChecklistItem(key, checked) {
  const { error } = await supabase.from("checklist").upsert(
    { key, checked, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throw error;
}

// ─── DELIVERY STATUS ──────────────────────────────────────────────────────────

export async function getDeliveryStatus(date) {
  const { data, error } = await supabase
    .from("delivery_status")
    .select("*")
    .eq("date", date);
  if (error) throw error;
  const status = {};
  for (const row of data) status[`d_${row.client_id}`] = row.delivered;
  return status;
}

export async function toggleDelivery(clientId, day, delivered, date) {
  const { error } = await supabase.from("delivery_status").upsert(
    { client_id: clientId, day, delivered, date },
    { onConflict: "client_id,day,date" }
  );
  if (error) throw error;
}

// ─── FIELD MAPPERS ────────────────────────────────────────────────────────────

function dbToClient(row) {
  return {
    id:             row.id,
    name:           row.name,
    phone:          row.phone         || "",
    language:       row.language      || "EN",
    district:       row.district      || "",
    address:        row.address       || "",
    access:         row.access        || "",
    deliveries:     row.deliveries    ?? 1,
    deliveryTime:   row.delivery_time || "",
    plan:           row.plan          || "",
    status:         row.status        || "Active",
    startDate:      row.start_date    || "",
    expiryDate:     row.expiry_date   || "",
    paid:           row.paid          ?? false,
    amountPaid:     row.amount_paid   ?? 0,
    goal:           row.goal          || "",
    allergies:      row.allergies     || "",
    customizations: row.customizations|| "",
    acqChannel:     row.acq_channel   || "",
    ltv:            row.ltv           ?? 0,
    weeks:          row.weeks         ?? 0,
  };
}

function clientToDb(client) {
  const row = {
    name:           client.name,
    phone:          client.phone          || "",
    language:       client.language       || "EN",
    district:       client.district       || "",
    address:        client.address        || "",
    access:         client.access         || "",
    deliveries:     client.deliveries     ?? 1,
    delivery_time:  client.deliveryTime   || "",
    plan:           client.plan           || null,
    status:         client.status         || "Active",
    start_date:     client.startDate      || null,
    expiry_date:    client.expiryDate     || null,
    paid:           client.paid           ?? false,
    amount_paid:    client.amountPaid     ?? 0,
    goal:           client.goal           || "",
    allergies:      client.allergies      || "",
    customizations: client.customizations || "",
    acq_channel:    client.acqChannel     || "",
    ltv:            client.ltv            ?? 0,
    weeks:          client.weeks          ?? 0,
  };
  if (client.id) row.id = client.id;
  return row;
}
