// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const check = ({ data, error }, label) => {
  if (error) { console.error(`[${label}]`, error.message); throw error; }
  return data;
};

// ── PLANS ────────────────────────────────────────────────────
export async function getPlans() {
  return check(await supabase.from("plans").select("*").order("price"), "getPlans");
}
export async function upsertPlan(plan) {
  return check(await supabase.from("plans").upsert(plan).select().single(), "upsertPlan");
}
export async function deletePlan(id) {
  check(await supabase.from("plans").delete().eq("id", id), "deletePlan");
}

// ── CLIENTS ──────────────────────────────────────────────────
export async function getClients() {
  const data = check(await supabase.from("clients").select("*").order("id"), "getClients");
  return (data || []).map(c => ({
    ...c,
    startDate:      c.start_date      || "",
    expiryDate:     c.expiry_date     || "",
    deliveryTime:   c.delivery_time   || "",
    amountPaid:     c.amount_paid     || 0,
    acqChannel:     c.acq_channel     || "",
    wechatOpenid:   c.wechat_openid   || "",
    statusNote:     c.status_note     || "",
    pausedUntil:    c.paused_until    || null,
  }));
}
export async function upsertClient(client) {
  const mapped = {
    name:           client.name,
    phone:          client.phone          || "",
    language:       client.language       || "EN",
    district:       client.district       || "",
    address:        client.address        || "",
    access:         client.access         || "",
    deliveries:     client.deliveries     || 1,
    delivery_time:  client.deliveryTime   || "",
    plan:           client.plan           || null,
    status:         client.status         || "Active",
    start_date:     client.startDate      || null,
    expiry_date:    client.expiryDate     || null,
    paid:           client.paid           ?? false,
    amount_paid:    client.amountPaid     || 0,
    goal:           client.goal           || "",
    allergies:      client.allergies      || "",
    customizations: client.customizations || "",
    acq_channel:    client.acqChannel     || "",
    ltv:            client.ltv            || 0,
    weeks:          client.weeks          || 0,
    wechat_openid:  client.wechatOpenid   || "",
    status_note:    client.statusNote     || "",
    paused_until:   client.pausedUntil    || null,
  };
  if (client.id) mapped.id = client.id;
  return check(await supabase.from("clients").upsert(mapped).select().single(), "upsertClient");
}
export async function deleteClient(id) {
  check(await supabase.from("clients").delete().eq("id", id), "deleteClient");
}

// ── MENU ─────────────────────────────────────────────────────
export async function getMenu() {
  const data = check(await supabase.from("menu").select("*"), "getMenu");
  const out = {};
  for (const row of (data || [])) {
    out[row.day] = {
      meals: [row.meal1, row.meal2, row.meal3].filter(Boolean),
      snack: row.snack || "",
    };
  }
  return out;
}
export async function updateMenuDay(day, { meal1, meal2, meal3, snack }) {
  check(await supabase.from("menu").upsert({
    day, meal1: meal1||"", meal2: meal2||"", meal3: meal3||"", snack: snack||"",
  }), "updateMenuDay");
}

// ── MEAL SELECTIONS ──────────────────────────────────────────
export async function getMealSelections() {
  const data = check(await supabase.from("meal_selections").select("*"), "getMealSelections");
  // Convert array to object indexed by client_id -> day -> row
  const out = {};
  for (const row of (data || [])) {
    const cid = String(row.client_id);
    if (!out[cid]) out[cid] = {};
    out[cid][row.day] = row;
  }
  return out;
}
export async function upsertMealSelection(clientId, day, { meal1, meal2, meal3, snack, note }) {
  check(await supabase.from("meal_selections").upsert({
    client_id: clientId, day,
    meal1: meal1||"", meal2: meal2||"—", meal3: meal3||"—",
    snack: snack||"", note: note||"",
  }, { onConflict: "client_id,day" }), "upsertMealSelection");
}

// ── CHECKLIST ────────────────────────────────────────────────
export async function getChecklist() {
  return check(await supabase.from("checklist").select("*"), "getChecklist");
}
export async function toggleChecklistItem(key, checked) {
  check(await supabase.from("checklist").upsert({ key, checked, updated_at: new Date().toISOString() }), "toggleChecklist");
}

// ── NEW ORDERS ───────────────────────────────────────────────
export async function createNewOrder(order) {
  return check(await supabase.from("new_orders").insert(order).select().single(), "createNewOrder");
}
export async function getPendingOrders() {
  return check(await supabase.from("new_orders").select("*").eq("status","pending").order("created_at"), "getPendingOrders");
}
export async function updateOrderStatus(id, status, note) {
  check(await supabase.from("new_orders").update({ status, note: note||"" }).eq("id", id), "updateOrderStatus");
}

// ── STORAGE ──────────────────────────────────────────────────
export async function uploadMealPhoto(file, mealId) {
  const ext  = file.name.split(".").pop();
  const path = `${mealId}.${ext}`;
  const { error } = await supabase.storage.from("meal-photos").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("meal-photos").getPublicUrl(path);
  return data.publicUrl;
}
export async function uploadDocument(file, name) {
  const { error } = await supabase.storage.from("documents").upload(name, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("documents").getPublicUrl(name);
  return data.publicUrl;
}