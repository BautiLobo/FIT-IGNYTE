// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── AUTH ─────────────────────────────────────────────────────
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}
export async function signOut() {
  await supabase.auth.signOut();
}
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}

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

// ── TIERS ────────────────────────────────────────────────────
export async function getTiers() {
  return check(await supabase.from("tiers").select("*").order("name"), "getTiers");
}
export async function upsertTier(tier) {
  return check(await supabase.from("tiers").upsert(tier).select().single(), "upsertTier");
}
export async function deleteTier(id) {
  check(await supabase.from("tiers").delete().eq("id", id), "deleteTier");
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
  };
  if (client.id) mapped.id = client.id;
  return check(await supabase.from("clients").upsert(mapped).select().single(), "upsertClient");
}
export async function deleteClient(id) {
  check(await supabase.from("clients").delete().eq("id", id), "deleteClient");
}

// ── MENU ─────────────────────────────────────────────────────
// out[weekIndex][tier][day] — weekIndex is "1".."4" (the rotating menu slot),
// tier is whatever string is stored in menu.tier
export async function getMenu() {
  const [menuData, libData] = await Promise.all([
    supabase.from("menu").select("*"),
    supabase.from("meal_library").select("*"),
  ]);
  check(menuData, "getMenu");
  check(libData, "getMealLibraryForMenu");

  const libById = {};
  for (const m of (libData.data || [])) libById[m.id] = m;

  const out = {1:{},2:{},3:{},4:{}};
  for (const row of (menuData.data || [])) {
    const tier = row.tier || "SMALL";
    const week = row.week_index || 1;
    if (!out[week]) out[week] = {};
    if (!out[week][tier]) out[week][tier] = {};
    const mealIds = row.meals_json || [];
    const snackObj = row.snack_id ? libById[row.snack_id] : null;
    out[week][tier][row.day] = {
      meals:    mealIds.map(id => libById[id]).filter(Boolean),
      mealIds,
      snack:    snackObj?.name || "",
      snackId:  row.snack_id || "",
      snackObj: snackObj || null,
    };
  }
  return out;
}

export async function updateMenuDay(day, tier, weekIndex, { mealIds, snackId }) {
  check(await supabase.from("menu").upsert({
    day,
    tier:       tier || "SMALL",
    week_index: weekIndex || 1,
    meals_json: mealIds || [],
    snack_id:   snackId || null,
  }, { onConflict: "day,tier,week_index" }), "updateMenuDay");
}

// ── MENU ROTATION ────────────────────────────────────────────
// The "live" week (1-4) is computed from an anchor date stored in settings,
// so nobody has to manually flip a switch every week. The order in which the
// 4 menu variants play (e.g. 4,2,3,1 instead of 1,2,3,4) is itself
// configurable via menu_rotation_order, so the cycle can be rearranged.
function parseRotationOrder(raw) {
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length === 4 && [1,2,3,4].every(w => arr.includes(w))) return arr;
  } catch { /* fall through to default */ }
  return [1,2,3,4];
}

export async function getMenuRotationOrder() {
  const settings = await getSettings(["menu_rotation_order"]);
  return parseRotationOrder(settings.menu_rotation_order);
}

export async function setMenuRotationOrder(order) {
  await upsertSetting("menu_rotation_order", JSON.stringify(order));
}

export async function getCurrentWeekIndex() {
  const settings = await getSettings(["menu_rotation_anchor", "menu_rotation_order"]);
  const anchor = settings.menu_rotation_anchor ? new Date(settings.menu_rotation_anchor + "T00:00:00") : new Date();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksSinceAnchor = Math.floor((Date.now() - anchor.getTime()) / msPerWeek);
  const slot = ((weeksSinceAnchor % 4) + 4) % 4;
  const order = parseRotationOrder(settings.menu_rotation_order);
  return order[slot];
}

// Shifts the live week forward/backward by `delta` weeks (e.g. +1 to advance
// to next week's menu, -1 to go back) by moving the anchor date.
export async function shiftMenuRotation(delta) {
  const settings = await getSettings(["menu_rotation_anchor"]);
  const anchor = settings.menu_rotation_anchor ? new Date(settings.menu_rotation_anchor + "T00:00:00") : new Date();
  anchor.setDate(anchor.getDate() - delta * 7);
  const y = anchor.getFullYear(), m = String(anchor.getMonth()+1).padStart(2,"0"), d = String(anchor.getDate()).padStart(2,"0");
  await upsertSetting("menu_rotation_anchor", `${y}-${m}-${d}`);
  return getCurrentWeekIndex();
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
      sauceIds:     row.sauce_ids || [],
    });
    // Sort by slot
    out[cid][row.day].sort((a,b) => a.slot - b.slot);
  }
  return out;
}

export async function upsertMealSelection(clientId, day, slot, { mealIds, deliveryTime, snackId, note, sauceIds }) {
  check(await supabase.from("meal_selections").upsert({
    client_id:     clientId,
    day,
    slot:          slot || 1,
    meals_json:    mealIds || [],
    delivery_time: deliveryTime || "",
    snack_id:      snackId || null,
    note:          note || "",
    sauce_ids:     sauceIds || [],
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

// Returns how many saved client meal_selections reference this meal/snack/sauce id —
// used to warn before deleting a meal_library row that's already "locked in" for clients.
export async function getMealUsageCount(id) {
  const [inMeals, inSnack, inSauce] = await Promise.all([
    supabase.from("meal_selections").select("id", { count: "exact", head: true }).contains("meals_json", [id]),
    supabase.from("meal_selections").select("id", { count: "exact", head: true }).eq("snack_id", id),
    supabase.from("meal_selections").select("id", { count: "exact", head: true }).contains("sauce_ids", [id]),
  ]);
  return (inMeals.count || 0) + (inSnack.count || 0) + (inSauce.count || 0);
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

const ORDER_DAY_KEYS = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday" };

// Approve a pending new_order: upsert the client, sync its weekly meal
// selections, mark the order approved, then push-notify the client.
export async function approveOrder(order) {
  const existing = order.phone
    ? check(await supabase.from("clients").select("id").eq("phone", order.phone).maybeSingle(), "approveOrder:findClient")
    : null;

  const clientFields = {
    name:           order.name,
    phone:          order.phone          || "",
    district:       order.district       || "",
    address:        order.address        || "",
    access:         order.access         || "",
    allergies:      order.allergies      || "",
    goal:           order.goal           || "",
    plan_id:        order.plan_id        || null,
    status:         "Pending Payment",
    wechat_openid:  order.wechat_openid  || "",
  };

  let clientId;
  if (existing) {
    clientId = existing.id;
    check(await supabase.from("clients").update({
      ...clientFields,
      expiry_date: order.expiry_date || null,
    }).eq("id", clientId), "approveOrder:updateClient");
  } else {
    const created = check(await supabase.from("clients").insert({
      ...clientFields,
      start_date: new Date().toISOString().slice(0,10),
      paid: false,
    }).select().single(), "approveOrder:createClient");
    clientId = created.id;
  }

  const meals = order.meals || {};
  for (const [key, dayName] of Object.entries(ORDER_DAY_KEYS)) {
    const slot = meals[key];
    if (!slot) continue;
    check(await supabase.from("meal_selections").upsert({
      client_id:     clientId,
      day:           dayName,
      slot:          1,
      meals_json:    slot.meal_ids || [],
      delivery_time: slot.time || "",
      snack_id:      slot.snack_id || null,
      note:          slot.notes || "",
    }, { onConflict: "client_id,day,slot" }), "approveOrder:syncMealSelection");
  }

  check(await supabase.from("new_orders").update({ status: "approved" }).eq("id", order.id), "approveOrder:markApproved");

  await pushNotify(clientId, "FIT IGNYTE", "Order approved!");
  return clientId;
}

export async function rejectOrder(id, note) {
  check(await supabase.from("new_orders").update({ status: "rejected", note: note || "" }).eq("id", id), "rejectOrder");
}

// ── ADDRESS CHANGES ──────────────────────────────────────────
export async function getPendingAddressChanges() {
  return check(await supabase.from("address_changes").select("*, client:client_id(id,name)").eq("status","pending").order("created_at"), "getPendingAddressChanges");
}
export async function approveAddressChange(change) {
  check(await supabase.from("clients").update({
    district: change.new_district || "",
    address:  change.new_address  || "",
  }).eq("id", change.client_id), "approveAddressChange:updateClient");
  check(await supabase.from("address_changes").update({ status: "approved" }).eq("id", change.id), "approveAddressChange:markApproved");
  await createNotification(change.client_id, "Address change approved", `Your new address (${change.new_district} — ${change.new_address}) has been confirmed.`);
  await pushNotify(change.client_id, "FIT IGNYTE", "Address approved");
}
export async function rejectAddressChange(change, note) {
  check(await supabase.from("address_changes").update({ status: "rejected", rejection_note: note || "" }).eq("id", change.id), "rejectAddressChange");
  await createNotification(change.client_id, "Address change rejected", note || "Your address change request was not approved.");
  await pushNotify(change.client_id, "FIT IGNYTE", "Address rejected");
}

// ── NOTIFICATIONS (in-app) ───────────────────────────────────
export async function createNotification(clientId, title, message) {
  check(await supabase.from("notifications").insert({ client_id: clientId, title, message, is_read: false }), "createNotification");
}
export async function getNotifications() {
  return check(await supabase
    .from("notifications")
    .select("*, client:client_id(id,name)")
    .order("created_at", { ascending: false })
    .limit(100), "getNotifications");
}
export async function deleteNotification(id) {
  check(await supabase.from("notifications").delete().eq("id", id), "deleteNotification");
}
export async function sendNotification(clientId, title, message) {
  await createNotification(clientId, title, message);
  await pushNotify(clientId, "FIT IGNYTE", title);
}

// ── WECHAT PUSH ───────────────────────────────────────────────
// Best-effort: never throws, never blocks the calling flow.
export async function pushNotify(clientId, writer, content) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/wx-notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        template_id: "A7o5PTcftFBe1nYsidWchFofz2z_DN9Whn_96H60x2M",
        data: {
          name1:  { value: String(writer).slice(0,10) },
          thing2: { value: String(content).slice(0,20) },
          time4:  { value: new Date().toISOString().slice(0,16).replace("T"," ") },
        },
      }),
    });
  } catch (e) {
    console.error("[pushNotify]", e);
  }
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
