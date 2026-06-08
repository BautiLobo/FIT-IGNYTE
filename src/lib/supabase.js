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
  const data = check(await supabase
    .from("clients")
    .select("*, plan:plan_id(id,name,kcal,meals,price,tier,color)")
    .order("id"), "getClients");
  return (data || []).map(c => ({
    ...c,
    planId:         c.plan_id         || "",
    planName:       c.plan?.name      || "",
    planObj:        c.plan            || null,
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
    plan_id:        client.planId         || null,
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
  const [menuData, libData] = await Promise.all([
    supabase.from("menu").select("*"),
    supabase.from("meal_library").select("*"),
  ]);
  check(menuData, "getMenu");
  check(libData, "getMealLibraryForMenu");

  const libById = {};
  for (const m of (libData.data || [])) libById[m.id] = m;

  const out = {};
  for (const row of (menuData.data || [])) {
    const mealIds = row.meals_json || [];
    const snackObj = row.snack_id ? libById[row.snack_id] : null;
    out[row.day] = {
      meals:    mealIds.map(id => libById[id]).filter(Boolean),
      mealIds,
      snack:    snackObj?.name || "",
      snackId:  row.snack_id || "",
      snackObj: snackObj || null,
    };
  }
  return out;
}

export async function updateMenuDay(day, { mealIds, snackId }) {
  check(await supabase.from("menu").upsert({
    day,
    meals_json: mealIds || [],
    snack_id:   snackId || "",
  }), "updateMenuDay");
}

// ── MEAL SELECTIONS ──────────────────────────────────────────
export async function getMealSelections() {
  // Join with meal_library to get full meal objects
  const data = check(
    await supabase.from("meal_selections")
      .select("*, snack:snack_id(id,name,kcal,protein,carbs,fat,is_snack)"),
    "getMealSelections"
  );
  // Index by client_id -> day -> array of slots
  const out = {};
  for (const row of (data || [])) {
    const cid = String(row.client_id);
    if (!out[cid]) out[cid] = {};
    if (!out[cid][row.day]) out[cid][row.day] = [];
    out[cid][row.day].push({
      id:           row.id,
      slot:         row.slot,
      mealIds:      row.meals_json || [],
      deliveryTime: row.delivery_time || "",
      snackId:      row.snack_id || "",
      snack:        row.snack?.name || "",
      snackObj:     row.snack || null,
      note:         row.note || "",
    });
    // Sort by slot
    out[cid][row.day].sort((a,b) => a.slot - b.slot);
  }
  return out;
}

export async function upsertMealSelection(clientId, day, slot, { mealIds, deliveryTime, snackId, note }) {
  check(await supabase.from("meal_selections").upsert({
    client_id:     clientId,
    day,
    slot:          slot || 1,
    meals_json:    mealIds || [],
    delivery_time: deliveryTime || "",
    snack_id:      snackId || null,
    note:          note || "",
  }, { onConflict: "client_id,day,slot" }), "upsertMealSelection");
}

export async function deleteMealSelection(clientId, day, slot) {
  check(await supabase.from("meal_selections")
    .delete()
    .eq("client_id", clientId)
    .eq("day", day)
    .eq("slot", slot),
  "deleteMealSelection");
}

// ── CHECKLIST ────────────────────────────────────────────────
export async function getChecklist() {
  return check(await supabase.from("checklist").select("*"), "getChecklist");
}
export async function toggleChecklistItem(key, checked) {
  check(await supabase.from("checklist").upsert({ key, checked, updated_at: new Date().toISOString() }), "toggleChecklist");
}

// ── MEAL LIBRARY ─────────────────────────────────────────────
export async function getMealLibrary() {
  return check(await supabase.from("meal_library").select("*").order("name"), "getMealLibrary");
}
export async function upsertMealLibrary(meal) {
  return check(await supabase.from("meal_library").upsert(meal).select().single(), "upsertMealLibrary");
}
export async function deleteMealLibrary(id) {
  check(await supabase.from("meal_library").delete().eq("id", id), "deleteMealLibrary");
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

// ── SETTINGS ─────────────────────────────────────────────────
export async function getSettings(keys) {
  const data = check(await supabase.from("settings").select("*").in("key", keys), "getSettings");
  const out = {};
  for (const row of (data || [])) out[row.key] = row.value;
  return out;
}
export async function upsertSetting(key, value) {
  check(await supabase.from("settings").upsert({key, value}), "upsertSetting");
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
