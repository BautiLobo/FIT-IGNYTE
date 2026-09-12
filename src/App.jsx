// FitIgnyte.jsx — Full app connected to Supabase
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  getPlans, upsertPlan, deletePlan as dbDeletePlan,
  getTiers, upsertTier, deleteTier as dbDeleteTier,
  getClients, upsertClient, deleteClient as dbDeleteClient,
  getMenu, updateMenuDay, getCurrentWeekIndex, getMenuRotationOrder, setMenuRotationOrder,
  getMealSelections, upsertMealSelection, getPendingMealSelections,
  getChecklist, toggleChecklistItem,
  signIn, signOut, getSession, onAuthChange,
  getPendingOrders, getRejectedOrders, getApprovedOrders, approveOrder, rejectOrder, reApproveOrder, deleteNewOrder,
  getCoaches, createCoach, deleteCoach,
  incrementRenewalCount,
  getPendingAddressChanges, approveAddressChange, rejectAddressChange,
  getNotifications, sendNotification, deleteNotification,
  getMealWeeklyStats,
  upsertPushSubscription, removePushSubscription,
  getIngredients, upsertIngredient, deleteIngredient as dbDeleteIngredient,
  getMealIngredients, upsertMealIngredient, deleteMealIngredient as dbDeleteMealIngredient,
  uploadIngredientPhoto,
  getPaidPayments,
  getEmployees, upsertEmployee, deleteEmployee as dbDeleteEmployee,
  getOtherExpenses, upsertOtherExpense, deleteOtherExpense as dbDeleteOtherExpense,
  getAccountingSnapshots, upsertAccountingSnapshot,
  getOneTimeExpenses, upsertOneTimeExpense, deleteOneTimeExpense as dbDeleteOneTimeExpense,
  updateCoachCommission,
  upsertSetting,
} from "./lib/supabase";

// Debe coincidir con la VAPID_PUBLIC_KEY configurada en los secrets de la
// Edge Function send-order-push -- esta mitad es publica, va en el cliente.
const VAPID_PUBLIC_KEY = "BE5guMndtRihydrN8s0ZII2DI1N_yjfoHMyWVNElx9DjsPA9niSIHvNFWlkr8giO-Kg0CZtSrCU34fXzWqKp6TE";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DEFAULT_BATCHES = ["09:45", "11:00", "12:00", "16:00", "16:45", "17:45"];

// Sauces se miden en ml/L (son líquidos) -- todo lo demás en g/kg. La cantidad
// numérica guardada en meal_ingredients.quantity_grams no cambia de unidad,
// solo cómo se muestra según ingredient.category.
function fmtQty(qty, category) {
  const isVolume = category === "sauce";
  const unit = isVolume ? "ml" : "g";
  const bigUnit = isVolume ? "L" : "kg";
  return qty >= 1000 ? `${(qty / 1000).toFixed(2)} ${bigUnit}` : `${qty} ${unit}`;
}

function getBatch(time, batchList) {
  const list = batchList && batchList.length ? batchList : DEFAULT_BATCHES;
  if (!time) return list[list.length - 1];
  // Find the last batch that is <= delivery time
  let assigned = list[0];
  for (const b of list) {
    if (time >= b) assigned = b;
    else break;
  }
  return assigned;
}
const PLAN_COLORS = ["#38BDF8","#A78BFA","#F472B6","#FBBF24","#FB923C","#F87171","#34D399","#60A5FA","#E879F9","#FCD34D"];
const uid = () => Math.random().toString(36).slice(2, 9);

const BLANK_CLIENT = {
  name:"", phone:"", language:"EN", district:"", address:"", access:"",
  planId:"", planName:"", status:"Active",
  startDate:"", expiryDate:"", paid:false,
  goal:"", allergies:"", customizations:"", ltv:0, weeks:0,
  deliveryFee:null,
};
const BLANK_PLAN = { id:"", name:"", name_zh:"", kcal:0, meals:1, price:0, tier:"", tier_zh:"", color:"#38BDF8" };

// A delivery slot for a client on a given day
// { id, clientId, day, time, meals:[], snack:"", note:"" }

// TODAY is normalized to local midnight so all date-diff math (daysUntil,
// getRealStatus, clientActiveOnDay) agrees consistently — no more off-by-one
// or "Active" vs "Expired" mismatches caused by time-of-day drift.
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const daysUntil = d => {
  if (!d) return NaN;
  const target = new Date(d + "T00:00:00");
  return Math.round((target - TODAY) / 86400000);
};
// Fechas "YYYY-MM-DD" se parsean como medianoche LOCAL (no UTC) -- si no,
// `new Date("2026-08-21")` es medianoche UTC, que en husos horarios
// adelantados a UTC (China, UTC+8) ya cayó el dia anterior en hora local,
// y en husos atrasados (ej. UTC-3) se muestra un dia antes de la real.
// Mismo patron que ya usa daysUntil() arriba, aplicado tambien a mostrar
// texto de fecha.
const fmtDate   = d => {
  try {
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00") : new Date(d);
    return dt.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
  } catch { return d||"—"; }
};
// .toISOString() siempre da la fecha en UTC -- en husos adelantados a UTC
// (China, UTC+8) la medianoche local ya es el dia siguiente en UTC, y
// .toISOString().split("T")[0] devuelve el dia de ayer. Se arma el string
// a mano desde los componentes de fecha LOCALES en su lugar.
const todayIso  = () => {
  const y = TODAY.getFullYear();
  const m = String(TODAY.getMonth() + 1).padStart(2, "0");
  const d = String(TODAY.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const NOTIF_TEMPLATES = [
  {label:"Custom",              title:"",                    message:""},
  {label:"Delivery delayed",    title:"Delivery delayed",    message:"Your delivery today is running a bit late. Thanks for your patience!"},
  {label:"Payment reminder",    title:"Payment reminder",    message:"Your plan payment is due. Please confirm at your earliest convenience."},
  {label:"Plan expiring soon",  title:"Plan expiring soon",  message:"Your meal plan is expiring soon — renew now to avoid any interruption."},
  {label:"Menu update",         title:"New weekly menu",     message:"This week's menu has been updated. Check the app for details."},
  {label:"Holiday schedule",    title:"Holiday schedule",    message:"Delivery schedule will be adjusted for the upcoming holiday. See details in the app."},
];

// Single source of truth for client status — always computed fresh from dates,
// never read from a stored field. Mirrors the same logic used in the WeChat
// Mini Program so both systems are always consistent.
function getRealStatus(startDate, expiryDate) {
  if (!startDate || !expiryDate) return "Inactive";
  const start  = new Date(startDate  + "T00:00:00");
  const expiry = new Date(expiryDate + "T00:00:00");
  if (TODAY < start)  return "Upcoming";  // paid but plan hasn't started yet
  if (TODAY > expiry) return "Inactive";  // plan expired
  return "Active";                         // plan running right now
}

// Returns true if the client is Active (by computed status) on the given
// weekday name (e.g. "Monday"). Finds the closest occurrence of that weekday
// (this week) and checks if it falls within start_date..expiry_date.
const DAY_INDEX = {Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6,Sunday:0};
function clientActiveOnDay(c, dayName) {
  if (!c.startDate || !c.expiryDate) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayIdx = now.getDay(); // 0=Sun
  const targetIdx = DAY_INDEX[dayName] ?? -1;
  if (targetIdx === -1) return getRealStatus(c.startDate, c.expiryDate) === "Active";
  // diff=0 means today, 1-6 means that many days ahead (always forward-looking)
  const diff = (targetIdx - todayIdx + 7) % 7;
  const targetDate = new Date(now);
  targetDate.setDate(now.getDate() + diff);
  const start  = new Date(c.startDate  + "T00:00:00");
  const expiry = new Date(c.expiryDate + "T00:00:00");
  return targetDate >= start && targetDate <= expiry;
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const G = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap');
:root{--bg:#0a0a0a;--s1:#111;--s2:#1a1a1a;--s3:#242424;--bdr:#2a2a2a;--bdr2:#333;--txt:#e8e8e8;--muted:#8a8a8a;--dim:#666;--red:#E8342A;--red2:#ff4438;--green:#22c55e;--amber:#f59e0b;--blue:#38bdf8}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;width:100%;margin:0;padding:0}
#root{height:100%;width:100%}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--txt)}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--red);border-radius:2px}
.app{display:flex;height:100vh;overflow:hidden}
.hamburger{display:none;position:fixed;top:12px;left:12px;z-index:400;background:var(--s2);border:1px solid var(--bdr2);border-radius:6px;padding:8px 10px;cursor:pointer;color:var(--txt);font-size:18px;line-height:1}
.sb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:150}
.sb{width:280px;min-width:280px;background:var(--s1);border-right:1px solid var(--bdr);display:flex;flex-direction:column;transition:transform .25s;z-index:200}
.sb-logo{padding:30px 24px 22px;border-bottom:1px solid var(--bdr)}
.sb-brand{font-family:'Rajdhani',sans-serif;font-size:32px;font-weight:700;letter-spacing:2px}
.sb-brand span{color:var(--red)}
.sb-sub{font-size:11px;color:var(--muted);letter-spacing:3px;text-transform:uppercase;margin-top:3px}
.sb-week{margin:18px 24px;background:var(--s2);border:1px solid var(--bdr);border-radius:8px;padding:13px 16px}
.sb-week-lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.sb-week-val{font-family:'Rajdhani',sans-serif;font-size:17px;font-weight:600;color:var(--red);margin-top:3px}
.nav{flex:1;overflow-y:auto;padding:10px 0}
.ni{display:flex;align-items:center;gap:13px;width:100%;padding:14px 24px;background:none;border:none;border-left:3px solid transparent;color:var(--muted);font-family:'DM Sans',sans-serif;font-size:15px;font-weight:500;cursor:pointer;transition:all .15s;text-align:left}
.ni:hover{color:var(--txt);background:var(--s2)}
.ni.on{color:#fff;background:var(--s2);border-left-color:var(--red)}
.ni-ic{font-size:19px;flex-shrink:0}
.ni-badge{margin-left:auto;background:var(--red);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px}
.sb-footer{padding:20px 24px;border-top:1px solid var(--bdr)}
.sb-stat{font-size:13px;color:var(--dim)}
.sb-stat strong{color:var(--green)}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.topbar{height:54px;min-height:54px;background:var(--s1);border-bottom:1px solid var(--bdr);display:flex;align-items:center;padding:0 20px;gap:10px}
.tb-title{font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:700;letter-spacing:.5px}
.tb-right{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.content{flex:1;overflow-y:auto;padding:20px}
.btn{padding:7px 14px;border-radius:5px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;letter-spacing:.4px;transition:all .15s;white-space:nowrap}
.btn-r{background:var(--red);color:#fff}.btn-r:hover{background:var(--red2)}
.btn-g{background:var(--s3);color:var(--txt);border:1px solid var(--bdr2)}.btn-g:hover{border-color:var(--dim);color:#fff}
.btn-grn{background:#14532d;color:var(--green);border:1px solid #166534}.btn-grn:hover{background:#166534}
.btn-sm{padding:4px 10px;font-size:10px}
.btn-xs{padding:2px 8px;font-size:9px;border-radius:4px}
.inp,.sel,.txta{background:var(--s1);border:1px solid var(--bdr2);border-radius:5px;color:var(--txt);font-family:'DM Sans',sans-serif;font-size:12px;padding:8px 10px;outline:none;transition:border-color .15s;width:100%}
.inp:focus,.sel:focus,.txta:focus{border-color:var(--red)}
.sel option{background:var(--s2)}
.sel optgroup{background:var(--s2);color:var(--dim);font-size:10px}
.txta{resize:vertical;min-height:60px}
.srch{background:var(--s2);border:1px solid var(--bdr);border-radius:5px;color:var(--txt);font-family:'DM Sans',sans-serif;font-size:11px;padding:6px 10px;outline:none;width:180px}
.srch:focus{border-color:var(--red)}
.fltr{background:var(--s2);border:1px solid var(--bdr);border-radius:5px;color:var(--muted);font-family:'DM Sans',sans-serif;font-size:11px;padding:6px 10px;outline:none;cursor:pointer}
.panel{background:var(--s2);border:1px solid var(--bdr);border-radius:8px;overflow:hidden}
.panel-hd{padding:12px 16px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px}
.panel-title{font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:700;letter-spacing:.5px}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:20px}
.kpi{background:var(--s2);border:1px solid var(--bdr);border-radius:8px;padding:14px 15px;position:relative;overflow:hidden}
.kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--kc,var(--red))}
.kpi-lbl{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px}
.kpi-val{font-family:'Rajdhani',sans-serif;font-size:28px;font-weight:700;line-height:1;color:var(--kc,var(--red))}
.kpi-sub{font-size:9px;color:var(--dim);margin-top:4px}
.tbl-wrap{background:var(--s2);border:1px solid var(--bdr);border-radius:8px;overflow:hidden;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12px}
thead tr{background:#0f0f0f}
th{padding:9px 12px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--bdr);white-space:nowrap}
td{padding:8px 12px;border-bottom:1px solid #161616;color:var(--txt);vertical-align:middle}
tr:last-child td{border-bottom:none}
tbody tr:hover{background:#1e1e1e}
.bx{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:.2px;white-space:nowrap}
.bx-g{background:#052e16;color:#4ade80}
.bx-r{background:#450a0a;color:#f87171}
.bx-exp{background:#7f1d1d;color:#fca5a5;border:1px solid #ef4444}
.bx-a{background:#431407;color:#fb923c}
.bx-b{background:#0c1a2e;color:#60a5fa}
.bx-gr{background:#1a1a1a;color:var(--dim)}
.bx-clk{cursor:pointer;border:none;transition:all .15s}.bx-clk:hover{filter:brightness(1.2)}
.alert-bar{background:#1a0808;border:1px solid #7f1d1d;border-radius:6px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:11px;color:#fca5a5}
.mo{position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:500;padding:16px}
.mo-box{background:var(--s2);border:1px solid var(--bdr2);border-radius:10px;width:100%;max-width:680px;max-height:92vh;overflow-y:auto;display:flex;flex-direction:column}
.mo-hd{padding:16px 20px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.mo-title{font-family:'Rajdhani',sans-serif;font-size:17px;font-weight:700}
.mo-body{padding:20px;flex:1;overflow-y:auto}
.mo-ft{padding:12px 20px;border-top:1px solid var(--bdr);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fg-full{grid-column:1/-1}
.fl{display:flex;flex-direction:column;gap:4px}
.fl label{font-size:10px;color:var(--muted);font-weight:500;text-transform:uppercase;letter-spacing:.5px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--bdr);margin-bottom:16px;overflow-x:auto}
.tab{padding:8px 14px;background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;color:var(--muted);transition:all .15s;white-space:nowrap;flex-shrink:0}
.tab:hover{color:var(--txt)}
.tab.on{color:var(--red);border-bottom-color:var(--red)}
.kd-hd{background:var(--red);color:#fff;padding:9px 14px;border-radius:6px 6px 0 0;font-family:'Rajdhani',sans-serif;font-size:15px;font-weight:700;letter-spacing:1px;display:flex;justify-content:space-between;align-items:center}
.kr{display:flex;align-items:center;padding:9px 14px;border-bottom:1px solid #1c1c1c;background:var(--s2);font-size:11px}
.kr:last-child{border-bottom:none;border-radius:0 0 6px 6px}
.kc{background:var(--red);color:#fff;font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:800;min-width:38px;text-align:center;padding:1px 6px;border-radius:4px;margin-right:12px;flex-shrink:0}
.km{flex:1;color:#ddd;font-weight:500}
.kclients{font-size:10px;color:var(--dim);margin-left:12px}
.del-grp{margin-bottom:14px}
.del-time{background:var(--s3);color:var(--red);padding:6px 14px;border-radius:5px;font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;margin-bottom:4px;border:1px solid var(--bdr)}
.pb{height:3px;background:var(--s3);border-radius:2px;overflow:hidden;margin-top:5px}
.pb-f{height:100%;border-radius:2px;transition:width .3s}
.chk{width:17px;height:17px;border-radius:50%;border:2px solid var(--bdr2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s}
.chk.done{background:var(--green);border-color:var(--green)}
.chkrow{display:flex;align-items:flex-start;gap:9px;padding:7px 0;border-bottom:1px solid #161616;font-size:11px;color:var(--muted)}
.chkrow:last-child{border-bottom:none}
.step{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #161616}
.step:last-child{border-bottom:none}
.step-n{background:var(--red);color:#fff;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:12px;min-width:22px;text-align:center;border-radius:4px;padding:1px 4px}
.msel{background:var(--s1);border:1px solid var(--bdr);border-radius:4px;color:var(--txt);font-size:11px;padding:4px 7px;outline:none;cursor:pointer;width:100%;font-family:'DM Sans',sans-serif}
.msel:focus{border-color:var(--red)}
.msel:disabled{opacity:.3;cursor:default}
.plan-card{background:var(--s2);border:1px solid var(--bdr);border-radius:8px;padding:14px;border-left:3px solid var(--pc,#555)}
.chip{background:var(--s3);border-radius:4px;padding:2px 8px;font-size:10px;color:var(--muted);display:inline-block}
.sec-title{font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:700;letter-spacing:1.5px;color:var(--dim);text-transform:uppercase;margin-bottom:8px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.saving{position:fixed;bottom:16px;right:16px;background:var(--green);color:#fff;padding:7px 14px;border-radius:6px;font-size:11px;font-weight:600;z-index:600;animation:fadeOut 2s forwards}
@keyframes fadeOut{0%{opacity:1}70%{opacity:1}100%{opacity:0}}
.color-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.color-dot{width:22px;height:22px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all .15s;flex-shrink:0}
.color-dot.sel{border-color:#fff;transform:scale(1.2)}
.empty-state{text-align:center;padding:60px 20px;color:var(--muted)}
.empty-state-icon{font-size:40px;margin-bottom:12px}
.empty-state-title{font-family:'Rajdhani',sans-serif;font-size:18px;color:var(--dim);margin-bottom:6px}
.empty-state-sub{font-size:12px}

/* ── MEAL SELECTIONS ── */
.client-card{background:var(--s2);border:1px solid var(--bdr);border-radius:8px;margin-bottom:12px;overflow:hidden}
.client-card-hd{background:var(--s3);padding:10px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--bdr)}
.client-card-name{font-size:13px;font-weight:600;color:#fff;flex:1}
.slot-row{padding:10px 14px;border-bottom:1px solid #161616;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.slot-row:last-child{border-bottom:none}
.slot-num{font-family:'Rajdhani',sans-serif;font-size:11px;font-weight:700;color:var(--red);min-width:52px;padding-top:18px;flex-shrink:0}
.slot-fields{display:flex;gap:8px;flex:1;flex-wrap:wrap}
.slot-field{display:flex;flex-direction:column;gap:3px;flex:1;min-width:160px}
.slot-field-sm{min-width:100px;flex:0 0 100px}
.slot-field label{font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px}
.slot-add-btn{margin:8px 14px 12px;display:flex;gap:8px}

/* ── KITCHEN COOK TIME ── */
.cook-time-bar{background:var(--s3);border:1px solid var(--bdr);border-radius:6px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cook-time-lbl{font-size:11px;color:var(--muted);font-weight:500}
.cook-time-inp{background:var(--s1);border:1px solid var(--bdr2);border-radius:5px;color:var(--txt);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;padding:5px 10px;outline:none;width:90px;text-align:center}
.cook-time-inp:focus{border-color:var(--red)}

/* ── MEAL STATS ── */
.mstat-row:hover{background:var(--s2)}
.mstat-spark{display:flex;align-items:flex-end;gap:2px;height:28px;min-width:70px}
.mstat-spark-bar{width:4px;border-radius:2px 2px 0 0;flex-shrink:0}

/* ── MENU PLANNER (responsive) ── */
.planner-wrap{display:flex;gap:12px;align-items:flex-start}
.planner-sidebar{width:260px;flex-shrink:0}
.planner-meal-list{max-height:640px;overflow-y:auto}
.planner-grid-wrap{flex:1;min-width:0;overflow-x:auto}
.planner-table{border-collapse:collapse;min-width:640px}
.planner-selected-bar{display:none;align-items:center;justify-content:space-between;gap:8px;background:var(--s2);border:1px solid var(--red);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:13px;color:#fff}
.planner-selected-bar.show{display:flex}

@media(max-width:768px){
  .hamburger{display:flex;align-items:center;justify-content:center}
  .sb{position:fixed;top:0;left:0;bottom:0;transform:translateX(-100%);z-index:300}
  .sb.open{transform:translateX(0);box-shadow:4px 0 20px rgba(0,0,0,.6)}
  .sb-overlay.open{display:block}
  .main{width:100%}
  .topbar{padding:0 12px 0 52px}
  .tb-title{font-size:16px}
  .content{padding:12px}
  .kpis{grid-template-columns:repeat(2,1fr)}
  .grid2{grid-template-columns:1fr}
  .srch{width:130px}
  .fg{grid-template-columns:1fr}
  .fg-full{grid-column:1/-1}
  .mo{padding:8px}
  .mo-box{max-height:96vh}
  .slot-row{flex-direction:column}
  .planner-wrap{flex-direction:column}
  .planner-sidebar{width:100%}
  .planner-meal-list{max-height:200px}
}
@media(max-width:480px){
  .kpis{grid-template-columns:1fr 1fr;gap:8px}
  .kpi-val{font-size:22px}
  .btn{padding:6px 10px;font-size:10px}
}
`;

// ─── BADGES ───────────────────────────────────────────────────────────────────
function PlanBadge({ planName, plans }) {
  const p = plans?.find(x => x.name === planName);
  if (!p) return <span className="bx bx-gr">{planName||"—"}</span>;
  return <span className="bx" style={{background:p.color+"22",color:p.color}}>{planName}</span>;
}
function RenewalBadge({ c }) {
  const d = daysUntil(c.expiryDate);
  if (isNaN(d)) return null;
  if (d < 0)  return <span className="bx bx-exp">Expired {Math.abs(d)}d ago</span>;
  if (d <= 1) return <span className="bx bx-a">Expires in {d}d</span>;
  return <span className="bx bx-g">{d}d left</span>;
}

// Merges all 4 rotating weeks into one {tier:{day:{meals:[...]}}} shape so
// Meal Selections can offer every meal ever loaded for a plan, regardless of
// which week is currently "live" — rotation only matters in the Planner.
function mergeAllWeeksMenu(menu) {
  const out = {};
  for (const week of Object.values(menu || {})) {
    for (const [tier, days] of Object.entries(week || {})) {
      if (!out[tier]) out[tier] = {};
      for (const [day, slot] of Object.entries(days || {})) {
        if (!out[tier][day]) out[tier][day] = { meals: [] };
        out[tier][day].meals = out[tier][day].meals.concat(slot.meals || []);
      }
    }
  }
  return out;
}

// ─── MEAL OPTIONS BUILDER ─────────────────────────────────────────────────────
// Returns grouped <optgroup> options filtered by the client's plan tier.
// menu{} keys are whatever string is stored in Supabase (e.g. "Lean Fit", "Muscle Gain").
// clientTier comes directly from c.planObj.tier — same string — so we match by exact key
// and also case-insensitive fallback to handle any casing inconsistencies.
function MealOptions({ clientTier = null, extraItems = [], mealLibrary = [] }) {
  // Show all meals from the library for this tier (not just what's in the weekly planner)
  const tierMeals = mealLibrary
    .filter(m => m.item_type === "meal" && (
      !clientTier ||
      m.tier === clientTier ||
      (m.tier||"").toLowerCase() === (clientTier||"").toLowerCase()
    ))
    .sort((a, b) => (a.name||"").localeCompare(b.name||""));

  return (
    <>
      <option value="">— none —</option>
      {tierMeals.length > 0 && (
        <optgroup label="── Meals ──">
          {tierMeals.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </optgroup>
      )}
      {extraItems.length > 0 && (
        <optgroup label="── Custom ──">
          {extraItems.map(i => <option key={i} value={i}>{i}</option>)}
        </optgroup>
      )}
    </>
  );
}

// ─── MEAL STATS (ranking + weekly history) ────────────────────────────────────
// meal_selections gets overwritten every week, so meal_weekly_stats (a
// Sunday-night pg_cron snapshot, see snapshot_meal_weekly_stats in Supabase)
// is the only place a meal's popularity over time survives. This tab just
// reads that table -- see getMealWeeklyStats in lib/supabase.js.
function MealStatsTab({ plans }) {
  const [stats,   setStats]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [tierSel, setTierSel] = useState("");
  const [search,  setSearch]  = useState("");

  const availableTiers = useMemo(() => {
    const seen = new Set();
    const tiers = [];
    (plans||[]).forEach(p => {
      if (!p.tier) return;
      const keyLower = p.tier.toLowerCase();
      if (seen.has(keyLower)) return;
      seen.add(keyLower);
      tiers.push({ tier: p.tier, label: p.tier, color: p.color || "#aaa" });
    });
    return tiers;
  }, [plans]);

  // Sigue el mismo patrón que activeTier en MenuTab: un const derivado del
  // estado + fallback al primer tier, no un useEffect que sincronice estado
  // (evita el cascading-render que eslint marca en ese patrón).
  const activeTier = tierSel || availableTiers[0]?.tier || "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getMealWeeklyStats();
        if (!cancelled) setStats(data);
      } catch (err) {
        console.error("[MealStatsTab] getMealWeeklyStats", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeTierColor = availableTiers.find(t => t.tier === activeTier)?.color || "#38bdf8";

  const fmtWeek = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Semanas con al menos un snapshot, más reciente primero. "" = ranking
  // acumulado (all-time) -- el estado por defecto.
  const availableWeeks = useMemo(() => {
    const set = new Set();
    stats.forEach(m => m.weeks.forEach(w => set.add(w.weekStart)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [stats]);
  const [weekSel, setWeekSel] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stats
      .filter(m => !activeTier || (m.tier||"").toLowerCase() === activeTier.toLowerCase())
      .filter(m => !q || m.name.toLowerCase().includes(q))
      .map(m => ({
        ...m,
        scopedCount: weekSel ? (m.weeks.find(w => w.weekStart === weekSel)?.count || 0) : m.total,
      }))
      .filter(m => m.scopedCount > 0)
      .sort((a, b) => b.scopedCount - a.scopedCount);
  }, [stats, activeTier, search, weekSel]);

  return <>
    <div style={{display:"flex",gap:0,marginBottom:16,borderBottom:"1px solid var(--bdr)"}}>
      {availableTiers.map(({tier:t,label:lbl,color:col})=>(
        <button key={t} onClick={()=>setTierSel(t)}
          style={{flex:1,padding:"14px 10px",background:activeTier===t?`${col}18`:"none",border:"none",
            borderBottom:`2px solid ${activeTier===t?col:"transparent"}`,marginBottom:"-1px",
            color:activeTier===t?col:"var(--muted)",fontFamily:"'DM Sans',sans-serif",
            fontWeight:700,fontSize:15,cursor:"pointer",transition:"all .15s",letterSpacing:.3}}>
          {lbl}
        </button>
      ))}
    </div>

    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <input className="srch" placeholder="Search meal…" value={search} onChange={e=>setSearch(e.target.value)} />
        <select className="fltr" value={weekSel} onChange={e=>setWeekSel(e.target.value)}>
          <option value="">All-time (total)</option>
          {availableWeeks.map(w => <option key={w} value={w}>Week of {fmtWeek(w)}</option>)}
        </select>
      </div>
      <div style={{fontSize:11,color:"var(--dim)"}}>
        {availableWeeks.length===0
          ? "No hay historial todavía — el primer snapshot se guarda el domingo a la noche"
          : `${availableWeeks.length} semana${availableWeeks.length===1?"":"s"} registrada${availableWeeks.length===1?"":"s"}`}
      </div>
    </div>

    {loading ? (
      <div style={{padding:40,textAlign:"center",color:"var(--dim)"}}>Loading stats...</div>
    ) : rows.length===0 ? (
      <div style={{padding:40,textAlign:"center",color:"var(--dim)"}}>No data for this tier yet.</div>
    ) : (
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>
            <th style={{width:40,padding:"8px 10px",textAlign:"left",color:"var(--muted)",fontSize:12,fontWeight:700}}>#</th>
            <th style={{padding:"8px 10px",textAlign:"left",color:"var(--muted)",fontSize:12,fontWeight:700}}>Meal</th>
            <th style={{padding:"8px 10px",textAlign:"right",color:"var(--muted)",fontSize:12,fontWeight:700}}>
              {weekSel ? `Portions (wk of ${fmtWeek(weekSel)})` : "Total portions (all-time)"}
            </th>
            {weekSel && <th style={{padding:"8px 10px",textAlign:"right",color:"var(--muted)",fontSize:12,fontWeight:700}}>All-time total</th>}
            <th style={{padding:"8px 10px",textAlign:"left",color:"var(--muted)",fontSize:12,fontWeight:700}}>Trend (last 12 weeks)</th>
          </tr></thead>
          <tbody>
            {rows.map((m, i) => {
              const recentWeeks = m.weeks.slice(-12);
              const maxCount = Math.max(...recentWeeks.map(w => w.count), 1);
              return (
                <tr key={m.id} className="mstat-row">
                  <td style={{padding:10,color:"var(--dim)",fontSize:13,fontWeight:700}}>{i+1}</td>
                  <td style={{padding:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:36,height:36,borderRadius:8,overflow:"hidden",background:"var(--s3)",flexShrink:0}}>
                        {m.photoUrl && <img src={m.photoUrl} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" />}
                      </div>
                      <span style={{fontSize:13,color:"#fff",fontWeight:600}}>{m.name}</span>
                    </div>
                  </td>
                  <td style={{padding:10,textAlign:"right",fontSize:14,fontWeight:700,color:"#fff",fontVariantNumeric:"tabular-nums"}}>{m.scopedCount}</td>
                  {weekSel && <td style={{padding:10,textAlign:"right",fontSize:13,color:"var(--muted)",fontVariantNumeric:"tabular-nums"}}>{m.total}</td>}
                  <td style={{padding:10}}>
                    <div className="mstat-spark" title={recentWeeks.map(w=>`${fmtWeek(w.weekStart)}: ${w.count}`).join(" · ")}>
                      {recentWeeks.map((w, wi) => (
                        <div key={w.weekStart} className="mstat-spark-bar"
                          style={{
                            height: Math.max((w.count/maxCount)*28, 2),
                            background: (weekSel ? w.weekStart===weekSel : wi===recentWeeks.length-1) ? activeTierColor : "var(--bdr2)",
                          }} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </>;
}

function IngredientsTab({ ingredients, setIngredients, mealIngredients, setMealIngredients, mealLibrary, deliveryClients, meals, flash }) {
  const [view, setView] = useState("ingredients"); // ingredients | assign | shopping

  const ingredientById = useMemo(() => {
    const m = {};
    ingredients.forEach(i => { m[i.id] = i; });
    return m;
  }, [ingredients]);

  const costForGrams = (ingredientId, grams) => {
    const ing = ingredientById[ingredientId];
    if (!ing || ing.cost_per_kg == null) return null;
    return (Number(grams) || 0) / 1000 * Number(ing.cost_per_kg);
  };

  // ═══ INGREDIENTS LIST ═══
  const [search, setSearch] = useState("");
  const [newIng, setNewIng] = useState({ name: "", category: "protein", cost_per_kg: "" });
  const [dirtyCosts, setDirtyCosts] = useState({}); // ingredientId -> pending ¥/kg string
  const [savingCosts, setSavingCosts] = useState(false);

  const filteredIngredients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients
      .filter(i => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients, search]);

  const addIngredient = async () => {
    if (!newIng.name.trim()) { alert("El ingrediente necesita un nombre"); return; }
    try {
      const saved = await upsertIngredient({
        name: newIng.name.trim(),
        category: newIng.category || null,
        cost_per_kg: newIng.cost_per_kg === "" ? null : Number(newIng.cost_per_kg),
      });
      setIngredients(p => [...p, saved]);
      setNewIng({ name: "", category: "protein", cost_per_kg: "" });
      flash && flash();
    } catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
  };

  const saveDirtyCosts = async () => {
    const entries = Object.entries(dirtyCosts);
    if (entries.length === 0) return;
    setSavingCosts(true);
    try {
      for (const [id, value] of entries) {
        const ing = ingredients.find(i => i.id === id);
        if (!ing) continue;
        const cost_per_kg = value === "" ? null : Number(value);
        await upsertIngredient({ id, name: ing.name, category: ing.category, cost_per_kg });
        setIngredients(p => p.map(i => i.id === id ? { ...i, cost_per_kg } : i));
      }
      setDirtyCosts({});
      flash && flash();
    } catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
    setSavingCosts(false);
  };

  const photoInputRef = useRef(null);
  const [photoTargetId, setPhotoTargetId] = useState(null);
  const [uploadingPhotoId, setUploadingPhotoId] = useState(null);

  const triggerPhotoUpload = (ing) => {
    setPhotoTargetId(ing.id);
    photoInputRef.current && photoInputRef.current.click();
  };

  const onPhotoFileChosen = async (e) => {
    const file = e.target.files && e.target.files[0];
    const ingId = photoTargetId;
    e.target.value = "";
    if (!file || !ingId) return;
    setUploadingPhotoId(ingId);
    try {
      const url = await uploadIngredientPhoto(file, ingId);
      const ing = ingredients.find(i => i.id === ingId);
      await upsertIngredient({ id: ingId, name: ing.name, category: ing.category, cost_per_kg: ing.cost_per_kg, photo_url: url });
      setIngredients(p => p.map(i => i.id === ingId ? { ...i, photo_url: url } : i));
    } catch (e) { alert(`No se pudo subir la foto: ${e.message || e}`); }
    setUploadingPhotoId(null);
  };

  const removeIngredient = async (ing) => {
    if (!window.confirm(`¿Borrar "${ing.name}"? También se borran sus asignaciones a platos.`)) return;
    const prev = ingredients;
    setIngredients(p => p.filter(i => i.id !== ing.id));
    try { await dbDeleteIngredient(ing.id); setMealIngredients(p => p.filter(mi => mi.ingredient_id !== ing.id)); }
    catch (e) { setIngredients(prev); alert(`No se pudo borrar: ${e.message || e}`); }
  };

  // ═══ ASSIGN TO MEALS ═══
  const [assignTier, setAssignTier] = useState("");
  const [selectedMealId, setSelectedMealId] = useState("");
  const [addIngId, setAddIngId] = useState("");
  const [addGrams, setAddGrams] = useState("");

  const mealTiers = useMemo(() => {
    const seen = new Set(); const out = [];
    mealLibrary.filter(m => m.item_type === "meal").forEach(m => {
      const t = m.tier || "";
      if (!t || seen.has(t.toLowerCase())) return;
      seen.add(t.toLowerCase()); out.push(t);
    });
    return out;
  }, [mealLibrary]);
  const activeAssignTier = assignTier || mealTiers[0] || "";

  const mealsForTier = useMemo(() => {
    return mealLibrary
      .filter(m => m.item_type === "meal" && (m.tier || "").toLowerCase() === activeAssignTier.toLowerCase())
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [mealLibrary, activeAssignTier]);

  const selectedMeal = mealLibrary.find(m => m.id === selectedMealId) || null;
  const selectedMealIngredients = useMemo(() => {
    if (!selectedMealId) return [];
    return mealIngredients
      .filter(mi => mi.meal_id === selectedMealId)
      .map(mi => ({ ...mi, ingredient: ingredientById[mi.ingredient_id] }))
      .filter(mi => mi.ingredient)
      .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
  }, [mealIngredients, selectedMealId, ingredientById]);

  const [dirtyGrams, setDirtyGrams] = useState({}); // mealIngredientId -> pending qty string
  const [savingGrams, setSavingGrams] = useState(false);

  const effectiveGrams = (mi) => dirtyGrams[mi.id] !== undefined ? Number(dirtyGrams[mi.id]) || 0 : mi.quantity_grams;

  const selectedMealCost = useMemo(() => {
    let total = 0, missing = false;
    selectedMealIngredients.forEach(mi => {
      const c = costForGrams(mi.ingredient_id, effectiveGrams(mi));
      if (c == null) missing = true; else total += c;
    });
    return { total, missing };
  }, [selectedMealIngredients, ingredientById, dirtyGrams]);

  const addMealIngredient = async () => {
    if (!selectedMealId || !addIngId || !addGrams) return;
    try {
      const saved = await upsertMealIngredient({ meal_id: selectedMealId, ingredient_id: addIngId, quantity_grams: Number(addGrams) });
      setMealIngredients(p => {
        const idx = p.findIndex(mi => mi.meal_id === selectedMealId && mi.ingredient_id === addIngId);
        return idx >= 0 ? p.map((mi, i) => i === idx ? saved : mi) : [...p, saved];
      });
      setAddIngId(""); setAddGrams("");
    } catch (e) { alert(`No se pudo asignar: ${e.message || e}`); }
  };

  const saveDirtyGrams = async () => {
    const entries = Object.entries(dirtyGrams);
    if (entries.length === 0) return;
    setSavingGrams(true);
    try {
      for (const [id, value] of entries) {
        const mi = mealIngredients.find(x => x.id === id);
        if (!mi) continue;
        const quantity_grams = Number(value) || 0;
        await upsertMealIngredient({ id: mi.id, meal_id: mi.meal_id, ingredient_id: mi.ingredient_id, quantity_grams });
        setMealIngredients(p => p.map(x => x.id === id ? { ...x, quantity_grams } : x));
      }
      setDirtyGrams({});
    } catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
    setSavingGrams(false);
  };

  const removeMealIngredient = async (mi) => {
    const prev = mealIngredients;
    setMealIngredients(p => p.filter(x => x.id !== mi.id));
    try { await dbDeleteMealIngredient(mi.id); }
    catch (e) { setMealIngredients(prev); alert(`No se pudo quitar: ${e.message || e}`); }
  };

  // ═══ SHOPPING LIST ═══
  const [shopDay, setShopDay] = useState("Monday");
  const SHOP_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  const mealIngredientsByMeal = useMemo(() => {
    const m = {};
    mealIngredients.forEach(mi => { (m[mi.meal_id] = m[mi.meal_id] || []).push(mi); });
    return m;
  }, [mealIngredients]);

  const shoppingList = useMemo(() => {
    const totals = {}; // ingredientId -> grams
    const unassignedMeals = new Set();
    deliveryClients.filter(c => clientActiveOnDay(c, shopDay)).forEach(c => {
      const slots = meals[c.id]?.[shopDay] || [];
      slots.forEach(slot => {
        (slot.meals || []).filter(id => id && id.trim() && id !== "—").forEach(mealId => {
          const rows = mealIngredientsByMeal[mealId];
          if (!rows || rows.length === 0) {
            const m = mealLibrary.find(x => x.id === mealId);
            unassignedMeals.add(m ? m.name : mealId);
            return;
          }
          rows.forEach(mi => { totals[mi.ingredient_id] = (totals[mi.ingredient_id] || 0) + Number(mi.quantity_grams); });
        });
      });
    });
    const rows = Object.entries(totals).map(([ingredientId, grams]) => ({
      ingredient: ingredientById[ingredientId],
      ingredientId, grams,
      cost: costForGrams(ingredientId, grams),
    })).filter(r => r.ingredient).sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
    const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
    const hasMissingCost = rows.some(r => r.cost == null);
    return { rows, totalCost, hasMissingCost, unassignedMeals: Array.from(unassignedMeals) };
  }, [deliveryClients, meals, shopDay, mealIngredientsByMeal, ingredientById, mealLibrary]);

  const catColor = { protein: "#f87171", carb: "#fbbf24", veg: "#4ade80", sauce: "#38bdf8" };

  return <>
    <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
      {[["ingredients", "Ingredients"], ["assign", "Assign to Meals"], ["shopping", "Shopping List"]].map(([k, lbl]) => (
        <button key={k} className={`btn ${view === k ? "" : "btn-g"}`} style={{ padding: "9px 16px", fontSize: 13 }} onClick={() => setView(k)}>{lbl}</button>
      ))}
    </div>

    <input ref={photoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPhotoFileChosen} />

    {view === "ingredients" && <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input className="srch" placeholder="Search ingredient…" value={search} onChange={e => setSearch(e.target.value)} />
        {Object.keys(dirtyCosts).length > 0 && (
          <button className="btn btn-r btn-sm" onClick={saveDirtyCosts} disabled={savingCosts}>
            {savingCosts ? "Saving…" : `💾 Save changes (${Object.keys(dirtyCosts).length})`}
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", background: "var(--s3,#161b22)", padding: 8, borderRadius: 8, border: "1px solid var(--bdr)" }}>
          <input placeholder="New ingredient name" value={newIng.name} onChange={e => setNewIng(p => ({ ...p, name: e.target.value }))} style={{ width: 180 }} />
          <select value={newIng.category} onChange={e => setNewIng(p => ({ ...p, category: e.target.value }))}>
            <option value="protein">protein</option>
            <option value="carb">carb</option>
            <option value="veg">veg</option>
            <option value="sauce">sauce</option>
          </select>
          <input type="number" placeholder="¥/kg" value={newIng.cost_per_kg} onChange={e => setNewIng(p => ({ ...p, cost_per_kg: e.target.value }))} style={{ width: 80 }} />
          <button className="btn btn-xs" onClick={addIngredient}>+ Add</button>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ padding: "8px 10px" }}></th>
            <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Name</th>
            <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Category</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>¥ / kg</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>¥ / 100g</th>
            <th style={{ padding: "8px 10px" }}></th>
          </tr></thead>
          <tbody>
            {filteredIngredients.map(ing => (
              <tr key={ing.id} style={{ borderTop: "1px solid var(--bdr)" }}>
                <td style={{ padding: 10 }}>
                  <div onClick={() => triggerPhotoUpload(ing)} title="Click to change photo"
                    style={{ width: 36, height: 36, borderRadius: 8, overflow: "hidden", background: "var(--s3,#161b22)",
                      border: "1px solid var(--bdr)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {uploadingPhotoId === ing.id ? (
                      <span style={{ fontSize: 9, color: "var(--dim)" }}>…</span>
                    ) : ing.photo_url ? (
                      <img src={ing.photo_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                    ) : (
                      <span style={{ fontSize: 15, opacity: .4 }}>📷</span>
                    )}
                  </div>
                </td>
                <td style={{ padding: 10, color: "#fff" }}>{ing.name}</td>
                <td style={{ padding: 10 }}>
                  <span style={{ fontSize: 11, color: catColor[ing.category] || "var(--dim)" }}>{ing.category || "—"}</span>
                </td>
                <td style={{ padding: 10, textAlign: "right" }}>
                  <input type="number"
                    value={dirtyCosts[ing.id] !== undefined ? dirtyCosts[ing.id] : (ing.cost_per_kg ?? "")}
                    style={{ width: 90, textAlign: "right", borderColor: dirtyCosts[ing.id] !== undefined ? "#fbbf24" : undefined }}
                    onChange={e => setDirtyCosts(p => ({ ...p, [ing.id]: e.target.value }))} />
                </td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--dim)", fontSize: 13 }}>
                  {(() => { const c = dirtyCosts[ing.id] !== undefined ? (dirtyCosts[ing.id]===""?null:Number(dirtyCosts[ing.id])) : ing.cost_per_kg; return c != null ? `¥${(c / 10).toFixed(2)}` : "—"; })()}
                </td>
                <td style={{ padding: 10, textAlign: "right" }}>
                  <button className="btn btn-xs" style={{ background: "#450a0a", color: "#f87171", border: "none" }} onClick={() => removeIngredient(ing)}>Delete</button>
                </td>
              </tr>
            ))}
            {filteredIngredients.length === 0 && <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "var(--dim)" }}>No ingredients yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>}

    {view === "assign" && <>
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid var(--bdr)" }}>
        {mealTiers.map(t => (
          <button key={t} onClick={() => { setAssignTier(t); setSelectedMealId(""); setDirtyGrams({}); }}
            style={{ flex: 1, padding: "12px 10px", background: "none", border: "none",
              borderBottom: `2px solid ${activeAssignTier === t ? "#38bdf8" : "transparent"}`,
              color: activeAssignTier === t ? "#38bdf8" : "var(--muted)", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            {t}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 20 }}>
        <div style={{ width: 260, flexShrink: 0, maxHeight: 520, overflowY: "auto" }}>
          {mealsForTier.map(m => (
            <div key={m.id} onClick={() => { setSelectedMealId(m.id); setDirtyGrams({}); }}
              style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 4,
                background: selectedMealId === m.id ? "rgba(56,189,248,.15)" : "transparent",
                color: selectedMealId === m.id ? "#38bdf8" : "#fff", fontSize: 13 }}>
              {m.name}
              {(!mealIngredientsByMeal[m.id] || mealIngredientsByMeal[m.id].length === 0) &&
                <span style={{ color: "var(--dim)", fontSize: 10, marginLeft: 6 }}>· no ingredients</span>}
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {!selectedMeal ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--dim)" }}>Pick a meal on the left.</div>
          ) : <>
            <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{selectedMeal.name}</div>
                <div style={{ fontSize: 12, color: "var(--dim)" }}>{selectedMeal.kcal} kcal · P{selectedMeal.protein} C{selectedMeal.carbs} F{selectedMeal.fat}</div>
              </div>
              {Object.keys(dirtyGrams).length > 0 && (
                <button className="btn btn-r btn-sm" onClick={saveDirtyGrams} disabled={savingGrams}>
                  {savingGrams ? "Saving…" : `💾 Save changes (${Object.keys(dirtyGrams).length})`}
                </button>
              )}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
              <thead><tr>
                <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Ingredient</th>
                <th style={{ padding: "6px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Qty</th>
                <th style={{ padding: "6px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Cost</th>
                <th></th>
              </tr></thead>
              <tbody>
                {selectedMealIngredients.map(mi => (
                  <tr key={mi.id} style={{ borderTop: "1px solid var(--bdr)" }}>
                    <td style={{ padding: 8, color: "#fff" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 5, overflow: "hidden", background: "var(--s3,#161b22)", flexShrink: 0 }}>
                          {mi.ingredient.photo_url && <img src={mi.ingredient.photo_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />}
                        </div>
                        {mi.ingredient.name}
                      </div>
                    </td>
                    <td style={{ padding: 8, textAlign: "right" }}>
                      <input type="number"
                        value={dirtyGrams[mi.id] !== undefined ? dirtyGrams[mi.id] : mi.quantity_grams}
                        style={{ width: 70, textAlign: "right", borderColor: dirtyGrams[mi.id] !== undefined ? "#fbbf24" : undefined }}
                        onChange={e => setDirtyGrams(p => ({ ...p, [mi.id]: e.target.value }))} />
                      <span style={{ color: "var(--dim)", fontSize: 11, marginLeft: 4 }}>{mi.ingredient.category === "sauce" ? "ml" : "g"}</span>
                    </td>
                    <td style={{ padding: 8, textAlign: "right", color: "var(--dim)", fontSize: 13 }}>
                      {(() => { const c = costForGrams(mi.ingredient_id, effectiveGrams(mi)); return c == null ? "sin costo" : `¥${c.toFixed(2)}`; })()}
                    </td>
                    <td style={{ padding: 8, textAlign: "right" }}>
                      <button className="btn btn-xs" style={{ background: "#450a0a", color: "#f87171", border: "none" }} onClick={() => removeMealIngredient(mi)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
              <select value={addIngId} onChange={e => setAddIngId(e.target.value)} style={{ flex: 1 }}>
                <option value="">Add ingredient…</option>
                {ingredients.filter(i => !selectedMealIngredients.some(mi => mi.ingredient_id === i.id))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <input type="number" placeholder={ingredientById[addIngId]?.category === "sauce" ? "ml" : "grams"} value={addGrams} onChange={e => setAddGrams(e.target.value)} style={{ width: 90 }} />
              <button className="btn btn-xs" onClick={addMealIngredient}>+ Add</button>
            </div>
            <div style={{ padding: 12, borderRadius: 8, background: "var(--s3,#161b22)", border: "1px solid var(--bdr)" }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Estimated cost per portion: </span>
              <span style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>¥{selectedMealCost.total.toFixed(2)}</span>
              {selectedMealCost.missing && <span style={{ color: "#fbbf24", fontSize: 12, marginLeft: 10 }}>⚠ some ingredients have no cost yet</span>}
            </div>
          </>}
        </div>
      </div>
    </>}

    {view === "shopping" && <>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {SHOP_DAYS.map(d => <button key={d} className={`btn ${shopDay === d ? "" : "btn-g"}`} style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => setShopDay(d)}>{d.slice(0, 3)}</button>)}
      </div>
      {shoppingList.unassignedMeals.length > 0 && (
        <div style={{ padding: 10, borderRadius: 8, background: "rgba(251,191,36,.1)", border: "1px solid #fbbf24", color: "#fbbf24", fontSize: 12, marginBottom: 14 }}>
          ⚠ These meals were ordered for {shopDay} but have no ingredients assigned yet, so they're missing from the totals below: {shoppingList.unassignedMeals.join(", ")}.
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Ingredient</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Total needed</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Est. cost</th>
          </tr></thead>
          <tbody>
            {shoppingList.rows.map(r => (
              <tr key={r.ingredientId} style={{ borderTop: "1px solid var(--bdr)" }}>
                <td style={{ padding: 10, color: "#fff" }}>{r.ingredient.name}</td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--muted)" }}>
                  {fmtQty(r.grams, r.ingredient.category)}
                </td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--dim)" }}>{r.cost == null ? "sin costo" : `¥${r.cost.toFixed(2)}`}</td>
              </tr>
            ))}
            {shoppingList.rows.length === 0 && <tr><td colSpan={3} style={{ padding: 30, textAlign: "center", color: "var(--dim)" }}>No active deliveries for {shopDay}.</td></tr>}
          </tbody>
        </table>
      </div>
      {shoppingList.rows.length > 0 && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "var(--s3,#161b22)", border: "1px solid var(--bdr)" }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Estimated total cost for {shopDay}: </span>
          <span style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>¥{shoppingList.totalCost.toFixed(2)}</span>
          {shoppingList.hasMissingCost && <span style={{ color: "#fbbf24", fontSize: 12, marginLeft: 10 }}>⚠ some ingredients have no cost yet, total is partial</span>}
        </div>
      )}
    </>}
  </>;
}

function AccountingTab({ active, plans, paidPayments, ingredients, mealIngredients, mealLibrary, deliveryClients, meals, employees, setEmployees, otherExpenses, setOtherExpenses, acctSnapshots, setAcctSnapshots, oneTimeExpenses, setOneTimeExpenses, coaches, setCoaches }) {
  const ACC_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const todayIso = new Date().toISOString().slice(0, 10);
  const [view, setView] = useState("current"); // current | history

  const weekStartIso = useMemo(() => {
    const d = new Date();
    const dow = d.getDay(); // 0=Sun..6=Sat
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + diffToMonday);
    return d.toISOString().slice(0, 10);
  }, []);
  const weekEndIso = useMemo(() => {
    const d = new Date(weekStartIso + "T00:00:00");
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  }, [weekStartIso]);

  const ingredientById = useMemo(() => {
    const m = {}; ingredients.forEach(i => { m[i.id] = i; }); return m;
  }, [ingredients]);
  const mealIngredientsByMeal = useMemo(() => {
    const m = {}; mealIngredients.forEach(mi => { (m[mi.meal_id] = m[mi.meal_id] || []).push(mi); }); return m;
  }, [mealIngredients]);
  const costForGrams = (ingredientId, grams) => {
    const ing = ingredientById[ingredientId];
    if (!ing || ing.cost_per_kg == null) return null;
    return (Number(grams) || 0) / 1000 * Number(ing.cost_per_kg);
  };

  // ── REVENUE: para cada cliente activo, la plata real que está pagando por
  // semana en su ciclo actual (el pago que cubre hoy), no el precio de lista
  // -- así se ven los descuentos (alta nueva 25%, referido 10%) reflejados.
  // Se separa en plan vs delivery: el pago real (amount_fen) es un combinado
  // de los dos, así que la parte de delivery se estima con el delivery_fee
  // ACTUAL del cliente (no queda guardado por separado en `payments`) -- si
  // el fee cambió desde ese pago, esta parte queda como aproximación.
  const revenueRows = useMemo(() => {
    return active.map(c => {
      const listPrice = c.planObj?.price || 0;
      const deliveryFee = c.deliveryFee || 0;
      const payment = paidPayments
        .filter(p => p.client_id === c.id && p.start_date <= todayIso && p.expiry_date >= todayIso)
        .sort((a, b) => (b.paid_at || "").localeCompare(a.paid_at || ""))[0];
      let weeklyRevenue, deliveryRevenue, planRevenue, hasPayment;
      if (payment) {
        const weeksCovered = c.weeks || Math.max(1, Math.round((new Date(payment.expiry_date) - new Date(payment.start_date)) / (7 * 86400000)));
        weeklyRevenue = (payment.amount_fen / 100) / weeksCovered;
        deliveryRevenue = deliveryFee / weeksCovered;
        planRevenue = weeklyRevenue - deliveryRevenue;
        hasPayment = true;
      } else {
        planRevenue = listPrice;
        deliveryRevenue = deliveryFee;
        weeklyRevenue = planRevenue + deliveryRevenue;
        hasPayment = false;
      }
      const discounted = hasPayment && listPrice > 0 && planRevenue < listPrice * 0.99;
      return { client: c, listPrice, planRevenue, deliveryRevenue, weeklyRevenue, hasPayment, discounted };
    }).sort((a, b) => b.weeklyRevenue - a.weeklyRevenue);
  }, [active, paidPayments, todayIso]);

  const totalPlanRevenue = revenueRows.reduce((s, r) => s + r.planRevenue, 0);
  const totalDeliveryRevenue = revenueRows.reduce((s, r) => s + r.deliveryRevenue, 0);
  const totalRevenue = totalPlanRevenue + totalDeliveryRevenue;
  const totalListRevenue = revenueRows.reduce((s, r) => s + r.listPrice, 0);

  // ── COSTS: mismo cálculo que la Shopping List de Ingredients, sumado
  // Lunes a Viernes -- el costo real de ingredientes de la semana.
  const costByDay = useMemo(() => {
    const unassigned = new Set();
    const days = ACC_DAYS.map(day => {
      let dayCost = 0, missingCost = false;
      deliveryClients.filter(c => clientActiveOnDay(c, day)).forEach(c => {
        const slots = meals[c.id]?.[day] || [];
        slots.forEach(slot => {
          (slot.meals || []).filter(id => id && id.trim() && id !== "—").forEach(mealId => {
            const rows = mealIngredientsByMeal[mealId];
            if (!rows || rows.length === 0) {
              const m = mealLibrary.find(x => x.id === mealId);
              unassigned.add(m ? m.name : mealId);
              return;
            }
            rows.forEach(mi => {
              const cost = costForGrams(mi.ingredient_id, mi.quantity_grams);
              if (cost == null) missingCost = true; else dayCost += cost;
            });
          });
        });
      });
      return { day, cost: dayCost, missing: missingCost };
    });
    return { days, unassigned: Array.from(unassigned) };
  }, [deliveryClients, meals, mealIngredientsByMeal, ingredientById, mealLibrary]);

  const totalCost = costByDay.days.reduce((s, d) => s + d.cost, 0);
  const costHasGaps = costByDay.days.some(d => d.missing) || costByDay.unassigned.length > 0;

  // ── EMPLOYEES / PAYROLL ── sueldos se cargan por mes (como se piensan en
  // la práctica); para el margen semanal se convierten a equivalente semanal
  // (÷ 52/12 semanas por mes en promedio), dejando ambos números a la vista.
  const WEEKS_PER_MONTH = 52 / 12;
  const [newEmp, setNewEmp] = useState({ name: "", monthly_pay: "" });

  const addEmployee = async () => {
    if (!newEmp.name.trim()) { alert("Necesita un nombre"); return; }
    try {
      const saved = await upsertEmployee({ name: newEmp.name.trim(), monthly_pay: Number(newEmp.monthly_pay) || 0 });
      setEmployees(p => [...p, saved]);
      setNewEmp({ name: "", monthly_pay: "" });
    } catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
  };

  const saveEmployeePay = async (emp, value) => {
    const monthly_pay = Number(value) || 0;
    setEmployees(p => p.map(e => e.id === emp.id ? { ...e, monthly_pay } : e));
    try { await upsertEmployee({ id: emp.id, name: emp.name, monthly_pay }); }
    catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
  };

  const removeEmployee = async (emp) => {
    if (!window.confirm(`¿Borrar "${emp.name}"?`)) return;
    const prev = employees;
    setEmployees(p => p.filter(e => e.id !== emp.id));
    try { await dbDeleteEmployee(emp.id); }
    catch (e) { setEmployees(prev); alert(`No se pudo borrar: ${e.message || e}`); }
  };

  const totalPayrollMonthly = employees.reduce((s, e) => s + (Number(e.monthly_pay) || 0), 0);
  const totalPayrollWeekly = totalPayrollMonthly / WEEKS_PER_MONTH;

  // ── OTHER EXPENSES (packaging, alquiler, etc.) ── también mensuales,
  // mismo criterio de conversión a semanal que Employees.
  const [newExpense, setNewExpense] = useState({ name: "", monthly_amount: "" });

  const addExpense = async () => {
    if (!newExpense.name.trim()) { alert("Necesita un nombre"); return; }
    try {
      const saved = await upsertOtherExpense({ name: newExpense.name.trim(), monthly_amount: Number(newExpense.monthly_amount) || 0 });
      setOtherExpenses(p => [...p, saved]);
      setNewExpense({ name: "", monthly_amount: "" });
    } catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
  };

  const saveExpenseAmount = async (exp, value) => {
    const monthly_amount = Number(value) || 0;
    setOtherExpenses(p => p.map(x => x.id === exp.id ? { ...x, monthly_amount } : x));
    try { await upsertOtherExpense({ id: exp.id, name: exp.name, monthly_amount }); }
    catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
  };

  const removeExpense = async (exp) => {
    if (!window.confirm(`¿Borrar "${exp.name}"?`)) return;
    const prev = otherExpenses;
    setOtherExpenses(p => p.filter(x => x.id !== exp.id));
    try { await dbDeleteOtherExpense(exp.id); }
    catch (e) { setOtherExpenses(prev); alert(`No se pudo borrar: ${e.message || e}`); }
  };

  const totalExpensesMonthly = otherExpenses.reduce((s, e) => s + (Number(e.monthly_amount) || 0), 0);
  const totalExpensesWeekly = totalExpensesMonthly / WEEKS_PER_MONTH;

  // ── ONE-TIME EXPENSES: no recurrentes, cada una tiene su propia fecha --
  // solo las de ESTA semana entran al margen semanal (las demás quedan en
  // el listado como historial, pero no se restan de nuevo cada semana).
  const [newOneTime, setNewOneTime] = useState({ name: "", amount: "", expense_date: todayIso });

  const addOneTimeExpense = async () => {
    if (!newOneTime.name.trim()) { alert("Necesita un nombre"); return; }
    try {
      const saved = await upsertOneTimeExpense({ name: newOneTime.name.trim(), amount: Number(newOneTime.amount) || 0, expense_date: newOneTime.expense_date || todayIso });
      setOneTimeExpenses(p => [saved, ...p]);
      setNewOneTime({ name: "", amount: "", expense_date: todayIso });
    } catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
  };

  const removeOneTimeExpense = async (exp) => {
    if (!window.confirm(`¿Borrar "${exp.name}"?`)) return;
    const prev = oneTimeExpenses;
    setOneTimeExpenses(p => p.filter(x => x.id !== exp.id));
    try { await dbDeleteOneTimeExpense(exp.id); }
    catch (e) { setOneTimeExpenses(prev); alert(`No se pudo borrar: ${e.message || e}`); }
  };

  const oneTimeThisWeek = useMemo(() =>
    oneTimeExpenses.filter(e => e.expense_date >= weekStartIso && e.expense_date <= weekEndIso)
      .reduce((s, e) => s + Number(e.amount), 0),
  [oneTimeExpenses, weekStartIso, weekEndIso]);

  // ── REFERRAL COMMISSIONS: por cada alta nueva pagada esta semana con
  // código de referido, se le debe al coach dueño de ese código su comisión.
  const [savingCoachId, setSavingCoachId] = useState(null);
  const saveCoachCommission = async (coach, value) => {
    const commission = Number(value) || 0;
    setCoaches(p => p.map(c => c.id === coach.id ? { ...c, commission_per_referral: commission } : c));
    setSavingCoachId(coach.id);
    try { await updateCoachCommission(coach.id, commission); }
    catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
    setSavingCoachId(null);
  };

  const referralRows = useMemo(() => {
    const counts = {};
    paidPayments.filter(p => p.type === "new" && p.referral_code && p.paid_at && p.paid_at.slice(0, 10) >= weekStartIso && p.paid_at.slice(0, 10) <= weekEndIso)
      .forEach(p => { const code = p.referral_code.toLowerCase().trim(); counts[code] = (counts[code] || 0) + 1; });
    return coaches.map(c => ({
      coach: c,
      count: counts[c.code?.toLowerCase().trim()] || 0,
      amount: (counts[c.code?.toLowerCase().trim()] || 0) * Number(c.commission_per_referral || 0),
    })).filter(r => r.count > 0 || Number(r.coach.commission_per_referral) > 0);
  }, [coaches, paidPayments, weekStartIso, weekEndIso]);

  const referralCommissionThisWeek = referralRows.reduce((s, r) => s + r.amount, 0);

  const margin = totalRevenue - totalCost - totalPayrollWeekly - totalExpensesWeekly - oneTimeThisWeek - referralCommissionThisWeek;
  const marginPct = totalRevenue > 0 ? (margin / totalRevenue) * 100 : 0;

  // ── HISTORIAL: no hay forma de recalcular una semana pasada (todo el
  // cálculo de arriba es siempre "esta semana, ahora mismo"), así que cada
  // vez que se abre esta pantalla se guarda/actualiza el snapshot de la
  // semana actual -- el historial se va armando solo con el uso normal.
  useEffect(() => {
    const snapshot = {
      week_start: weekStartIso,
      plan_revenue: totalPlanRevenue,
      delivery_revenue: totalDeliveryRevenue,
      ingredient_cost: totalCost,
      payroll: totalPayrollWeekly,
      other_expenses: totalExpensesWeekly,
      one_time_expenses: oneTimeThisWeek,
      referral_commission: referralCommissionThisWeek,
      margin,
      active_clients: active.length,
    };
    upsertAccountingSnapshot(snapshot)
      .then(saved => setAcctSnapshots(p => {
        const idx = p.findIndex(s => s.week_start === weekStartIso);
        return idx >= 0 ? p.map((s, i) => i === idx ? saved : s) : [...p, saved];
      }))
      .catch(e => console.error("[AccountingTab] snapshot", e));
  }, [weekStartIso, totalPlanRevenue, totalDeliveryRevenue, totalCost, totalPayrollWeekly, totalExpensesWeekly, oneTimeThisWeek, referralCommissionThisWeek, margin, active.length]);

  // ── HISTORY: agrupado por semana o por mes
  const [historyMode, setHistoryMode] = useState("week"); // week | month
  const historyRows = useMemo(() => {
    const sorted = [...acctSnapshots].sort((a, b) => b.week_start.localeCompare(a.week_start));
    if (historyMode === "week") return sorted;
    const byMonth = {};
    sorted.forEach(s => {
      const month = s.week_start.slice(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = { week_start: month, plan_revenue: 0, delivery_revenue: 0, ingredient_cost: 0, payroll: 0, other_expenses: 0, one_time_expenses: 0, referral_commission: 0, margin: 0, active_clients: 0, weeks: 0 };
      const m = byMonth[month];
      m.plan_revenue += Number(s.plan_revenue); m.delivery_revenue += Number(s.delivery_revenue);
      m.ingredient_cost += Number(s.ingredient_cost); m.payroll += Number(s.payroll);
      m.other_expenses += Number(s.other_expenses); m.margin += Number(s.margin);
      m.one_time_expenses += Number(s.one_time_expenses || 0); m.referral_commission += Number(s.referral_commission || 0);
      m.active_clients = Math.max(m.active_clients, s.active_clients); m.weeks += 1;
    });
    return Object.values(byMonth).sort((a, b) => b.week_start.localeCompare(a.week_start));
  }, [acctSnapshots, historyMode]);

  const printAccounting = async () => {
    const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210;
    let y = 0;
    const dateStr = new Date().toLocaleDateString("en-GB");

    doc.setFillColor(232, 52, 42); doc.rect(0, 0, W, 18, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("FIT IGNYTE — Accounting Report", 10, 12);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text("Week of " + weekStartIso + "  |  generated " + dateStr, 10, 17);
    y = 26;

    const stat = (label, value, x) => {
      doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.setFont("helvetica", "normal");
      doc.text(label, x, y);
      doc.setFontSize(13); doc.setTextColor(20, 20, 20); doc.setFont("helvetica", "bold");
      doc.text(value, x, y + 6);
    };
    stat("PLAN REVENUE", `¥${totalPlanRevenue.toFixed(0)}`, 10);
    stat("DELIVERY REVENUE", `¥${totalDeliveryRevenue.toFixed(0)}`, 65);
    stat("INGREDIENT COST (var.)", `¥${totalCost.toFixed(0)}`, 120);
    y += 14;
    stat("PAYROLL /wk (fixed)", `¥${totalPayrollWeekly.toFixed(0)}`, 10);
    stat("OTHER EXP /wk (fixed)", `¥${totalExpensesWeekly.toFixed(0)}`, 65);
    stat("ONE-TIME (this wk)", `¥${oneTimeThisWeek.toFixed(0)}`, 120);
    y += 14;
    stat("REFERRAL COMM. (this wk)", `¥${referralCommissionThisWeek.toFixed(0)}`, 10);
    stat("MARGIN", `¥${margin.toFixed(0)} (${marginPct.toFixed(0)}%)`, 65);
    y += 16;

    const section = (title) => {
      if (y > 265) { doc.addPage(); y = 10; }
      doc.setFillColor(30, 30, 30); doc.rect(0, y, W, 7, "F");
      doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "bold");
      doc.text(title, 10, y + 5);
      y += 10;
    };
    const row = (cols, i) => {
      if (y > 275) { doc.addPage(); y = 10; }
      if (i % 2 === 0) { doc.setFillColor(245, 245, 245); doc.rect(0, y, W, 7, "F"); }
      doc.setTextColor(20, 20, 20); doc.setFontSize(8); doc.setFont("helvetica", "normal");
      doc.text(cols[0], 10, y + 5);
      doc.text(cols[1], W - 10, y + 5, { align: "right" });
      y += 7;
    };

    section("EMPLOYEES");
    if (employees.length === 0) { row(["No employees", ""], 0); }
    employees.forEach((e, i) => row([e.name, `¥${Number(e.monthly_pay).toFixed(0)}/mo`], i));
    y += 4;

    section("OTHER EXPENSES (fixed)");
    if (otherExpenses.length === 0) { row(["No other expenses", ""], 0); }
    otherExpenses.forEach((e, i) => row([e.name, `¥${Number(e.monthly_amount).toFixed(0)}/mo`], i));
    y += 4;

    section("ONE-TIME EXPENSES (this week)");
    const oneTimeRows = oneTimeExpenses.filter(e => e.expense_date >= weekStartIso && e.expense_date <= weekEndIso);
    if (oneTimeRows.length === 0) { row(["No one-time expenses this week", ""], 0); }
    oneTimeRows.forEach((e, i) => row([`${e.name} (${e.expense_date})`, `¥${Number(e.amount).toFixed(0)}`], i));
    y += 4;

    section("REFERRAL COMMISSIONS (this week)");
    if (referralRows.length === 0) { row(["No referral commissions this week", ""], 0); }
    referralRows.forEach((r, i) => row([`${r.coach.name} — ${r.count} referral${r.count !== 1 ? "s" : ""}`, `¥${r.amount.toFixed(0)}`], i));
    y += 4;

    section("INGREDIENT COST BY DAY");
    costByDay.days.forEach((d, i) => row([d.day, `¥${d.cost.toFixed(0)}${d.missing ? " (partial)" : ""}`], i));

    doc.save("accounting-week-" + weekStartIso + ".pdf");
  };

  return <>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn ${view === "current" ? "" : "btn-g"}`} style={{ padding: "9px 16px", fontSize: 13 }} onClick={() => setView("current")}>This Week</button>
        <button className={`btn ${view === "history" ? "" : "btn-g"}`} style={{ padding: "9px 16px", fontSize: 13 }} onClick={() => setView("history")}>History</button>
      </div>
      {view === "current" && <button className="btn btn-r btn-sm" onClick={printAccounting}>⬇ Print / PDF</button>}
    </div>

    {view === "current" && <>
    <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>Revenue</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
      <div style={{ padding: 16, borderRadius: 10, background: "var(--s2,#1a1a1a)", border: "1px solid var(--bdr)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>PLAN REVENUE</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "var(--green)" }}>¥{totalPlanRevenue.toFixed(0)}</div>
        {totalListRevenue > totalPlanRevenue && <div style={{ fontSize: 11, color: "var(--dim)" }}>List price would be ¥{totalListRevenue.toFixed(0)}</div>}
      </div>
      <div style={{ padding: 16, borderRadius: 10, background: "var(--s2,#1a1a1a)", border: "1px solid var(--bdr)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>DELIVERY REVENUE</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "var(--green)" }}>¥{totalDeliveryRevenue.toFixed(0)}</div>
        <div style={{ fontSize: 11, color: "var(--dim)" }}>from {revenueRows.filter(r => r.deliveryRevenue > 0).length} client{revenueRows.filter(r => r.deliveryRevenue > 0).length !== 1 ? "s" : ""}</div>
      </div>
    </div>

    <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>Variable Costs</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
      <div style={{ padding: 16, borderRadius: 10, background: "var(--s2,#1a1a1a)", border: "1px solid var(--bdr)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>WEEKLY INGREDIENT COST</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#f87171" }}>¥{totalCost.toFixed(0)}</div>
        {costHasGaps && <div style={{ fontSize: 11, color: "#fbbf24" }}>⚠ incomplete — some costs/assignments missing</div>}
      </div>
    </div>

    <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>Fixed Costs (recurring monthly)</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
      <div style={{ padding: 16, borderRadius: 10, background: "var(--s2,#1a1a1a)", border: "1px solid var(--bdr)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>PAYROLL</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#f87171" }}>¥{totalPayrollMonthly.toFixed(0)}<span style={{ fontSize: 13, color: "var(--dim)", fontWeight: 400 }}>/mo</span></div>
        <div style={{ fontSize: 11, color: "var(--dim)" }}>≈ ¥{totalPayrollWeekly.toFixed(0)}/wk · {employees.length} employee{employees.length !== 1 ? "s" : ""}</div>
      </div>
      <div style={{ padding: 16, borderRadius: 10, background: "var(--s2,#1a1a1a)", border: "1px solid var(--bdr)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>OTHER EXPENSES</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#f87171" }}>¥{totalExpensesMonthly.toFixed(0)}<span style={{ fontSize: 13, color: "var(--dim)", fontWeight: 400 }}>/mo</span></div>
        <div style={{ fontSize: 11, color: "var(--dim)" }}>≈ ¥{totalExpensesWeekly.toFixed(0)}/wk · packaging, rent, work supplies</div>
      </div>
    </div>

    <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>One-off this week</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
      <div style={{ padding: 16, borderRadius: 10, background: "var(--s2,#1a1a1a)", border: "1px solid var(--bdr)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>ONE-TIME EXPENSES</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#f87171" }}>¥{oneTimeThisWeek.toFixed(0)}</div>
        <div style={{ fontSize: 11, color: "var(--dim)" }}>this week only</div>
      </div>
      <div style={{ padding: 16, borderRadius: 10, background: "var(--s2,#1a1a1a)", border: "1px solid var(--bdr)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>REFERRAL COMMISSIONS</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#f87171" }}>¥{referralCommissionThisWeek.toFixed(0)}</div>
        <div style={{ fontSize: 11, color: "var(--dim)" }}>{referralRows.reduce((s, r) => s + r.count, 0)} new referral{referralRows.reduce((s, r) => s + r.count, 0) !== 1 ? "s" : ""} this week</div>
      </div>
      <div style={{ padding: 16, borderRadius: 10, background: "var(--s2,#1a1a1a)", border: `1px solid ${margin >= 0 ? "var(--green)" : "#f87171"}` }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>ESTIMATED MARGIN</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: margin >= 0 ? "var(--green)" : "#f87171" }}>¥{margin.toFixed(0)}</div>
        <div style={{ fontSize: 11, color: "var(--dim)" }}>{marginPct.toFixed(1)}% of revenue</div>
      </div>
    </div>

    <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 10 }}>Employees</div>
    <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
      <input placeholder="Employee name" value={newEmp.name} onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))} style={{ width: 220 }} />
      <input type="number" placeholder="¥ per month" value={newEmp.monthly_pay} onChange={e => setNewEmp(p => ({ ...p, monthly_pay: e.target.value }))} style={{ width: 120 }} />
      <button className="btn btn-xs" onClick={addEmployee}>+ Add</button>
    </div>
    <div style={{ overflowX: "auto", marginBottom: 24 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Name</th>
          <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>¥ / month</th>
          <th style={{ padding: "8px 10px" }}></th>
        </tr></thead>
        <tbody>
          {employees.map(emp => (
            <tr key={emp.id} style={{ borderTop: "1px solid var(--bdr)" }}>
              <td style={{ padding: 10, color: "#fff" }}>{emp.name}</td>
              <td style={{ padding: 10, textAlign: "right" }}>
                <input type="number" defaultValue={emp.monthly_pay} style={{ width: 90, textAlign: "right" }}
                  onBlur={e => { if (Number(e.target.value || 0) !== Number(emp.monthly_pay || 0)) saveEmployeePay(emp, e.target.value); }} />
              </td>
              <td style={{ padding: 10, textAlign: "right" }}>
                <button className="btn btn-xs" style={{ background: "#450a0a", color: "#f87171", border: "none" }} onClick={() => removeEmployee(emp)}>Delete</button>
              </td>
            </tr>
          ))}
          {employees.length === 0 && <tr><td colSpan={3} style={{ padding: 30, textAlign: "center", color: "var(--dim)" }}>No employees yet.</td></tr>}
        </tbody>
      </table>
    </div>

    <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 10 }}>Other Expenses</div>
    <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
      <input placeholder="e.g. Packaging, Rent" value={newExpense.name} onChange={e => setNewExpense(p => ({ ...p, name: e.target.value }))} style={{ width: 220 }} />
      <input type="number" placeholder="¥ per month" value={newExpense.monthly_amount} onChange={e => setNewExpense(p => ({ ...p, monthly_amount: e.target.value }))} style={{ width: 120 }} />
      <button className="btn btn-xs" onClick={addExpense}>+ Add</button>
    </div>
    <div style={{ overflowX: "auto", marginBottom: 24 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Name</th>
          <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>¥ / month</th>
          <th style={{ padding: "8px 10px" }}></th>
        </tr></thead>
        <tbody>
          {otherExpenses.map(exp => (
            <tr key={exp.id} style={{ borderTop: "1px solid var(--bdr)" }}>
              <td style={{ padding: 10, color: "#fff" }}>{exp.name}</td>
              <td style={{ padding: 10, textAlign: "right" }}>
                <input type="number" defaultValue={exp.monthly_amount} style={{ width: 90, textAlign: "right" }}
                  onBlur={e => { if (Number(e.target.value || 0) !== Number(exp.monthly_amount || 0)) saveExpenseAmount(exp, e.target.value); }} />
              </td>
              <td style={{ padding: 10, textAlign: "right" }}>
                <button className="btn btn-xs" style={{ background: "#450a0a", color: "#f87171", border: "none" }} onClick={() => removeExpense(exp)}>Delete</button>
              </td>
            </tr>
          ))}
          {otherExpenses.length === 0 && <tr><td colSpan={3} style={{ padding: 30, textAlign: "center", color: "var(--dim)" }}>No other expenses yet.</td></tr>}
        </tbody>
      </table>
    </div>

    <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 10 }}>One-Time Expenses</div>
    <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
      <input placeholder="e.g. Freezer repair" value={newOneTime.name} onChange={e => setNewOneTime(p => ({ ...p, name: e.target.value }))} style={{ width: 200 }} />
      <input type="number" placeholder="¥ amount" value={newOneTime.amount} onChange={e => setNewOneTime(p => ({ ...p, amount: e.target.value }))} style={{ width: 100 }} />
      <input type="date" value={newOneTime.expense_date} onChange={e => setNewOneTime(p => ({ ...p, expense_date: e.target.value }))} style={{ width: 150 }} />
      <button className="btn btn-xs" onClick={addOneTimeExpense}>+ Add</button>
    </div>
    <div style={{ overflowX: "auto", marginBottom: 24 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Name</th>
          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Date</th>
          <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>¥</th>
          <th style={{ padding: "8px 10px" }}></th>
        </tr></thead>
        <tbody>
          {oneTimeExpenses.map(exp => (
            <tr key={exp.id} style={{ borderTop: "1px solid var(--bdr)" }}>
              <td style={{ padding: 10, color: "#fff" }}>{exp.name}</td>
              <td style={{ padding: 10, color: exp.expense_date >= weekStartIso && exp.expense_date <= weekEndIso ? "var(--green)" : "var(--muted)" }}>
                {exp.expense_date}{exp.expense_date >= weekStartIso && exp.expense_date <= weekEndIso && <span style={{ fontSize: 10, marginLeft: 6 }}>(this week)</span>}
              </td>
              <td style={{ padding: 10, textAlign: "right", color: "var(--dim)" }}>¥{Number(exp.amount).toFixed(0)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>
                <button className="btn btn-xs" style={{ background: "#450a0a", color: "#f87171", border: "none" }} onClick={() => removeOneTimeExpense(exp)}>Delete</button>
              </td>
            </tr>
          ))}
          {oneTimeExpenses.length === 0 && <tr><td colSpan={4} style={{ padding: 30, textAlign: "center", color: "var(--dim)" }}>No one-time expenses yet.</td></tr>}
        </tbody>
      </table>
    </div>

    <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 10 }}>Referral Commissions</div>
    <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 10 }}>¥ per new referral signed up this week, per coach. Rates are managed here; coach names/codes are managed in the Referrals tab.</div>
    <div style={{ overflowX: "auto", marginBottom: 24 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Coach</th>
          <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>¥ per referral</th>
          <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>New referrals this week</th>
          <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Owed this week</th>
        </tr></thead>
        <tbody>
          {coaches.map(coach => {
            const r = referralRows.find(x => x.coach.id === coach.id);
            return (
              <tr key={coach.id} style={{ borderTop: "1px solid var(--bdr)" }}>
                <td style={{ padding: 10, color: "#fff" }}>{coach.name} <span style={{ color: "var(--dim)", fontSize: 11 }}>({coach.code})</span></td>
                <td style={{ padding: 10, textAlign: "right" }}>
                  <input type="number" defaultValue={coach.commission_per_referral} style={{ width: 70, textAlign: "right" }}
                    onBlur={e => { if (Number(e.target.value || 0) !== Number(coach.commission_per_referral || 0)) saveCoachCommission(coach, e.target.value); }} />
                  {savingCoachId === coach.id && <span style={{ fontSize: 10, color: "var(--dim)", marginLeft: 6 }}>saving…</span>}
                </td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--muted)" }}>{r ? r.count : 0}</td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--dim)" }}>¥{(r ? r.amount : 0).toFixed(0)}</td>
              </tr>
            );
          })}
          {coaches.length === 0 && <tr><td colSpan={4} style={{ padding: 30, textAlign: "center", color: "var(--dim)" }}>No coaches yet — add them in the Referrals tab.</td></tr>}
        </tbody>
      </table>
    </div>

    <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 10 }}>Ingredient cost by day</div>
    {costByDay.unassigned.length > 0 && (
      <div style={{ padding: 10, borderRadius: 8, background: "rgba(251,191,36,.1)", border: "1px solid #fbbf24", color: "#fbbf24", fontSize: 12, marginBottom: 14 }}>
        ⚠ These meals are being ordered this week but have no ingredients assigned yet, so the cost above is missing them: {costByDay.unassigned.join(", ")}.
      </div>
    )}
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>Day</th>
          <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Est. cost</th>
        </tr></thead>
        <tbody>
          {costByDay.days.map(d => (
            <tr key={d.day} style={{ borderTop: "1px solid var(--bdr)" }}>
              <td style={{ padding: 10, color: "#fff" }}>{d.day}</td>
              <td style={{ padding: 10, textAlign: "right", color: "var(--dim)" }}>
                ¥{d.cost.toFixed(0)}{d.missing && <span style={{ color: "#fbbf24", marginLeft: 8 }}>⚠ partial</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>}

    {view === "history" && <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={`btn ${historyMode === "week" ? "" : "btn-g"} btn-sm`} onClick={() => setHistoryMode("week")}>Week by week</button>
        <button className={`btn ${historyMode === "month" ? "" : "btn-g"} btn-sm`} onClick={() => setHistoryMode("month")}>Month by month</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 12 }}>{historyMode === "week" ? "Week of" : "Month"}</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Plan Rev.</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Delivery Rev.</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Ingredient Cost</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Payroll</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Other Exp.</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>One-Time</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Referral Comm.</th>
            <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 12 }}>Margin</th>
          </tr></thead>
          <tbody>
            {historyRows.map(r => (
              <tr key={r.week_start} style={{ borderTop: "1px solid var(--bdr)" }}>
                <td style={{ padding: 10, color: "#fff" }}>
                  {r.week_start}{r.week_start === weekStartIso && <span style={{ color: "var(--dim)", fontSize: 11, marginLeft: 6 }}>(current)</span>}
                  {historyMode === "month" && <span style={{ color: "var(--dim)", fontSize: 11, marginLeft: 6 }}>({r.weeks} wk{r.weeks !== 1 ? "s" : ""})</span>}
                </td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--muted)" }}>¥{Number(r.plan_revenue).toFixed(0)}</td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--muted)" }}>¥{Number(r.delivery_revenue).toFixed(0)}</td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--muted)" }}>¥{Number(r.ingredient_cost).toFixed(0)}</td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--muted)" }}>¥{Number(r.payroll).toFixed(0)}</td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--muted)" }}>¥{Number(r.other_expenses).toFixed(0)}</td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--muted)" }}>¥{Number(r.one_time_expenses || 0).toFixed(0)}</td>
                <td style={{ padding: 10, textAlign: "right", color: "var(--muted)" }}>¥{Number(r.referral_commission || 0).toFixed(0)}</td>
                <td style={{ padding: 10, textAlign: "right", fontWeight: 700, color: Number(r.margin) >= 0 ? "var(--green)" : "#f87171" }}>¥{Number(r.margin).toFixed(0)}</td>
              </tr>
            ))}
            {historyRows.length === 0 && <tr><td colSpan={9} style={{ padding: 30, textAlign: "center", color: "var(--dim)" }}>No history yet — it builds up automatically each time this screen is opened during a given week.</td></tr>}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}

// ─── APP ─────────────────────────────────────────────────────────────────────

function MenuTab({ menu, plans, currentWeekIndex, rotationOrder, saveRotationOrder, upsertMenuDay, flash, mealLibraryRef }) {
  const [draggingWeekPos, setDraggingWeekPos] = useState(null);
  const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
  const [menuTab,      setMenuTab]      = useState("library");
  const [menuTier,     setMenuTier]     = useState("");
  // null until the staff member explicitly picks a week; until then it
  // follows whichever week is currently live.
  const [plannerWeek,  setPlannerWeek]  = useState(null);
  const effectivePlannerWeek = plannerWeek || currentWeekIndex || 1;

  const weekMenu = menu[effectivePlannerWeek] || {};
  const [showAddMeal,  setShowAddMeal]  = useState(false);
  const [mealForm,     setMealForm]     = useState({name:"",nameZh:"",kcal:"",protein:"",carbs:"",fat:"",photoUrl:"",photoFile:null});
  const [draggingMeal, setDraggingMeal] = useState(null);
  const draggingMealRef = useRef(null);
  const [dragOver,     setDragOver]     = useState(null);
  const [extraRows,    setExtraRows]    = useState(()=>parseInt(localStorage.getItem("menuExtraRows")||"0"));
  const [mealLibrary,  setMealLibrary]  = useState([]);
  const [savingMeal,   setSavingMeal]   = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryTierFilter, setLibraryTierFilter] = useState("ALL");

  const updateExtraRows = (fn) => {
    setExtraRows(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      localStorage.setItem("menuExtraRows", String(next));
      return next;
    });
  };

  // Tiers come directly from plans.tier — no hardcoding.
  // Each unique tier label becomes one tab. The key used in menu{} is whatever
  // string is actually stored in Supabase (matched case-insensitively).
  const availableTiers = useMemo(()=>{
    const seen = new Set();
    const tiers = [];
    (plans||[]).forEach(p=>{
      if(!p.tier) return;
      const key = p.tier; // use the tier label as-is as the internal key
      const keyLower = key.toLowerCase();
      if(seen.has(keyLower)) return;
      seen.add(keyLower);
      tiers.push({ tier:key, label:p.tier, color:p.color||"#aaa" });
    });
    return tiers;
  },[plans]);

  // Active tier
  const activeTier = menuTier || availableTiers[0]?.tier || "";

  // Find the matching menu key case-insensitively
  // activeTierKey = the actual key in menu{} used for upserts
  const { tierMenu, activeTierKey } = useMemo(()=>{
    const match = Object.keys(weekMenu).find(k =>
      k === activeTier || k.toLowerCase() === activeTier.toLowerCase()
    );
    if (match) return { tierMenu: weekMenu[match], activeTierKey: match };
    return { tierMenu: {}, activeTierKey: activeTier };
  }, [weekMenu, activeTier, availableTiers]);

  // Load meal library from Supabase on mount
  useEffect(()=>{
    import("./lib/supabase").then(({getMealLibrary})=>{
      getMealLibrary().then(data=>{
        setMealLibrary(data||[]);
        if(mealLibraryRef) mealLibraryRef.current = data||[];
        setLibraryLoaded(true);
      }).catch(console.error);
    });
  },[]);

  // allMeals = meal_library filtered by active tier (planner) or all (library)
  const allMeals = useMemo(()=>{
    return mealLibrary
      .filter(m => {
        if (m.item_type !== "meal") return false;
        if (menuTab === "planner") {
          return m.tier === activeTier || (m.tier||"").toLowerCase() === activeTier.toLowerCase();
        }
        return true;
      })
      .map(m=>({...m, source:"meal"}))
      .sort((a,b)=>{
        return a.name.localeCompare(b.name);
      });
  },[mealLibrary, menuTier, menuTab, activeTier]);

  const saveMealToLibrary = async () => {
    if(!mealForm.name.trim()){alert("Meal name is required");return;}
    setSavingMeal(true);
    try {
      const {upsertMealLibrary, uploadMealPhoto} = await import("./lib/supabase");
      const payload = {
        name: mealForm.name.trim(),
        name_zh: mealForm.nameZh.trim()||null,
        kcal: parseInt(mealForm.kcal)||0,
        protein: parseInt(mealForm.protein)||0,
        carbs: parseInt(mealForm.carbs)||0,
        fat: parseInt(mealForm.fat)||0,
        item_type: mealForm.itemType||"meal",
        tier: mealForm.itemType==="meal" ? (mealForm.tier||availableTiers[0]?.tier||"") : null,
        is_snack: false,
        available_sauce_ids: [],
      };
      if(editingMealId) payload.id = editingMealId;
      // First save to get the ID
      const saved = await upsertMealLibrary(payload);
      // Then upload photo if one was selected
      if(mealForm.photoFile) {
        try {
          const url = await uploadMealPhoto(mealForm.photoFile, saved.id);
          saved.photo_url = url;
          await upsertMealLibrary({...saved, photo_url: url});
        } catch(photoErr){ console.error("Photo upload failed:", photoErr); }
      }
      setMealLibrary(p=>{
        const idx = p.findIndex(m=>m.id===saved.id);
        return idx>=0 ? p.map((m,i)=>i===idx?saved:m) : [...p,saved];
      });
      setShowAddMeal(false);
      setEditingMealId(null);
      flash();
    } catch(e){ console.error(e); alert("Error saving meal"); }
    setSavingMeal(false);
  };

  const deleteMealFromLibrary = async (id, name) => {
    try {
      const {deleteMealLibrary, getMealUsageCount} = await import("./lib/supabase");
      const usageCount = await getMealUsageCount(id);
      if (usageCount > 0) {
        const proceed = confirm(
          `⚠️ ATENCIÓN: "${name}" ya está guardado en ${usageCount} selección(es) de clientes.\n\n` +
          `Si la borrás, esos clientes van a quedar con esa comida en blanco/rota en su pedido.\n\n` +
          `Recomendado: en vez de borrarla, sacala del menú semanal (Planner) y dejala viva en la biblioteca.\n\n` +
          `¿Borrar "${name}" de todos modos?`
        );
        if (!proceed) return;
      } else {
        if (!confirm(`Delete "${name}"?`)) return;
      }
      await deleteMealLibrary(id);
      setMealLibrary(p=>p.filter(m=>m.id!==id));
      flash();
    } catch(e){ console.error(e); }
  };

  const [editingMealId, setEditingMealId] = useState(null);

  const openEditMeal = (m) => {
    setEditingMealId(m.id);
    setMealForm({name:m.name,nameZh:m.name_zh||"",kcal:m.kcal||"",protein:m.protein||"",carbs:m.carbs||"",fat:m.fat||"",photoUrl:m.photo_url||"",photoFile:null,itemType:"meal",tier:m.tier||""});
    setShowAddMeal(true);
  };

  const handlePhotoDrop = (e) => {
    e.preventDefault();
    const file=e.dataTransfer?.files[0]||e.target?.files?.[0];
    if(file&&file.type.startsWith("image/")){
      setMealForm(p=>({...p,photoFile:file,photoUrl:URL.createObjectURL(file)}));
    }
  };

  const handleAssignMeal = (day, slot) => {
    const meal = draggingMealRef.current;
    if(!meal) return;
    const si = parseInt(slot.replace("Meal ",""))-1;
    const dm = tierMenu[day] || {mealIds:[]};
    const newIds = [...(dm.mealIds||[])];
    while(newIds.length <= si) newIds.push("");
    newIds[si] = meal.id;
    upsertMenuDay(day, activeTierKey, effectivePlannerWeek, {mealIds:newIds.filter(Boolean), snackId:""});
    draggingMealRef.current = null;
    setDraggingMeal(null); setDragOver(null);
  };

  // Tier color lookup
  const activeTierColor = availableTiers.find(t=>t.tier===activeTier)?.color || "#38bdf8";

  return <>
    {/* ── Top nav: Library vs Planner ── */}
    <div style={{display:"flex",gap:2,marginBottom:0,borderBottom:"1px solid var(--bdr)"}}>
      {[["library","Meal Library"],["planner","Weekly Planner"]].map(([key,label])=>(
        <button key={key} onClick={()=>setMenuTab(key)}
          style={{flex:1,padding:"13px 16px",background:"none",border:"none",borderBottom:`2px solid ${menuTab===key?"var(--red)":"transparent"}`,marginBottom:"-1px",
            color:menuTab===key?"var(--red)":"var(--muted)",fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,cursor:"pointer",transition:"all .15s",letterSpacing:.3}}>
          {label}
        </button>
      ))}
    </div>

    {/* ── Planner: week selector + rotation order (drag to reorder) ── */}
    {menuTab==="planner"&&(
      <div style={{display:"flex",gap:8,alignItems:"center",marginTop:14,marginBottom:10,flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"var(--muted)",fontWeight:600}}>Week:</span>
        {rotationOrder.map((w,pos)=>(
          <div key={pos}
            draggable
            onDragStart={()=>setDraggingWeekPos(pos)}
            onDragOver={e=>e.preventDefault()}
            onDrop={()=>{
              if (draggingWeekPos===null || draggingWeekPos===pos) return;
              const next = [...rotationOrder];
              const [moved] = next.splice(draggingWeekPos,1);
              next.splice(pos,0,moved);
              saveRotationOrder(next);
              setDraggingWeekPos(null);
            }}
            onDragEnd={()=>setDraggingWeekPos(null)}
            onClick={()=>setPlannerWeek(w)}
            className={`btn btn-sm ${effectivePlannerWeek===w?"btn-r":"btn-g"}`}
            style={{minWidth:64,cursor:"grab",opacity:draggingWeekPos===pos?0.5:1}}
          >
            Menu {w}
          </div>
        ))}
      </div>
    )}

    {/* ── Planner: tier tabs directly below ── */}
    {menuTab==="planner"&&(
      <div style={{display:"flex",gap:0,marginBottom:16,borderBottom:"1px solid var(--bdr)",marginTop:0}}>
        {availableTiers.map(({tier:t,label:lbl,color:col})=>(
          <button key={t} onClick={()=>setMenuTier(t)}
            style={{flex:1,padding:"14px 10px",background:activeTier===t?`${col}18`:"none",border:"none",
              borderBottom:`2px solid ${activeTier===t?col:"transparent"}`,marginBottom:"-1px",
              color:activeTier===t?col:"var(--muted)",fontFamily:"'DM Sans',sans-serif",
              fontWeight:700,fontSize:15,cursor:"pointer",transition:"all .15s",letterSpacing:.3}}>
            {lbl}
          </button>
        ))}
      </div>
    )}

    {/* ── Library: add a small top margin ── */}
    {menuTab==="library"&&<div style={{marginTop:14}}/>}

    {menuTab==="library"&&<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div className="sec-title" style={{marginBottom:0}}>All Meals ({allMeals.length})</div>
        <button className="btn btn-r btn-sm" onClick={()=>{setMealForm({name:"",nameZh:"",kcal:"",protein:"",carbs:"",fat:"",photoUrl:"",photoFile:null,itemType:"meal",tier:""});setEditingMealId(null);setShowAddMeal(true);}}>+ Add Meal</button>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        <button className={`btn btn-sm ${libraryTierFilter==="ALL"?"btn-r":"btn-g"}`} onClick={()=>setLibraryTierFilter("ALL")}>All</button>
        {availableTiers.map(({tier:t,label:lbl,color:col})=>(
          <button key={t} className="btn btn-sm" style={{background:libraryTierFilter===t?col:"var(--s2)",color:libraryTierFilter===t?"#000":col,border:`1px solid ${col}66`,fontWeight:700}} onClick={()=>setLibraryTierFilter(t)}>
            {lbl}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16}}>
        {allMeals
          .filter(m=>{
            if(libraryTierFilter==="ALL") return true;
            return m.item_type==="meal" && (libraryTierFilter==="ALL" || m.tier===libraryTierFilter || (m.tier||"").toLowerCase()===libraryTierFilter.toLowerCase());
          })
          .slice()
          .sort((a,b)=>{
            const tierA = (a.tier||"").toLowerCase(), tierB = (b.tier||"").toLowerCase();
            if(tierA!==tierB) return tierA.localeCompare(tierB);
            return (a.name||"").localeCompare(b.name||"");
          })
          .map((m,i)=>{
          const tierDef = availableTiers.find(t=>t.tier===m.tier||t.tier.toLowerCase()===(m.tier||"").toLowerCase());
          const tc = tierDef?.color||"#60a5fa";
          const badgeLabel = tierDef?.label||m.tier||"—";
          return (
          <div key={m.id||i} draggable onDragStart={()=>{draggingMealRef.current=m;setDraggingMeal(m);}} onDragEnd={()=>{draggingMealRef.current=null;setDraggingMeal(null);}}
            style={{overflow:"hidden",borderRadius:10,border:`1px solid ${tc}55`,background:"var(--s2)",cursor:"grab",userSelect:"none",position:"relative"}}>
            {m.id&&<button onClick={e=>{e.stopPropagation();deleteMealFromLibrary(m.id,m.name);}}
              style={{position:"absolute",top:8,left:8,background:"rgba(0,0,0,0.75)",border:"none",color:"#f87171",width:24,height:24,borderRadius:"50%",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>✕</button>}
            <div style={{width:"100%",height:130,background:"var(--s3)",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",borderBottom:`1px solid ${tc}33`}}>
              {m.photo_url
                ? <img src={m.photo_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={m.name}/>
                : <span style={{fontSize:12,color:"var(--dim)"}}>No photo yet</span>}
              <span style={{position:"absolute",top:8,right:8,fontSize:10,padding:"3px 9px",borderRadius:4,
                background:tc,color:"#000",letterSpacing:.5,fontWeight:800}}>
                {badgeLabel}
              </span>
            </div>
            <div style={{padding:"12px 14px"}}>
              <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:4}}>{m.name}</div>
              {m.kcal>0&&<div style={{fontSize:11,color:"var(--dim)"}}>{m.kcal} kcal · {m.protein}P {m.carbs}C {m.fat}F</div>}
              {!m.kcal&&<div style={{fontSize:11,color:"var(--muted)"}}>Drag to planner</div>}
              {m.id&&<button onClick={e=>{e.stopPropagation();openEditMeal(m);}}
                style={{marginTop:10,background:"var(--s3)",border:`1px solid ${tc}44`,color:tc,fontSize:12,padding:"6px 8px",borderRadius:6,cursor:"pointer",width:"100%",opacity:.9,fontWeight:600}}>
                Edit
              </button>}
            </div>
          </div>
          );
        })}
        {allMeals.length===0&&<div style={{color:"var(--dim)",fontSize:11,padding:20,gridColumn:"1/-1"}}>No meals yet. Click + Add Meal to get started.</div>}
      </div>
    </>}

    {menuTab==="planner"&&<>
      {!libraryLoaded
        ? <div style={{padding:40,textAlign:"center",color:"var(--dim)"}}>Loading meals...</div>
        : <>
      {/* ── Sidebar meals + grid ── */}
      <div className="planner-wrap">

        {/* ── Sidebar: meals for active tier ── */}
        <div className="planner-sidebar">
          {/* Header with tier color accent */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,paddingBottom:10,borderBottom:`1px solid ${activeTierColor}44`}}>
            <div style={{width:4,height:16,borderRadius:2,background:activeTierColor,flexShrink:0}}/>
            <span style={{fontSize:11,color:activeTierColor,textTransform:"uppercase",letterSpacing:1.5,fontWeight:700}}>
              Drag meals → (o tocá una comida y después una celda)
            </span>
          </div>
          {/* Tap-to-place: visible once a meal is selected by tap (needed on mobile, where drag doesn't work) */}
          <div className={`planner-selected-bar ${draggingMeal ? "show" : ""}`}>
            <span>Seleccionada: <strong>{draggingMeal?.name}</strong> — tocá una celda</span>
            <button onClick={()=>{draggingMealRef.current=null;setDraggingMeal(null);}}
              style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:15,padding:0,flexShrink:0}}>✕</button>
          </div>
          <div className="planner-meal-list" style={{display:"flex",flexDirection:"column",gap:7,paddingRight:4}}>
            {/* Meals for this tier */}
            {(()=>{
              const tierMeals = allMeals.filter(m => m.item_type === "meal");
              const getMealStyle = (m) => ({
                background: draggingMeal?.id===m.id ? activeTierColor : "var(--s2)",
                border: `1px solid ${draggingMeal?.id===m.id ? activeTierColor : activeTierColor+"44"}`,
                borderRadius: 8,
                padding: "13px 14px",
                fontSize: 14,
                color: draggingMeal?.id===m.id ? "#fff" : "#ccc",
                cursor: "grab",
                userSelect: "none",
                lineHeight: 1.35,
                transition: "background .15s, border-color .15s",
                wordBreak: "break-word",
              });
              return <>
                {tierMeals.length > 0 && <>
                  {tierMeals.map((m,i)=>(
                    <div key={m.id||i} draggable
                      onDragStart={()=>{draggingMealRef.current=m;setDraggingMeal(m);}}
                      onDragEnd={()=>{draggingMealRef.current=null;setDraggingMeal(null);}}
                      onClick={()=>{
                        if (draggingMeal?.id===m.id) { draggingMealRef.current=null; setDraggingMeal(null); }
                        else { draggingMealRef.current=m; setDraggingMeal(m); }
                      }}
                      style={getMealStyle(m)}>
                      {m.name}
                    </div>
                  ))}
                </>}
                {tierMeals.length===0 && (
                  <div style={{fontSize:13,color:"var(--dim)",padding:"16px 10px",textAlign:"center",lineHeight:1.5}}>
                    No meals for this tier yet.<br/>
                    <span style={{fontSize:12,color:"var(--dim)"}}>Add meals in Library first</span>
                  </div>
                )}
              </>;
            })()}
          </div>
        </div>

        {/* ── Weekly grid ── */}
        <div className="planner-grid-wrap">
          <table className="planner-table">
            <thead><tr>
              <th style={{width:75,padding:"8px 10px",textAlign:"left",color:"var(--muted)",fontSize:12,fontWeight:700}}>SLOT</th>
              {DAYS.map(d=><th key={d} style={{padding:"8px 6px",color:activeTierColor,fontSize:12,fontWeight:700,textAlign:"center",letterSpacing:.5}}>{d.slice(0,3).toUpperCase()}</th>)}
            </tr></thead>
            <tbody>
              {[...["Meal 1","Meal 2","Meal 3"],...Array.from({length:extraRows},(_,i)=>`Meal ${4+i}`)].map((slot)=>{
                const mealIdx=parseInt(slot.replace("Meal ",""))-1;
                return (
                <tr key={slot}>
                  <td style={{padding:"6px 10px",color:"var(--dim)",fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>{slot}</td>
                  {DAYS.map(day=>{
                    const mealObj = tierMenu[day]?.meals?.[mealIdx]||null;
                    const val = mealObj?.name || "";
                    const isOver=dragOver===`${day}-${slot}`;
                    return (
                      <td key={day}
                        onDragOver={e=>{e.preventDefault();setDragOver(`${day}-${slot}`);}}
                        onDragLeave={()=>setDragOver(null)}
                        onDrop={()=>handleAssignMeal(day,slot)}
                        onClick={()=>{ if (draggingMeal) handleAssignMeal(day,slot); }}
                        style={{padding:5}}>
                        <div title={val||""}
                          style={{
                            background:isOver?`${activeTierColor}18`:val?"var(--s2)":"var(--s3)",
                            border:`1px ${isOver?"solid":"dashed"} ${isOver?activeTierColor:val?`${activeTierColor}33`:"#2a2a2a"}`,
                            borderRadius:8,padding:"14px 10px",minHeight:92,minWidth:90,fontSize:13,
                            color:val?"#ddd":"var(--dim)",textAlign:"center",
                            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,
                            transition:"background .1s,border-color .1s",
                            cursor:draggingMeal?"pointer":"default",
                          }}>
                          <span style={{width:"100%",textAlign:"center",lineHeight:1.45,wordBreak:"break-word",fontWeight:val?500:400}}>
                            {val||<span style={{fontSize:12,color:"#333"}}>Drop</span>}
                          </span>
                          {val&&<span style={{fontSize:11,color:"var(--dim)",cursor:"pointer",marginTop:3,opacity:.7}}
                            onClick={e=>{
                              e.stopPropagation();
                              const dm=tierMenu[day]||{mealIds:[]};
                              const newIds=[...(dm.mealIds||[])];
                              newIds[mealIdx]="";
                              upsertMenuDay(day,activeTierKey,effectivePlannerWeek,{mealIds:newIds.filter(Boolean),snackId:""});
                            }}>
                            ✕
                          </span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
                );
              })}
              <tr>
                <td colSpan={6} style={{padding:"8px 4px"}}>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn btn-g btn-sm" onClick={()=>updateExtraRows(r=>r+1)} style={{flex:1}}>
                      + Add Meal Row
                    </button>
                    {extraRows>0&&<button className="btn btn-sm" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>updateExtraRows(r=>r-1)}>
                      − Remove
                    </button>}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      </>}
    </>}

    {showAddMeal&&(
      <div className="mo" onClick={()=>{setShowAddMeal(false);setEditingMealId(null);}}>
        <div className="mo-box" style={{maxWidth:820,maxHeight:"95vh"}} onClick={e=>e.stopPropagation()}>
          <div className="mo-hd"><div className="mo-title">{editingMealId?"Edit Meal":"Add New Meal"}</div><button className="mo-close" onClick={()=>{setShowAddMeal(false);setEditingMealId(null);}}>✕</button></div>
          <div className="mo-body" style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:20}}>
            <div onDragOver={e=>e.preventDefault()} onDrop={handlePhotoDrop}
              style={{border:"2px dashed var(--bdr)",borderRadius:10,height:130,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"var(--s2)",cursor:"pointer",overflow:"hidden"}}
              onClick={()=>document.getElementById("meal-photo-inp").click()}>
              {mealForm.photoUrl
                ?<img src={mealForm.photoUrl} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="meal"/>
                :<><span style={{fontSize:26,marginBottom:5}}>📸</span><span style={{fontSize:11,color:"var(--muted)"}}>Drag & drop photo</span><span style={{fontSize:10,color:"var(--dim)"}}>or click to browse</span></>}
              <input id="meal-photo-inp" type="file" accept="image/*" style={{display:"none"}} onChange={handlePhotoDrop}/>
            </div>
            <div style={{display:"grid",gap:12}}>
              <div><div className="form-label">Name *</div><input className="form-inp" style={{fontSize:14,padding:"9px 11px"}} value={mealForm.name} onChange={e=>setMealForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Minced Beef Bowl"/></div>
              <div><div className="form-label">Name (Chinese)</div><input className="form-inp" style={{fontSize:14,padding:"9px 11px"}} value={mealForm.nameZh} onChange={e=>setMealForm(p=>({...p,nameZh:e.target.value}))} placeholder="e.g. 牛肉碗"/></div>
            </div>
            <div style={{gridColumn:"1 / -1"}}>
              <div className="form-label">Plan</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {availableTiers.map(({tier:t,label:lbl})=>(
                  <button key={t} type="button" className={`btn btn-sm ${mealForm.tier===t?"btn-r":"btn-g"}`} style={{flex:1,minWidth:90,padding:"7px 0"}} onClick={()=>setMealForm(p=>({...p,tier:t}))}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div style={{gridColumn:"1 / -1",display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
              {[["kcal","Kcal"],["protein","Protein g"],["carbs","Carbs g"],["fat","Fat g"]].map(([k,lbl])=>(
                <div key={k}><div className="form-label">{lbl}</div><input className="form-inp" type="number" style={{fontSize:13,padding:"8px 9px"}} value={mealForm[k]||""} onChange={e=>setMealForm(p=>({...p,[k]:e.target.value}))} placeholder="0"/></div>
              ))}
            </div>
          </div>
          <div className="mo-ft">
            <button className="btn btn-g" style={{flex:1,padding:"11px 0"}} onClick={()=>{setShowAddMeal(false);}}>Cancel</button>
            <button className="btn btn-r" style={{flex:1,padding:"11px 0"}} onClick={saveMealToLibrary} disabled={savingMeal}>
              {savingMeal?"Saving...":"Save Meal"}
            </button>
          </div>
        </div>
      </div>
    )}
  </>;
}

function LoginScreen({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [busy,     setBusy]     = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const session = await signIn(email.trim(), password);
      onLogin(session);
    } catch {
      setError("Invalid email or password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <style>{G}</style>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0a0a0a"}}>
        <form onSubmit={submit} style={{width:320,background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:10,padding:28}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div className="sb-brand" style={{fontSize:26}}><span>FIT</span> IGNYTE</div>
            <div className="sb-sub">Operations System</div>
          </div>
          <div className="fl" style={{marginBottom:12}}>
            <label>Email</label>
            <input className="inp" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/>
          </div>
          <div className="fl" style={{marginBottom:16}}>
            <label>Password</label>
            <input className="inp" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/>
          </div>
          {error && <div className="alert-bar" style={{marginBottom:14,fontSize:11}}>{error}</div>}
          <button className="btn btn-r" type="submit" disabled={busy} style={{width:"100%"}}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </>
  );
}

export default function App() {
  const [session,    setSession]    = useState(undefined); // undefined = checking, null = signed out

  const [clients,    setClients]    = useState([]);
  // meals: { [clientId]: { [day]: [ {id, time, meals:[], snack, note} ] } }
  // Each day can have MULTIPLE delivery slots per client
  const [meals,      setMeals]      = useState({});
  const [pendingMeals, setPendingMeals] = useState({});
  const [menu,       setMenu]       = useState({1:{},2:{}});
  const [currentWeekIndex, setCurrentWeekIndex] = useState(1);
  const [rotationOrder, setRotationOrder] = useState([1,2]);
  const [plans,      setPlans]      = useState([]);
  const [tiers,      setTiers]      = useState([]);
  const [selectedTierId,  setSelectedTierId]  = useState(null);
  const [showTierModal,   setShowTierModal]   = useState(false);
  const [editTierId,      setEditTierId]      = useState(null);
  const [tierForm,        setTierForm]        = useState({name:"", name_zh:"", color:"#38BDF8"});
  const [checks,     setChecks]     = useState({});
  // cookTimes: { Monday: "10:00", Tuesday: "09:30", ... }
  const [cookTimes,  setCookTimes]  = useState({});
  const mealLibraryRef = useRef([]);
  const [ingredients,     setIngredients]     = useState([]);
  const [mealIngredients, setMealIngredients] = useState([]);
  const [paidPayments,    setPaidPayments]    = useState([]);
  const [employees,       setEmployees]       = useState([]);
  const [otherExpenses,   setOtherExpenses]   = useState([]);
  const [acctSnapshots,   setAcctSnapshots]   = useState([]);
  const [oneTimeExpenses, setOneTimeExpenses] = useState([]);
  const [mealLibraryState, setMealLibraryState] = useState([]);
  const [pdfUrls,    setPdfUrls]    = useState({en:"", cn:""});
  const [batchTimes, setBatchTimes] = useState(DEFAULT_BATCHES);
  const [pdfUploading,setPdfUploading]= useState({en:false, cn:false});
  // customMealItems: extra meals added manually
  const [customItems, setCustomItems] = useState([]);

  const [tab,         setTab]         = useState("dashboard");
  const [kitDay,      setKitDay]      = useState("Monday");
  const [showBatchEditor, setShowBatchEditor] = useState(false);
  const [batchDraft,      setBatchDraft]      = useState([]);

  const openBatchEditor = () => { setBatchDraft([...batchTimes]); setShowBatchEditor(true); };
  const saveBatchEditor = async () => {
    const cleaned = Array.from(new Set(batchDraft.map(t=>t.trim()).filter(Boolean))).sort();
    if (cleaned.length === 0) { alert("Necesitás al menos un horario de batch."); return; }
    setBatchTimes(cleaned);
    setShowBatchEditor(false);
    try { await upsertSetting("kitchen_batches", JSON.stringify(cleaned)); }
    catch (e) { alert(`No se pudo guardar: ${e.message || e}`); }
  };
  const [mealDay,     setMealDay]     = useState("Monday");
  const [deliveryDay, setDeliveryDay] = useState("Monday");
  const [sbOpen,    setSbOpen]    = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [loaded,    setLoaded]    = useState(false);
  const [error,     setError]     = useState(null);

  // Modals
  const [showClientModal, setShowClientModal] = useState(false);
  const [editClientId,    setEditClientId]    = useState(null);
  const [clientForm,      setClientForm]      = useState({...BLANK_CLIENT});

  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editPlanId,    setEditPlanId]    = useState(null);
  const [planForm,      setPlanForm]      = useState({...BLANK_PLAN});

  const [showMenuModal, setShowMenuModal] = useState(false);
  const [menuEditDay] = useState("Monday");
  const [menuForm,      setMenuForm]      = useState({meals:["","",""],snack:""});

  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  const [newCustomItem,       setNewCustomItem]       = useState("");

  const [search,   setSearch]   = useState("");
  const [filterSt, setFilterSt] = useState("all");
  const [clientsPage, setClientsPage] = useState(1);
  const CLIENTS_PAGE_SIZE = 20;

  const [pendingOrders,      setPendingOrders]      = useState([]);
  const [approvedOrders,     setApprovedOrders]     = useState([]);
  const [rejectedOrders,     setRejectedOrders]     = useState([]);
  const [pendingAddrChanges, setPendingAddrChanges]  = useState([]);
  const [ordersBusyId,       setOrdersBusyId]        = useState(null);
  const [orderDeleteBusyId,  setOrderDeleteBusyId]   = useState(null);
  const [orderToApprove,     setOrderToApprove]      = useState(null);
  const [approveFeeInput,    setApproveFeeInput]     = useState("");
  const [coaches,            setCoaches]            = useState([]);
  const [coachForm,          setCoachForm]          = useState({name:"",code:""});
  const [coachBusy,          setCoachBusy]          = useState(false);

  const [notifications,    setNotifications]    = useState([]);
  const [notifBusy,        setNotifBusy]        = useState(false);
  const [notifForm,        setNotifForm]        = useState({recipientMode:"select", statusFilter:"Active", clientIds:[], title:"", message:""});

  // ── Web Push (avisos de "new order" al telefono) ──
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled,   setPushEnabled]   = useState(false);
  const [pushBusy,      setPushBusy]      = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setPushSupported(true);
    navigator.serviceWorker.register("/sw.js").then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setPushEnabled(!!existing);
    }).catch(e => console.error("SW register failed:", e));
  }, []);

  const enablePush = async () => {
    setPushBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { alert("Notifications permission was not granted."); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      await upsertPushSubscription(sub);
      setPushEnabled(true);
    } catch (e) {
      console.error("enablePush failed:", e);
      alert("Could not enable notifications on this device.");
    } finally { setPushBusy(false); }
  };

  const disablePush = async () => {
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setPushEnabled(false);
    } catch (e) {
      console.error("disablePush failed:", e);
    } finally { setPushBusy(false); }
  };

  const refreshOrders = async () => {
    const [ords, approved, rejected, addrs] = await Promise.all([getPendingOrders(), getApprovedOrders(), getRejectedOrders(), getPendingAddressChanges()]);
    setPendingOrders(ords || []);
    setApprovedOrders(approved || []);
    setRejectedOrders(rejected || []);
    setPendingAddrChanges(addrs || []);
  };

  const refreshNotifications = async () => {
    setNotifications(await getNotifications());
  };

  const handleDeleteNotification = async (id) => {
    try {
      await deleteNotification(id);
      setNotifications(ns => ns.filter(n => n.id !== id));
    } catch (e) { console.error(e); alert("Could not delete notification."); }
  };

  // Clientes con una renovación ya pagada que `apply_pending_renewals` todavía
  // no aplicó a `clients` (renovación anticipada -- ver complete-payment).
  // Mientras tanto el ciclo viejo ya venció y getRealStatus() los marca
  // "Inactive", aunque ya pagaron y tienen el próximo ciclo confirmado.
  const pendingRenewalStartByClient = useMemo(() => {
    const m = {};
    paidPayments.forEach(p => {
      if (p.applied === false && (!m[p.client_id] || p.start_date < m[p.client_id])) {
        m[p.client_id] = p.start_date;
      }
    });
    return m;
  }, [paidPayments]);
  const clientRealStatus = useCallback((c) => {
    const rs = getRealStatus(c.startDate, c.expiryDate);
    return rs === "Inactive" && pendingRenewalStartByClient[c.id] ? "Upcoming" : rs;
  }, [pendingRenewalStartByClient]);

  const notifRecipients = useMemo(() => {
    if (notifForm.recipientMode === "all") return clients.map(c => c.id);
    if (notifForm.recipientMode === "status") {
      if (notifForm.statusFilter === "Expired") return clients.filter(c => c.expiryDate && daysUntil(c.expiryDate) < 0).map(c => c.id);
      // c.status queda desactualizado (se escribe una vez al pagar y nunca mas se
      // sincroniza) -- usamos clientRealStatus() como en el resto del panel, no la
      // columna cruda, para no mandarle el aviso al conjunto de clientes equivocado.
      return clients.filter(c => clientRealStatus(c) === notifForm.statusFilter).map(c => c.id);
    }
    return notifForm.clientIds;
  }, [notifForm.recipientMode, notifForm.statusFilter, notifForm.clientIds, clients, clientRealStatus]);

  const toggleNotifClient = (id) => {
    setNotifForm(f => ({...f, clientIds: f.clientIds.includes(id) ? f.clientIds.filter(x=>x!==id) : [...f.clientIds, id]}));
  };

  const applyNotifTemplate = (label) => {
    const t = NOTIF_TEMPLATES.find(t => t.label === label);
    if (t) setNotifForm(f => ({...f, title: t.title, message: t.message}));
  };

  const handleSendNotification = async (e) => {
    e.preventDefault();
    if (notifRecipients.length===0 || !notifForm.title.trim()) return;
    setNotifBusy(true);
    try {
      for (const clientId of notifRecipients) {
        await sendNotification(clientId, notifForm.title.trim(), notifForm.message.trim());
      }
      setNotifForm(f => ({...f, clientIds:[], title:"", message:""}));
      await refreshNotifications();
    } catch (e) { console.error(e); alert("Could not send notification."); }
    finally { setNotifBusy(false); }
  };

  const handleApproveOrder = (order) => {
    setApproveFeeInput(order.delivery_fee != null ? String(order.delivery_fee) : "");
    setOrderToApprove(order);
  };
  const handleRejectOrder = async (order) => {
    const note = prompt("Reason for rejection (optional):") || "";
    setOrdersBusyId(order.id);
    try { await rejectOrder(order.id, note); await refreshOrders(); }
    catch (e) { console.error(e); alert("Could not reject order."); }
    finally { setOrdersBusyId(null); }
  };
  const handleReApproveOrder = (order) => {
    setApproveFeeInput(order.delivery_fee != null ? String(order.delivery_fee) : "");
    setOrderToApprove(order);
  };
  // Borrar un pedido del historial (Approved/Rejected) es irreversible y no
  // deshace nada más -- si el pedido ya fue aprobado, el cliente que se creó
  // en `clients` NO se toca, así que se pide confirmación varias veces (y con
  // texto distinto según el estado) para que no sea un tap accidental.
  const handleDeleteOrder = async (order) => {
    if (!window.confirm(`¿Borrar el pedido de "${order.name}" del historial?\n\nEsta acción no se puede deshacer.`)) return;
    if (order.status === "approved") {
      if (!window.confirm(
        `Este pedido ya fue APROBADO.\n\n` +
        `Borrarlo NO borra al cliente "${order.name}" que ya se creó en Clients, ni afecta su pago -- ` +
        `solo elimina el registro del pedido/historial.\n\n` +
        `¿Seguro que querés continuar?`
      )) return;
    }
    if (!window.confirm(`Última confirmación: se va a borrar PERMANENTEMENTE el pedido de "${order.name}". ¿Continuar?`)) return;

    setOrderDeleteBusyId(order.id);
    try {
      await deleteNewOrder(order.id);
      await refreshOrders();
      flash();
    } catch (e) {
      console.error(e);
      alert(`No se pudo borrar el pedido: ${e.message || e}`);
    } finally {
      setOrderDeleteBusyId(null);
    }
  };
  const confirmApproveOrder = async () => {
    const order = orderToApprove;
    if (!order) return;
    const fee = Number(approveFeeInput);
    if (!approveFeeInput.trim() || !Number.isFinite(fee) || fee < 0) {
      alert("Enter a valid delivery fee.");
      return;
    }
    setOrdersBusyId(order.id);
    try {
      if (order.status === "rejected") await reApproveOrder(order, fee);
      else await approveOrder(order, fee);
      await refreshOrders();
      setOrderToApprove(null);
    } catch (e) { console.error(e); alert("Could not approve order."); }
    finally { setOrdersBusyId(null); }
  };
  const refreshCoaches = async () => setCoaches(await getCoaches());
  const handleAddCoach = async (e) => {
    e.preventDefault();
    if (!coachForm.name.trim() || !coachForm.code.trim()) return;
    setCoachBusy(true);
    try { await createCoach(coachForm.name.trim(), coachForm.code.trim()); setCoachForm({name:"",code:""}); await refreshCoaches(); }
    catch (err) { alert(err.message?.includes("unique") ? "That code is already in use." : "Could not add coach."); }
    finally { setCoachBusy(false); }
  };
  const handleDeleteCoach = async (id) => {
    if (!window.confirm("Remove this coach?")) return;
    await deleteCoach(id); await refreshCoaches();
  };
  const handleApproveAddrChange = async (change) => {
    setOrdersBusyId(change.id);
    try { await approveAddressChange(change); await refreshOrders(); }
    catch (e) { console.error(e); alert("Could not approve address change."); }
    finally { setOrdersBusyId(null); }
  };
  const handleRejectAddrChange = async (change) => {
    const note = prompt("Reason for rejection (optional):") || "";
    setOrdersBusyId(change.id);
    try { await rejectAddressChange(change, note); await refreshOrders(); }
    catch (e) { console.error(e); alert("Could not reject address change."); }
    finally { setOrdersBusyId(null); }
  };

  // ── Auth
  useEffect(() => {
    getSession().then(setSession).catch(e => { console.error(e); setSession(null); });
    const sub = onAuthChange(setSession);
    return () => sub?.unsubscribe();
  }, []);

  // ── Load
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const {getSettings, getMealLibrary} = await import("./lib/supabase");
        const [pl, cl, mn, ms, ch, st, lib, curWeek, rotOrder, tiersData, ingr, mealIngr, pmts, emps, otherExp, snaps, oneTimeExp, pendingMs] = await Promise.all([
          getPlans(), getClients(), getMenu(), getMealSelections(), getChecklist(),
          getSettings(["brochure_en","brochure_cn","kitchen_batches"]),
          getMealLibrary(),
          getCurrentWeekIndex(),
          getMenuRotationOrder(),
          getTiers().catch(() => []),
          getIngredients().catch(() => []),
          getMealIngredients().catch(() => []),
          getPaidPayments().catch(() => []),
          getEmployees().catch(() => []),
          getOtherExpenses().catch(() => []),
          getAccountingSnapshots().catch(() => []),
          getOneTimeExpenses().catch(() => []),
          getPendingMealSelections().catch(() => ({})),
        ]);
        setIngredients(ingr || []);
        setMealIngredients(mealIngr || []);
        setPaidPayments(pmts || []);
        setEmployees(emps || []);
        setOtherExpenses(otherExp || []);
        setAcctSnapshots(snaps || []);
        setOneTimeExpenses(oneTimeExp || []);
        refreshOrders().catch(e => console.error(e));
        refreshNotifications().catch(e => console.error(e));
        refreshCoaches().catch(e => console.error(e));
        // Populate ref immediately so mealName() works in useMemos
        mealLibraryRef.current = lib || [];
        setMealLibraryState(lib || []);
        setPdfUrls({en: st.brochure_en||"", cn: st.brochure_cn||""});
        try {
          const parsedBatches = st.kitchen_batches ? JSON.parse(st.kitchen_batches) : null;
          setBatchTimes(Array.isArray(parsedBatches) && parsedBatches.length ? parsedBatches : DEFAULT_BATCHES);
        } catch { setBatchTimes(DEFAULT_BATCHES); }
        setPlans(pl);
        setTiers(tiersData || []);
        setClients(cl);
        setMenu(mn);
        setCurrentWeekIndex(curWeek);
        setRotationOrder(rotOrder);
        // New schema: getMealSelections already returns {cid: {day: [slots]}}
        // Each slot has: {id, slot, mealIds, deliveryTime, snackId, snack, snackObj, note}
        // Convert to internal format used by App: {id, time, meals, snack, note}
        const converted = {};
        for (const cid of Object.keys(ms)) {
          converted[cid] = {};
          for (const day of DAYS) {
            const slots = ms[cid]?.[day] || [];
            converted[cid][day] = slots.map(s => ({
              id:     String(s.id),
              slot:   s.slot,
              time:   s.deliveryTime || "",
              cookTime: s.cookTime || "",
              meals:  s.mealIds || [],   // array of meal IDs
              snack:  s.snack || "",
              sauceIds: s.sauceIds || [],
              snackId: s.snackId || "",
              snackObj: s.snackObj || null,
              note:   s.note || "",
            }));
          }
        }
        setMeals(converted);

        const convertedPending = {};
        for (const cid of Object.keys(pendingMs)) {
          convertedPending[cid] = {};
          for (const day of DAYS) {
            const slots = pendingMs[cid]?.[day] || [];
            convertedPending[cid][day] = slots.map(s => ({
              id:     String(s.id),
              slot:   s.slot,
              time:   s.deliveryTime || "",
              meals:  s.mealIds || [],
              snack:  s.snack || "",
              sauceIds: s.sauceIds || [],
              snackId: s.snackId || "",
              snackObj: s.snackObj || null,
              note:   s.note || "",
            }));
          }
        }
        setPendingMeals(convertedPending);
        setChecks(ch);
        // Load cook times and custom items from localStorage as lightweight storage
        try {
          const ct = JSON.parse(localStorage.getItem("fi_cooktimes") || "{}");
          const ci = JSON.parse(localStorage.getItem("fi_customitems") || "[]");
          setCookTimes(ct);
          setCustomItems(ci);
        } catch {}
      } catch (e) {
        setError("Could not connect to database. Check credentials in lib/supabase.js");
        console.error(e);
      } finally {
        setLoaded(true);
      }
    })();
  // Dependemos del user id (estable), no del objeto `session` completo, a
  // proposito: onAuthChange emite un objeto `session` NUEVO en cada evento
  // interno del cliente de Supabase Auth (arranque, refresh de token, etc.)
  // aunque sea el mismo usuario logueado -- con `[session]` como
  // dependencia, React volvia a disparar las ~13 queries completas cada vez
  // que eso pasaba (confirmado: 4 veces seguidas en una sola carga de
  // pagina).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const flash = () => { setSaving(true); setTimeout(() => setSaving(false), 1800); };

  // Save cook times + custom items to localStorage when they change
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("fi_cooktimes",  JSON.stringify(cookTimes));
    localStorage.setItem("fi_customitems", JSON.stringify(customItems));
  }, [cookTimes, customItems, loaded]);

  // ── Derived
  const active   = useMemo(() => clients.filter(c=>getRealStatus(c.startDate,c.expiryDate)==="Active"), [clients]);
  const unpaid   = useMemo(() => active.filter(c=>!c.paid), [active]);
  const renewDue = useMemo(() => active.filter(c=>{ const d=daysUntil(c.expiryDate); return d>=0&&d<=1; }), [active]);
  const overdue  = useMemo(() => active.filter(c=>daysUntil(c.expiryDate)<0), [active]);
  const revenue  = useMemo(() => active.reduce((s,c)=>s+(c.planObj?.price||0),0), [active,plans]);
  const totalMl  = useMemo(() => active.reduce((s,c)=>s+(c.planObj?.meals||0),0)*5, [active,plans]);

  // Teléfonos de pedidos aprobados que siguen en Orders → Approved -- ese
  // status no se limpia solo cuando el cliente paga (nada lo actualiza), así
  // que NO alcanza con mirar new_orders.status a secas: hay que combinarlo
  // con clients.paid, que sí se actualiza en cuanto se confirma el pago
  // (ver waitForPaymentConfirmation en el mini-program). Cruzando ambos: un
  // cliente recién aprobado y sin pagar todavía queda afuera de Clients acá
  // (sigue visible en Orders → Approved mientras tanto); en cuanto paga,
  // c.paid manda y vuelve a aparecer sin importar qué pase con el pedido.
  const approvedOrderPhones = useMemo(
    () => new Set((approvedOrders||[]).map(o=>o.phone).filter(Boolean)),
    [approvedOrders]
  );

  const filtered = useMemo(() => {
    let l = clients.filter(c => c.paid || !c.phone || !approvedOrderPhones.has(c.phone));
    if (filterSt!=="all") l=l.filter(c=>clientRealStatus(c)===filterSt);
    if (search) l=l.filter(c=>
      c.name.toLowerCase().includes(search.toLowerCase())||
      (c.district||"").toLowerCase().includes(search.toLowerCase())||
      (c.planName||"").toLowerCase().includes(search.toLowerCase())
    );
    return l;
  }, [clients,filterSt,search,approvedOrderPhones,clientRealStatus]);

  // Volver a la página 1 cada vez que cambia el filtro/búsqueda -- si no,
  // se puede quedar mostrando una página vacía de un filtro anterior.
  useEffect(() => { setClientsPage(1); }, [filterSt, search]);

  const clientsTotalPages = Math.max(1, Math.ceil(filtered.length / CLIENTS_PAGE_SIZE));
  const paginatedClients = useMemo(() => {
    const start = (clientsPage - 1) * CLIENTS_PAGE_SIZE;
    return filtered.slice(start, start + CLIENTS_PAGE_SIZE);
  }, [filtered, clientsPage]);

  // Helper: resolve meal ID to name using mealLibraryRef
  const mealName = (id) => {
    if (!id) return "";
    const m = mealLibraryRef.current.find(m => m.id === id);
    return m ? m.name : id;
  };

  // Active + Upcoming clients — used by Kitchen Prep and Delivery Sheet
  const deliveryClients = useMemo(
    () => clients.filter(c => ["Active","Upcoming"].includes(clientRealStatus(c))),
    [clients, clientRealStatus]
  );

  // Kitchen: aggregate INGREDIENTS (not meal counts) needed per batch, per day.
  // Each portion is expanded into its meal_ingredients rows so kitchen staff
  // see "how much of X to prep for this batch" instead of "how many of meal Y".
  const kitchen = useMemo(() => {
    const ingredientById = {};
    ingredients.forEach(i => { ingredientById[i.id] = i; });
    const mealIngredientsByMeal = {};
    mealIngredients.forEach(mi => { (mealIngredientsByMeal[mi.meal_id] = mealIngredientsByMeal[mi.meal_id] || []).push(mi); });

    const d = {};
    DAYS.forEach(day => {
      const batches = {};
      batchTimes.forEach(b => { batches[b] = { portionCount: 0, ingGrams: {}, unassigned: new Set() }; });

      deliveryClients.filter(c => clientActiveOnDay(c, day)).forEach(c => {
        const slots = meals[c.id]?.[day] || [];
        slots.forEach(slot => {
          const batch = getBatch(slot.time || "", batchTimes);
          (slot.meals||[]).filter(id => id && id.trim() && id !== "—").forEach(rawId => {
            batches[batch].portionCount++;
            const rows = mealIngredientsByMeal[rawId];
            if (!rows || rows.length === 0) {
              batches[batch].unassigned.add(mealName(rawId) || rawId);
              return;
            }
            rows.forEach(mi => {
              batches[batch].ingGrams[mi.ingredient_id] = (batches[batch].ingGrams[mi.ingredient_id] || 0) + Number(mi.quantity_grams);
            });
          });
        });
      });

      // Convert to sorted array per batch
      d[day] = batchTimes.map(b => {
        const bd = batches[b];
        const ingredientsList = Object.entries(bd.ingGrams)
          .map(([id, grams]) => {
            const ing = ingredientById[id];
            return {
              id, grams,
              name: ing ? ing.name : id,
              category: ing ? ing.category : null,
              photoUrl: ing ? ing.photo_url : null,
              cost: ing && ing.cost_per_kg != null ? grams / 1000 * ing.cost_per_kg : null,
            };
          })
          .sort((a, bv) => bv.grams - a.grams);
        return { time: b, total: bd.portionCount, ingredients: ingredientsList, unassignedMeals: Array.from(bd.unassigned) };
      }).filter(b => b.total > 0);
    });
    return d;
  }, [deliveryClients, meals, batchTimes, ingredients, mealIngredients, mealLibraryState]);

  // Delivery: group by time, filtered by selected day
  const delivery = useMemo(() => {
    const allSlots = [];
    deliveryClients.filter(c => clientActiveOnDay(c, deliveryDay)).forEach(c => {
      (meals[c.id]?.[deliveryDay]||[]).forEach(slot => {
        allSlots.push({ client: c, day: deliveryDay, slot });
      });
    });
    allSlots.sort((a,b) => (a.slot.time||"99").localeCompare(b.slot.time||"99"));
    const g = {};
    allSlots.forEach(x => {
      const t = x.slot.time || "TBD";
      (g[t]=g[t]||[]).push(x);
    });
    return g;
  }, [deliveryClients, meals, deliveryDay, mealLibraryState]);

  // ── Handlers
  const togglePaid = async id => {
    const c = clients.find(x=>x.id===id);
    if (!c) return;
    const updated = {...c, paid:!c.paid, planId: c.planId||c.plan_id||""};
    setClients(p=>p.map(x=>x.id===id?updated:x));
    try { await upsertClient(updated); flash(); } catch(e){ console.error(e); }
  };

  const toggleCutlery = async id => {
    const c = clients.find(x=>x.id===id);
    if (!c) return;
    const updated = {...c, cutlery:!c.cutlery, planId: c.planId||c.plan_id||""};
    setClients(p=>p.map(x=>x.id===id?updated:x));
    try { await upsertClient(updated); } catch(e){ console.error(e); }
  };

  const toggleCheck = async k => {
    const next = !checks[k];
    setChecks(p=>({...p,[k]:next}));
    try { await toggleChecklistItem(k, next); } catch(e){ console.error(e); }
  };

  const deleteClientHandler = async id => {
    if (!window.confirm("Delete this client?")) return;
    const prev = clients;
    setClients(p=>p.filter(c=>c.id!==id));
    try {
      await dbDeleteClient(id);
      flash();
    } catch(e) {
      console.error(e);
      setClients(prev); // el DELETE falló -- revertir el borrado optimista, si no
      alert(`Could not delete client: ${e.message||e}`); // el cliente reaparece solo al recargar y parece que "no se actualiza"
    }
  };

  const navTo = t => { setTab(t); setSbOpen(false); };

  // ── Meal slot handlers
  const addSlot = async (clientId, day) => {
    const existingSlots = meals[clientId]?.[day] || [];
    const nextSlot = existingSlots.length + 1;
    const newSlot = { id: uid(), slot: nextSlot, time: "", cookTime: "", meals: [], snack: "", snackId: "", sauceIds: [], note: "" };
    setMeals(p => ({
      ...p,
      [clientId]: { ...p[clientId], [day]: [...(p[clientId]?.[day]||[]), newSlot] }
    }));
    try {
      await upsertMealSelection(clientId, day, nextSlot, { mealIds:[], deliveryTime:"", cookTime:"", snackId:null, note:"" });
    } catch(e){ console.error(e); }
  };

  const removeSlot = async (clientId, day, slotId) => {
    const slot = meals[clientId]?.[day]?.find(s=>s.id===slotId);
    setMeals(p => ({
      ...p,
      [clientId]: { ...p[clientId], [day]: (p[clientId]?.[day]||[]).filter(s=>s.id!==slotId) }
    }));
    if (slot?.slot) {
      try {
        const {deleteMealSelection} = await import("./lib/supabase");
        await deleteMealSelection(clientId, day, slot.slot);
      } catch(e){ console.error(e); }
    }
  };

  const updateSlot = async (clientId, day, slotId, field, value) => {
    const updated = (meals[clientId]?.[day]||[]).map(s =>
      s.id === slotId ? {...s, [field]: value} : s
    );
    setMeals(p => ({ ...p, [clientId]: { ...p[clientId], [day]: updated } }));
    const slot = updated.find(s=>s.id===slotId);
    if (!slot) return;
    try {
      await upsertMealSelection(clientId, day, slot.slot||1, {
        mealIds:      slot.meals    || [],
        deliveryTime: slot.time     || "",
        cookTime:     slot.cookTime || "",
        snackId:      slot.snackId  || null,
        note:         slot.note     || "",
        sauceIds:     slot.sauceIds || [],
      });
      flash();
    } catch(e){ console.error(e); }
  };

  const updateSlotMeal = async (clientId, day, slotId, mealIndex, value) => {
    const updated = (meals[clientId]?.[day]||[]).map(s => {
      if (s.id !== slotId) return s;
      const newMeals = [...(s.meals||[])];
      newMeals[mealIndex] = value;
      return {...s, meals: newMeals};
    });
    setMeals(p => ({ ...p, [clientId]: { ...p[clientId], [day]: updated } }));
    const slot = updated.find(s=>s.id===slotId);
    if (!slot) return;
    try {
      await upsertMealSelection(clientId, day, slot.slot||1, {
        mealIds:      slot.meals    || [],
        deliveryTime: slot.time     || "",
        cookTime:     slot.cookTime || "",
        snackId:      slot.snackId  || null,
        note:         slot.note     || "",
        sauceIds:     slot.sauceIds || [],
      });
      flash();
    } catch(e){ console.error(e); }
  };

  const addMealToSlot = (clientId, day, slotId) => {
    setMeals(p => {
      const slots = (p[clientId]?.[day]||[]).map(s =>
        s.id === slotId ? {...s, meals: [...(s.meals||[]), ""]} : s
      );
      return { ...p, [clientId]: { ...p[clientId], [day]: slots } };
    });
  };

  const removeMealFromSlot = (clientId, day, slotId, mealIndex) => {
    setMeals(p => {
      const slots = (p[clientId]?.[day]||[]).map(s => {
        if (s.id !== slotId) return s;
        const newMeals = (s.meals||[]).filter((_,i)=>i!==mealIndex);
        return {...s, meals: newMeals.length ? newMeals : [""]};
      });
      return { ...p, [clientId]: { ...p[clientId], [day]: slots } };
    });
  };

  // ── Client modal
  const openAddClient  = () => { setEditClientId(null); setClientForm({...BLANK_CLIENT,startDate:todayIso()}); setShowClientModal(true); };
  const openEditClient = c  => { setEditClientId(c.id); setClientForm({...c}); setShowClientModal(true); };
  const cfld = (k,v) => setClientForm(p=>({...p,[k]:v}));

  const saveClient = async () => {
    if (!clientForm.name.trim()) return;
    try {
      // Ensure planId is set correctly (clientForm might have plan as object from spread)
      const formToSave = {
        ...clientForm,
        planId: clientForm.planId || (typeof clientForm.plan === "object" ? clientForm.plan?.id : "") || "",
      };
      const rawSaved = await upsertClient(formToSave);
      // Find the plan object from our local plans list
      const savedPlanObj = plans.find(p => p.id === formToSave.planId) || formToSave.planObj || null;
      const saved = {
        ...rawSaved,
        plan:         savedPlanObj?.name       || formToSave.planName || "",
        planId:       rawSaved.plan_id         || formToSave.planId   || "",
        planName:     savedPlanObj?.name       || formToSave.planName || "",
        planObj:      savedPlanObj,
        startDate:    rawSaved.start_date      || "",
        expiryDate:   rawSaved.expiry_date     || "",
        deliveryTime: rawSaved.delivery_time   || "",
        deliveryFee:  rawSaved.delivery_fee    ?? null,
        amountPaid:   rawSaved.amount_paid     || 0,
        acqChannel:   rawSaved.acq_channel     || "",
        wechatOpenid: rawSaved.wechat_openid   || "",
        statusNote:   rawSaved.status_note     || "",
      };
      if (editClientId) {
        const prev = clients.find(c=>c.id===editClientId);
        if (prev && clientForm.expiryDate && prev.expiryDate !== clientForm.expiryDate) {
          incrementRenewalCount(editClientId).catch(()=>{});
          saved.renewalCount = (prev.renewalCount||0) + 1;
        }
        setClients(p=>p.map(c=>c.id===editClientId?saved:c));
      } else {
        setClients(p=>[...p,saved]);
        const defaultMeals = {};
        for (const day of DAYS) {
          defaultMeals[day] = [];
          // No need to pre-create rows — slots are created on demand
        }
        setMeals(p=>({...p,[saved.id]:defaultMeals}));
      }
      setShowClientModal(false);
      flash();
    } catch(e){ console.error(e); }
  };

  // ── Plan modal
  const openAddPlan  = () => { setEditPlanId(null); setPlanForm({...BLANK_PLAN,id:uid(), tier_id: selectedTierId||""}); setShowPlanModal(true); };
  const openEditPlan = p  => { setEditPlanId(p.id); setPlanForm({...p}); setShowPlanModal(true); };
  const pfld = (k,v) => setPlanForm(p=>({...p,[k]:v}));

  const savePlan = async () => {
    if (!planForm.name.trim()) return;
    try {
      const tierObj = tiers.find(t => t.id === planForm.tier_id);
      const payload = {
        ...planForm,
        tier: tierObj?.name || planForm.tier || "",
        tier_zh: tierObj?.name_zh || planForm.tier_zh || null,
      };
      const saved = await upsertPlan(payload);
      if (editPlanId) setPlans(p=>p.map(x=>x.id===editPlanId?saved:x));
      else setPlans(p=>[...p,saved]);
      setShowPlanModal(false); flash();
    } catch(e){ console.error(e); }
  };

  const deletePlanHandler = async id => {
    if (!window.confirm("Delete this plan?")) return;
    setPlans(p=>p.filter(x=>x.id!==id));
    try {
      await dbDeletePlan(id);
      flash();
    } catch(e) {
      console.error(e);
      // Revert if delete failed (e.g. clients using this plan)
      const restored = await getPlans();
      setPlans(restored||[]);
      alert("Cannot delete — clients are assigned to this plan. Reassign them first.");
    }
  };

  // ── Tier handlers
  const openAddTier  = () => { setEditTierId(null); setTierForm({name:"", name_zh:"", color:"#38BDF8"}); setShowTierModal(true); };
  const openEditTier = t  => { setEditTierId(t.id); setTierForm({name:t.name, name_zh:t.name_zh||"", color:t.color||"#38BDF8"}); setShowTierModal(true); };
  const tfld = (k,v) => setTierForm(p=>({...p,[k]:v}));

  const saveTier = async () => {
    if (!tierForm.name.trim()) return;
    try {
      const payload = editTierId ? {id:editTierId, ...tierForm} : {...tierForm};
      // If renaming, cascade update to meal_library before saving tier
      if (editTierId) {
        const oldTier = tiers.find(t => t.id === editTierId);
        if (oldTier && oldTier.name !== tierForm.name) {
          const { renameMealLibraryTier } = await import("./lib/supabase");
          await renameMealLibraryTier(oldTier.name, tierForm.name);
          // Update local mealLibraryState too
          setMealLibraryState(p => p.map(m => m.tier === oldTier.name ? {...m, tier: tierForm.name} : m));
        }
      }
      const saved = await upsertTier(payload);
      if (editTierId) setTiers(p=>p.map(x=>x.id===editTierId?saved:x));
      else setTiers(p=>[...p,saved]);
      setShowTierModal(false); flash();
    } catch(e){ console.error(e); }
  };

  const deleteTierHandler = async id => {
    const inUse = plans.some(p => p.tier_id === id);
    if (inUse) { alert("Cannot delete — plans are assigned to this tier. Remove them first."); return; }
    if (!window.confirm("Delete this tier?")) return;
    const tierObj = tiers.find(t => t.id === id);
    setTiers(p=>p.filter(x=>x.id!==id));
    try {
      await dbDeleteTier(id);
      // Clear tier name from meal_library and menu rows that referenced this tier
      if (tierObj?.name) {
        const { renameMealLibraryTier } = await import("./lib/supabase");
        await renameMealLibraryTier(tierObj.name, "");
        setMealLibraryState(p => p.map(m => m.tier === tierObj.name ? {...m, tier: ""} : m));
      }
      flash();
    }
    catch(e){ console.error(e); const restored = await getTiers(); setTiers(restored||[]); }
  };

  // ── Menu modal
  const saveMenu = async () => {
    try {
      // Look up IDs from meal names in library
      const lib = mealLibraryRef.current;
      const mealIds = menuForm.meals.filter(Boolean).map(name => {
        const found = lib.find(m=>m.name===name);
        return found ? found.id : null;
      }).filter(Boolean);
      const snackObj = lib.find(m=>m.name===menuForm.snack);
      await updateMenuDay(menuEditDay, {
        mealIds,
        snackId: snackObj?.id || "",
      });
      const mealObjs = mealIds.map(id=>lib.find(m=>m.id===id)).filter(Boolean);
      setMenu(p=>({...p,[menuEditDay]:{
        meals:mealObjs, mealIds,
        snack:snackObj?.name||"", snackId:snackObj?.id||"", snackObj:snackObj||null
      }}));
      setShowMenuModal(false); flash();
    } catch(e){ console.error(e); }
  };

  const upsertMenuDay = async (day, tier, weekIndex, {mealIds, snackId}) => {
    try {
      await updateMenuDay(day, tier, weekIndex, {mealIds, snackId});
      const lib = mealLibraryRef.current;
      const mealObjs = mealIds.map(id => lib.find(m=>m.id===id)).filter(Boolean);
      const snackObj = lib.find(m=>m.id===snackId) || null;
      setMenu(p=>({
        ...p,
        [weekIndex]: {
          ...p[weekIndex],
          [tier]: {
            ...p[weekIndex]?.[tier],
            [day]: {
              meals:   mealObjs,
              mealIds,
              snack:   snackObj?.name || "",
              snackId: snackId||"",
              snackObj,
            }
          }
        }
      }));
      flash();
    } catch(e){ console.error(e); }
  };

  const saveRotationOrder = async (order) => {
    try {
      await setMenuRotationOrder(order);
      setRotationOrder(order);
      const newWeek = await getCurrentWeekIndex();
      setCurrentWeekIndex(newWeek);
      flash();
    } catch(e){ console.error(e); }
  };

  // ── Print / Save as PDF delivery sheet (supports Chinese characters)
  // Hora de cocina: 1h antes de la hora de entrega, para que la cocina sepa
  // cuándo tiene que tener listo cada pedido. Si el horario no está definido
  // (slot "TBD"), no hay nada que restarle.
  const cookingTimeFor = (timeStr) => {
    if (!timeStr || timeStr === "TBD") return "TBD";
    const [h, m] = timeStr.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return "TBD";
    const hh = (h - 1 + 24) % 24;
    return String(hh).padStart(2,"0") + ":" + String(m).padStart(2,"0");
  };

  const printDelivery = () => {
    const dayName = deliveryDay;
    const dateStr = new Date().toLocaleDateString("en-GB");
    const rows = Object.entries(delivery).flatMap(([time, slots]) =>
      slots.map(({client:c, slot}, i) => ({
        num: i+1,
        time,
        cookTime: slot.cookTime || cookingTimeFor(time),
        name: c.name,
        phone: c.phone || "",
        plan: c.planName,
        address: c.address || "TBC",
        access: c.access || "—",
        meals: (slot.meals||[]).filter(Boolean).map((id,mi) => ({
          name:  mealName(id) || id,
          sauce: (slot.sauceIds||[])[mi] ? mealName((slot.sauceIds||[])[mi]) : "",
        })),
        snack: slot.snackId ? mealName(slot.snackId) : slot.snack || "—",
        note: slot.note || c.customizations || "—",
        allergies: c.allergies || "",
        cutlery: c.cutlery || false,
      }))
    );

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Delivery Sheet — ${dayName}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, 'Microsoft YaHei', sans-serif; font-size: 10px; margin: 0; color: #111; }

    /* ── Header ── */
    .page-header { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; border-bottom: 3px solid #e8342a; padding-bottom: 7px; }
    .page-header h1 { font-size: 17px; font-weight: 900; margin: 0; letter-spacing: .5px; white-space: nowrap; }
    .page-header h1 span { color: #e8342a; }
    .page-header .meta { font-size: 10px; color: #555; white-space: nowrap; }
    .page-header .stops { margin-left: auto; background: #e8342a; color: #fff; font-weight: 700; font-size: 11px; padding: 3px 10px; border-radius: 4px; white-space: nowrap; }

    /* ── Table ── */
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    col.cn  { width: 3%; }
    col.ct  { width: 6%; }
    col.cct { width: 8%; }
    col.cc  { width: 13%; }
    col.ca  { width: 16%; }
    col.cm  { width: 26%; }
    col.cs  { width: 10%; }
    col.cno { width: 18%; }
    col.ccut{ width: 6%; }
    col.ck  { width: 4%; }

    thead tr { background: #1a1a1a; }
    th { color: #fff; padding: 6px 5px; text-align: left; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; white-space: normal; line-height: 1.25; }

    tbody tr:nth-child(odd)  td { background: #ffffff; }
    tbody tr:nth-child(even) td { background: #f0f2f5; }
    tbody tr { page-break-inside: avoid; }

    td { padding: 8px 7px; border-bottom: 1px solid #dde1e8; vertical-align: top; word-wrap: break-word; line-height: 1.35; }

    /* ── Cell styles ── */
    .cn-num  { font-weight: 900; font-size: 14px; color: #bbb; text-align: center; vertical-align: middle; }
    .ct-time { font-weight: 800; font-size: 12px; color: #e8342a; white-space: nowrap; vertical-align: middle; }
    .cct-time { font-weight: 800; font-size: 12px; color: #b45309; white-space: nowrap; vertical-align: middle; }
    .cc-name { font-weight: 800; font-size: 11.5px; }
    .cc-phone { font-size: 9.5px; color: #444; margin-top: 2px; font-weight: 600; }
    .cc-plan { font-size: 9px; color: #777; margin-top: 2px; }
    .ca-addr { font-size: 10.5px; font-weight: 600; }
    .ca-acc  { font-size: 9.5px; color: #444; margin-top: 3px; font-style: italic; font-weight: 600; }
    .meal-row { display: flex; align-items: baseline; gap: 4px; margin-bottom: 3px; }
    .meal-row:last-child { margin-bottom: 0; }
    .meal-bullet { color: #e8342a; font-weight: 900; font-size: 11px; line-height: 1; flex-shrink: 0; }
    .meal-name { font-weight: 700; font-size: 10.5px; }
    .meal-sauce { font-size: 9px; color: #999; font-style: italic; }
    .snack-val { font-size: 10.5px; font-weight: 600; }
    .note-block { font-size: 10px; }
    .note-text { color: #92400e; font-weight: 700; }
    .allergy-text { color: #b91c1c; font-weight: 800; font-size: 10px; margin-top: 3px; }
    .allergy-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #b91c1c; opacity: .8; }
    .dash { color: #ccc; }
    .check-box { width: 16px; height: 16px; border: 2px solid #bbb; display: block; margin: auto; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>FIT <span>IGNYTE</span> — Delivery Sheet</h1>
    <div class="meta">${dayName} &nbsp;·&nbsp; ${dateStr}</div>
    <div class="stops">${rows.length} stop${rows.length!==1?"s":""}</div>
  </div>
  <table>
    <colgroup>
      <col class="cn"><col class="ct"><col class="cct"><col class="cc"><col class="ca">
      <col class="cm"><col class="cno"><col class="ccut"><col class="ck">
    </colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th>Time</th>
        <th>Cooking Time</th>
        <th>Client</th>
        <th>Address &amp; Access</th>
        <th>Meals</th>
        <th>Notes &amp; Allergies</th>
        <th>Cutlery</th>
        <th>✓</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((r,i) => {
        const hasMeals   = r.meals && r.meals.length > 0;
        const hasNote    = r.note && r.note !== "—";
        const hasAllergy = r.allergies && r.allergies.trim();
        const noteHtml    = hasNote    ? "<div class=\"note-text\">" + r.note + "</div>" : "";
        const allergyHtml = hasAllergy ? "<div class=\"allergy-label\">&#9888; Allergies</div><div class=\"allergy-text\">" + r.allergies + "</div>" : "";
        const notesCell   = (hasNote || hasAllergy) ? "<div class=\"note-block\">" + noteHtml + allergyHtml + "</div>" : "<span class=\"dash\">&mdash;</span>";
        const accessHtml  = (r.access && r.access !== "—") ? "<div class=\"ca-acc\">" + r.access + "</div>" : "";
        const mealsHtml   = hasMeals
          ? r.meals.map(m =>
              "<div class=\"meal-row\">" +
                "<span class=\"meal-bullet\">&bull;</span>" +
                "<div>" +
                  "<span class=\"meal-name\">" + (m.name||m) + "</span>" +
                "</div>" +
              "</div>"
            ).join("")
          : "<span class=\"dash\">&mdash;</span>";
        return "<tr>" +
          "<td class=\"cn-num\">" + (i+1) + "</td>" +
          "<td class=\"ct-time\">" + r.time + "</td>" +
          "<td class=\"cct-time\">" + r.cookTime + "</td>" +
          "<td><div class=\"cc-name\">" + r.name + "</div>" + (r.phone ? "<div class=\"cc-phone\">" + r.phone + "</div>" : "") + "<div class=\"cc-plan\">" + r.plan + "</div></td>" +
          "<td><div class=\"ca-addr\">" + r.address + "</div>" + accessHtml + "</td>" +
          "<td>" + mealsHtml + "</td>" +
          "<td>" + notesCell + "</td>" +
          "<td style=\"text-align:center;font-weight:600;font-size:10px\">" + (r.cutlery ? "Yes" : "No") + "</td>" +
          "<td style=\"text-align:center\"><span class=\"check-box\"></span></td>" +
          "</tr>";
      }).join("")}
    </tbody>
  </table>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  // ── Print Kitchen Prep sheet
  const printKitchen = async () => {
    const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
    const dayName = kitDay;
    const dateStr = new Date().toLocaleDateString("en-GB");
    const batches = kitchen[kitDay] || [];
    const totalPortions = batches.reduce((s,b)=>s+b.total,0);

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210;
    let y = 0;

    // Header
    doc.setFillColor(232, 52, 42);
    doc.rect(0, 0, W, 18, "F");
    doc.setTextColor(255,255,255);
    doc.setFontSize(14); doc.setFont("helvetica","bold");
    doc.text("FIT IGNYTE — Kitchen Prep (Ingredients)", 10, 12);
    doc.setFontSize(9); doc.setFont("helvetica","normal");
    doc.text(dayName + "  |  " + dateStr + "  |  " + totalPortions + " portions  |  " + batches.length + " batches", 10, 17);
    y = 24;

    // Batches
    batches.forEach(batch => {
      if (y > 270) { doc.addPage(); y = 10; }
      // Batch header
      doc.setFillColor(232,52,42);
      doc.rect(0, y, W, 8, "F");
      doc.setTextColor(255,255,255);
      doc.setFontSize(10); doc.setFont("helvetica","bold");
      doc.text("BATCH " + batch.time, 10, y+5.5);
      doc.text(batch.total + " portion" + (batch.total!==1?"s":""), W-10, y+5.5, {align:"right"});
      y += 8;

      if (batch.unassignedMeals.length) {
        doc.setFillColor(255,251,235); doc.rect(0,y,W,7,"F");
        doc.setTextColor(180,130,0); doc.setFontSize(7); doc.setFont("helvetica","italic");
        doc.text(doc.splitTextToSize("No ingredients assigned yet: " + batch.unassignedMeals.join(", "), W-16)[0], 8, y+4.5);
        y += 7;
      }

      batch.ingredients.forEach((ing,i) => {
        if (y > 275) { doc.addPage(); y = 10; }
        const rowH = 8;
        if (i%2===0) { doc.setFillColor(245,245,245); doc.rect(0,y,W,rowH,"F"); }
        // Ingredient name
        doc.setTextColor(20,20,20);
        doc.setFontSize(9); doc.setFont("helvetica","normal");
        doc.text(doc.splitTextToSize(ing.name, 140)[0], 10, y+5.5);
        // Quantity
        doc.setFont("helvetica","bold");
        doc.text(fmtQty(ing.grams, ing.category), W-10, y+5.5, {align:"right"});
        y += rowH;
      });
      y += 4;
    });

    doc.save("kitchen-" + dayName.toLowerCase() + ".pdf");
  };



  const nowStr = TODAY.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});

  if (session === undefined) return (
    <>
      <style>{G}</style>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0a0a0a",color:"#666",fontFamily:"'DM Sans',sans-serif",gap:10}}>
        <span style={{color:"#E8342A",fontFamily:"'Rajdhani',sans-serif",fontSize:18,fontWeight:700}}>FIT IGNYTE</span> Loading…
      </div>
    </>
  );

  if (!session) return <LoginScreen onLogin={setSession}/>;

  if (!loaded) return (
    <>
      <style>{G}</style>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0a0a0a",color:"#666",fontFamily:"'DM Sans',sans-serif",gap:10}}>
        <span style={{color:"#E8342A",fontFamily:"'Rajdhani',sans-serif",fontSize:18,fontWeight:700}}>FIT IGNYTE</span> Loading…
      </div>
    </>
  );

  return (
    <>
      <style>{G}</style>
      {saving && <div className="saving">✓ Saved</div>}
      <button className="hamburger" onClick={()=>setSbOpen(v=>!v)}>☰</button>
      <div className={`sb-overlay${sbOpen?" open":""}`} onClick={()=>setSbOpen(false)}/>

      <div className="app">
        {/* ── SIDEBAR ── */}
        <div className={`sb${sbOpen?" open":""}`}>
          <div className="sb-logo">
            <div className="sb-brand"><span>FIT</span> IGNYTE</div>
            <div className="sb-sub">Operations System</div>
          </div>
          <div className="sb-week">
            <div className="sb-week-lbl">Today</div>
            <div className="sb-week-val">{nowStr}</div>
          </div>
          <nav className="nav">
            {[
              {id:"dashboard",ic:"⚡",lbl:"Dashboard"},
              {id:"clients",  ic:"👥",lbl:"Clients",        badge:active.length||null},
              {id:"meals",    ic:"🍱",lbl:"Meal Selections"},
              {id:"kitchen",  ic:"👨‍🍳",lbl:"Kitchen Prep"},
              {id:"delivery", ic:"🛵",lbl:"Delivery Sheet"},
              {id:"orders",   ic:"📦",lbl:"Orders",         badge:(pendingOrders.length+pendingAddrChanges.length)||null},
              {id:"referrals",    ic:"🤝",lbl:"Referrals"},
              {id:"notifications",ic:"🔔",lbl:"Notifications"},
              {id:"plans",    ic:"🗂️", lbl:"Plans"},
              {id:"menu",     ic:"📋",lbl:"Menu Reference"},
              {id:"mealstats",ic:"📊",lbl:"Meal Stats"},
              {id:"ingredients",ic:"🥕",lbl:"Ingredients"},
              {id:"accounting",ic:"💰",lbl:"Accounting"},
            ].map(n=>(
              <button key={n.id} className={`ni${tab===n.id?" on":""}`} onClick={()=>navTo(n.id)}>
                <span className="ni-ic">{n.ic}</span>{n.lbl}
                {n.badge?<span className="ni-badge">{n.badge}</span>:null}
              </button>
            ))}
          </nav>
          <div className="sb-footer">
            <div className="sb-stat">Active clients: <strong>{active.length}</strong></div>
            <button className="btn btn-g" style={{width:"100%",marginTop:14,padding:"11px 0",fontSize:13}} onClick={async()=>{await signOut(); setSession(null);}}>Log Out</button>
          </div>
        </div>

        {/* ── MAIN ── */}
        <div className="main">
          <div className="topbar">
            <div className="tb-title">
              {{dashboard:"Operations Dashboard",clients:"Client Master List",meals:"Weekly Meal Selections",kitchen:"Kitchen Prep Summary",delivery:"Delivery Sheet",orders:"Orders",notifications:"Notifications",plans:"Plans",menu:"Menu Reference",mealstats:"Meal Stats",ingredients:"Ingredients & Costs",accounting:"Accounting"}[tab]}
            </div>
            <div className="tb-right">
              {tab==="clients"&&<>
                <input className="srch" placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}/>
                <select className="fltr" value={filterSt} onChange={e=>setFilterSt(e.target.value)}>
                  <option value="all">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Upcoming">Upcoming</option>
                  <option value="Inactive">Inactive</option>
                </select>
                <button className="btn btn-r" onClick={openAddClient}>+ New Client</button>
              </>}
              {tab==="meals"&&<>
                <button className="btn btn-g btn-sm" onClick={()=>setShowCustomItemModal(true)}>+ Custom Meal</button>
              </>}
              {tab==="plans"&&selectedTierId&&<button className="btn btn-g" onClick={()=>setSelectedTierId(null)}>&#8592; Back</button>}
              {tab==="plans"&&!selectedTierId&&<button className="btn btn-r" onClick={openAddTier}>+ New Tier</button>}
              {tab==="plans"&&selectedTierId&&<button className="btn btn-r" onClick={openAddPlan}>+ New Plan</button>}
              {tab==="kitchen"&&(
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <div className="tabs" style={{margin:0,border:"none",paddingBottom:0}}>
                    {DAYS.map(d=><button key={d} className={`tab${kitDay===d?" on":""}`} onClick={()=>setKitDay(d)}>{d.slice(0,3)}</button>)}
                  </div>
                  <button className="btn btn-g btn-sm" onClick={openBatchEditor}>✎ Edit Batches</button>
                </div>
              )}
              {tab==="delivery"&&(
                <div className="tabs" style={{margin:0,border:"none",paddingBottom:0}}>
                  {DAYS.map(d=><button key={d} className={`tab${deliveryDay===d?" on":""}`} onClick={()=>setDeliveryDay(d)}>{d.slice(0,3)}</button>)}
                </div>
              )}
            </div>
          </div>

          <div className="content">
            {error&&<div className="alert-bar" style={{marginBottom:16}}>⚠️ {error}</div>}

            {/* ═══ DASHBOARD ══════════════════════════ */}
            {tab==="dashboard"&&<>
              {pushSupported&&!pushEnabled&&(
                <div className="alert-bar" style={{background:"#0a1020",borderColor:"#1e3a5f",color:"#93c5fd",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                  <span>🔔 Get notified on this phone when a new order comes in.</span>
                  <button className="btn btn-r btn-sm" disabled={pushBusy} onClick={enablePush}>{pushBusy?"Working…":"Enable"}</button>
                </div>
              )}
              {pushSupported&&pushEnabled&&(
                <div className="alert-bar" style={{background:"#0a1f14",borderColor:"#1e5f3a",color:"#86efac",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                  <span>🔔 Order notifications are on for this device.</span>
                  <button className="btn btn-g btn-sm" disabled={pushBusy} onClick={disablePush}>{pushBusy?"Working…":"Disable"}</button>
                </div>
              )}
              {(overdue.length||unpaid.length)?<div className="alert-bar">⚠️&nbsp;
                {overdue.length>0&&<strong>{overdue.length} overdue: {overdue.map(c=>c.name.split(" ")[0]).join(", ")}</strong>}
                {overdue.length>0&&unpaid.length>0&&<span style={{margin:"0 8px"}}>·</span>}
                {unpaid.length>0&&<strong>{unpaid.length} unpaid: {unpaid.map(c=>c.name.split(" ")[0]).join(", ")}</strong>}
              </div>:null}
              <div className="kpis">
                {[
                  {lbl:"Active Clients", val:active.length,  sub:`${clients.filter(c=>getRealStatus(c.startDate,c.expiryDate)!=="Active").length} not active`, c:"var(--red)"},
                  {lbl:"Weekly Revenue", val:`¥${revenue}`,  sub:"this week",                                                  c:"var(--green)"},
                  {lbl:"Unpaid",         val:unpaid.length,  sub:unpaid.length?"Follow up":"All paid ✓",                      c:unpaid.length?"var(--amber)":"var(--green)"},
                  {lbl:"Renewals ≤1d",   val:renewDue.length+overdue.length, sub:"includes overdue",                          c:"var(--amber)"},
                  {lbl:"Meals / Week",   val:totalMl,        sub:"total portions",                                             c:"var(--blue)"},
                  {lbl:"Deliveries/Wk",  val:active.reduce((s,c)=>s+c.deliveries,0)*5, sub:"Mon–Fri",                         c:"#a78bfa"},
                ].map((k,i)=>(
                  <div className="kpi" key={i} style={{"--kc":k.c}}>
                    <div className="kpi-lbl">{k.lbl}</div>
                    <div className="kpi-val">{k.val}</div>
                    <div className="kpi-sub">{k.sub}</div>
                  </div>
                ))}
              </div>
              <div className="grid2">
                <div className="tbl-wrap">
                  <div className="panel-hd"><div className="panel-title">Active Clients This Week</div></div>
                  {active.length===0?(
                    <div className="empty-state"><div className="empty-state-icon">👥</div><div className="empty-state-title">No active clients</div><div className="empty-state-sub">Add your first client in the Clients tab</div></div>
                  ):(
                    <div style={{maxHeight:400,overflowY:"auto"}}>
                    <table><thead style={{position:"sticky",top:0,background:"var(--s2)",zIndex:1}}><tr><th>Client</th><th>Plan</th><th>Paid</th><th>Renewal</th></tr></thead>
                    <tbody>{active.map(c=>(
                      <tr key={c.id}>
                        <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                        <td><PlanBadge planName={c.planName} plans={plans}/></td>
                        <td><button className={`bx bx-clk ${c.paid?"bx-g":"bx-r"}`} onClick={()=>togglePaid(c.id)}>{c.paid?"✓ Paid":"Unpaid"}</button></td>
                        <td><RenewalBadge c={c}/></td>
                      </tr>
                    ))}</tbody></table>
                    </div>
                  )}
                </div>
                <div className="panel" style={{padding:14}}>
                  <div className="sec-title" style={{marginBottom:12}}>Plan Distribution</div>
                  {plans.map(pd=>{
                    const cnt=active.filter(c=>c.planName===pd.name).length;
                    if(!cnt) return null;
                    const pct=Math.round((cnt/active.length)*100);
                    return (
                      <div key={pd.id} style={{marginBottom:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                          <span style={{color:pd.color,fontWeight:600}}>{pd.name}</span>
                          <span style={{color:"var(--dim)"}}>{cnt} · ¥{pd.price}/wk · {pct}%</span>
                        </div>
                        <div className="pb"><div className="pb-f" style={{width:pct+"%",background:pd.color}}/></div>
                      </div>
                    );
                  })}
                  {active.length===0&&<div style={{color:"var(--dim)",fontSize:11}}>No active clients yet</div>}
                  <div style={{borderTop:"1px solid var(--bdr)",paddingTop:12,marginTop:4,fontSize:11,color:"var(--muted)"}}>
                    Total LTV: <strong style={{color:"var(--amber)"}}>¥{clients.reduce((s,c)=>s+(c.ltv||0),0)}</strong>
                  </div>
                </div>
              </div>

              {/* PDF Brochures */}
              <div className="sec-title" style={{marginTop:20}}>📄 Brochures</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                {[["en","FIT IGNYTE — English","🇬🇧"],["cn","FIT IGNYTE — 中文","🇨🇳"]].map(([lang,label,flag])=>(
                  <div key={lang} style={{background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:10,padding:16}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#fff",marginBottom:4}}>{flag} {label}</div>
                    <div style={{fontSize:10,color:"var(--muted)",marginBottom:12}}>
                      {pdfUrls[lang] ? "✅ Uploaded" : "No PDF uploaded yet"}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <label style={{flex:1}}>
                        <input type="file" accept="application/pdf" style={{display:"none"}}
                          onChange={async e=>{
                            const file = e.target.files?.[0];
                            if(!file) return;
                            setPdfUploading(p=>({...p,[lang]:true}));
                            try {
                              const {uploadDocument} = await import("./lib/supabase");
                              const url = await uploadDocument(file, `brochure-${lang}.pdf`);
                              const {upsertSetting} = await import("./lib/supabase");
                              await upsertSetting(`brochure_${lang}`, url);
                              setPdfUrls(p=>({...p,[lang]:url}));
                              flash();
                            } catch(err){ console.error(err); alert("Upload failed"); }
                            setPdfUploading(p=>({...p,[lang]:false}));
                          }}
                        />
                        <span className="btn btn-g btn-sm" style={{display:"block",textAlign:"center",cursor:"pointer"}}>
                          {pdfUploading[lang] ? "⏳ Uploading..." : "⬆ Upload PDF"}
                        </span>
                      </label>
                      {pdfUrls[lang]&&(
                        <a href={pdfUrls[lang]} target="_blank" rel="noreferrer"
                          className="btn btn-r btn-sm" style={{textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>
                          ⬇ Download
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>}

            {/* ═══ CLIENTS ════════════════════════════ */}
            {tab==="clients"&&(
              filtered.length===0?(
                <div className="empty-state">
                  <div className="empty-state-icon">👥</div>
                  <div className="empty-state-title">{clients.length===0?"No clients yet":"No results"}</div>
                  <div className="empty-state-sub">{clients.length===0?"Click + New Client to add the first one":"Try a different search"}</div>
                </div>
              ):(
                <div className="tbl-wrap"><table style={{width:"100%"}}>
                  <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Plan</th><th>¥/Wk</th><th>Delivery Fee</th><th>Status</th><th>Expiry</th><th>Renewals</th><th>Paid</th><th>LTV</th><th>Actions</th></tr></thead>
                  <tbody>{paginatedClients.map(c=>(
                    <tr key={c.id}>
                      <td style={{color:"var(--dim)",fontSize:10}}>{c.id}</td>
                      <td style={{color:"#fff",fontWeight:500,whiteSpace:"nowrap"}}>{c.name}</td>
                      <td style={{color:"var(--muted)"}}>{c.phone||"—"}</td>
                      <td><PlanBadge planName={c.planName} plans={plans}/></td>
                      <td style={{color:"var(--green)"}}>¥{plans.find(p=>p.name===c.planName)?.price||0}</td>
                      <td style={{color:"var(--muted)"}}>¥{c.deliveryFee ?? 35}</td>
                      <td>{(()=>{
                        const rs = clientRealStatus(c);
                        if (rs === "Active")   return <span className="bx bx-g">Active</span>;
                        if (rs === "Upcoming") return <span className="bx bx-a">Upcoming</span>;
                        return <span className="bx bx-gr">Inactive</span>;
                      })()}</td>
                      <td><RenewalBadge c={c}/></td>
                      <td style={{textAlign:"center"}}><span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,fontWeight:700,color:c.renewalCount>0?"var(--green)":"var(--dim)"}}>{c.renewalCount||0}</span></td>
                      <td><button className={`bx bx-clk ${c.paid?"bx-g":"bx-r"}`} onClick={()=>togglePaid(c.id)}>{c.paid?"✓":"Unpaid"}</button></td>
                      <td style={{color:"var(--amber)"}}>¥{c.ltv}</td>
                      <td style={{display:"flex",gap:5}}>
                        <button className="btn btn-g btn-xs" onClick={()=>openEditClient(c)}>Edit</button>
                        <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>deleteClientHandler(c.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )
            )}
            {tab==="clients"&&filtered.length>0&&(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:12,marginBottom:24}}>
                <div style={{fontSize:11,color:"var(--muted)"}}>
                  Showing {(clientsPage-1)*CLIENTS_PAGE_SIZE+1}–{Math.min(clientsPage*CLIENTS_PAGE_SIZE,filtered.length)} of {filtered.length}
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <button className="btn btn-g btn-sm" disabled={clientsPage<=1} onClick={()=>setClientsPage(p=>p-1)}>&#8592; Prev</button>
                  <span style={{fontSize:11,color:"var(--muted)"}}>Page {clientsPage} / {clientsTotalPages}</span>
                  <button className="btn btn-g btn-sm" disabled={clientsPage>=clientsTotalPages} onClick={()=>setClientsPage(p=>p+1)}>Next &#8594;</button>
                </div>
              </div>
            )}

            {/* ═══ MEALS ══════════════════════════════ */}
            {tab==="meals"&&<>
              <div className="alert-bar" style={{background:"#0a1020",borderColor:"#1e3a5f",color:"#93c5fd"}}>
                💡 Each client can have multiple delivery slots per day. Use <strong>+ Add Slot</strong> for clients with 2 deliveries in one day.
              </div>
              <div className="tabs">
                {DAYS.map(d=><button key={d} className={`tab${mealDay===d?" on":""}`} onClick={()=>setMealDay(d)}>{d}</button>)}
              </div>
              {(()=>{
                // Meal Selections is a planning screen: show Active AND Upcoming clients
                // (Max needs to load meals ahead of time for clients who haven't started yet).
                // Kitchen Prep and Delivery Sheet stay strictly Active-only since they're
                // execution screens for "what happens today/this specific day".
                // Un cliente con renovación pendiente sigue siendo "de planificación"
                // aunque su ciclo actual ya haya vencido -- y para el día puntual que se
                // está mirando, cuenta como visible si su ciclo actual lo cubre O si ya
                // tiene elegidas comidas para el ciclo nuevo ese día (clientActiveOnDay
                // por sí solo no lo sabe, porque solo mira start/expiry del ciclo viejo).
                const hasAnyPending = c => Object.keys(pendingMeals[c.id] || {}).length > 0;
                const hasPendingForDay = c => (pendingMeals[c.id]?.[mealDay] || []).length > 0;
                const planningClients = clients.filter(c => getRealStatus(c.startDate, c.expiryDate) !== "Inactive" || hasAnyPending(c));
                const earliestTime = c => (meals[c.id]?.[mealDay]||[]).reduce((min,s) => {
                  const t = s.time||"";
                  return t && (!min || t<min) ? t : min;
                }, "");
                const visibleClients  = planningClients
                  .filter(c => clientActiveOnDay(c, mealDay) || hasPendingForDay(c))
                  .sort((a,b) => (earliestTime(a)||"99:99").localeCompare(earliestTime(b)||"99:99"));
                if (planningClients.length === 0) return (
                  <div className="empty-state"><div className="empty-state-icon">🍱</div><div className="empty-state-title">No active or upcoming clients</div><div className="empty-state-sub">Add clients to manage their meals</div></div>
                );
                if (visibleClients.length === 0) return (
                  <div className="empty-state"><div className="empty-state-icon">📅</div><div className="empty-state-title">No clients scheduled for {mealDay}</div><div className="empty-state-sub">All clients either haven't started yet or have expired for this day</div></div>
                );
                return visibleClients.map(c => {
                  const slots = [...(meals[c.id]?.[mealDay] || [])].sort((a,b) => (a.time||"99:99").localeCompare(b.time||"99:99"));
                  return (
                    <div className="client-card" key={c.id}>
                      <div className="client-card-hd">
                        <div className="client-card-name">{c.name}</div>
                        <PlanBadge planName={c.planName} plans={plans}/>
                        {clientRealStatus(c)==="Upcoming"&&
                          <span className="bx bx-a" style={{fontSize:9}}>Upcoming · starts {fmtDate(pendingRenewalStartByClient[c.id] || c.startDate)}</span>}
                        {c.customizations&&<span style={{fontSize:10,color:"#fcd34d"}}>⚠️ {c.customizations}</span>}
                        <button
                          onClick={()=>toggleCutlery(c.id)}
                          className={`bx bx-clk ${c.cutlery?"bx-g":"bx-gr"}`}
                          style={{marginLeft:"auto",fontSize:10}}
                          title="Toggle cutlery"
                        >🍴 {c.cutlery?"Cutlery":"No cutlery"}</button>
                      </div>

                      {slots.length===0&&(
                        <div style={{padding:"12px 14px",color:"var(--dim)",fontSize:11}}>No deliveries added yet for {mealDay}.</div>
                      )}

                      {slots.map((slot, si) => (
                        <div className="slot-row" key={slot.id}>
                          <div className="slot-num">Slot {si+1}</div>
                          <div className="slot-fields">
                            {/* Delivery time */}
                            <div className="slot-field slot-field-sm">
                              <label>Delivery Time</label>
                              <input className="msel" type="time" value={slot.time||""} onChange={e=>updateSlot(c.id,mealDay,slot.id,"time",e.target.value)}/>
                            </div>

                            {/* Cooking time — manual override shown on the Delivery Sheet */}
                            <div className="slot-field slot-field-sm">
                              <label>Cooking Time</label>
                              <input className="msel" type="time" value={slot.cookTime||""} onChange={e=>updateSlot(c.id,mealDay,slot.id,"cookTime",e.target.value)}/>
                            </div>

                            {/* Meals — one select per meal, + add more */}
                            <div className="slot-field" style={{flex:2,minWidth:200}}>
                              <label>Meals</label>
                              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                                {(slot.meals||[""]).map((meal,mi)=>(
                                  <div key={mi} style={{display:"flex",gap:4,alignItems:"center"}}>
                                    <select className="msel" value={meal||""} onChange={e=>updateSlotMeal(c.id,mealDay,slot.id,mi,e.target.value)} style={{flex:1}}>
                                      <MealOptions menu={mergeAllWeeksMenu(menu)} clientTier={c.planObj?.tier||""} extraItems={customItems} mealLibrary={mealLibraryState}/>
                                    </select>
                                    {(slot.meals||[]).length>1&&(
                                      <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none",padding:"2px 6px"}} onClick={()=>removeMealFromSlot(c.id,mealDay,slot.id,mi)}>✕</button>
                                    )}
                                  </div>
                                ))}
                                <button className="btn btn-g btn-xs" style={{alignSelf:"flex-start",marginTop:2}} onClick={()=>addMealToSlot(c.id,mealDay,slot.id)}>+ meal</button>
                              </div>
                            </div>

                            {/* Note */}
                            <div className="slot-field">
                              <label>Note</label>
                              <input className="msel" placeholder="e.g. no onion" value={slot.note||""} onChange={e=>updateSlot(c.id,mealDay,slot.id,"note",e.target.value)}/>
                            </div>

                            {/* Remove slot */}
                            <div style={{paddingTop:16}}>
                              <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>removeSlot(c.id,mealDay,slot.id)}>Remove slot</button>
                            </div>
                          </div>
                        </div>
                      ))}

                      <div className="slot-add-btn">
                        <button className="btn btn-g btn-sm" onClick={()=>addSlot(c.id,mealDay)}>+ Add Delivery Slot</button>
                      </div>

                      {(pendingMeals[c.id]?.[mealDay] || []).length > 0 && (
                        <div style={{ marginTop: 10, border: "1px dashed #38bdf8", borderRadius: 8, overflow: "hidden" }}>
                          <div style={{ padding: "6px 12px", background: "rgba(56,189,248,.12)", color: "#38bdf8", fontSize: 11, fontWeight: 700 }}>
                            🔵 NEXT CYCLE — already chosen for after this client's renewal applies
                          </div>
                          {pendingMeals[c.id][mealDay].map((slot, si) => (
                            <div className="slot-row" key={"pending-" + slot.id} style={{ opacity: .85 }}>
                              <div className="slot-num">Slot {si + 1}</div>
                              <div className="slot-fields">
                                <div className="slot-field slot-field-sm">
                                  <label>Delivery Time</label>
                                  <div className="msel" style={{ display: "flex", alignItems: "center" }}>{slot.time || "—"}</div>
                                </div>
                                <div className="slot-field" style={{ flex: 2, minWidth: 200 }}>
                                  <label>Meals</label>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                    {(slot.meals || []).length === 0 ? <span style={{ color: "var(--dim)", fontSize: 11 }}>—</span> :
                                      slot.meals.map((mealId, mi) => <div key={mi} style={{ fontSize: 12, color: "#fff" }}>{mealName(mealId) || mealId}</div>)}
                                  </div>
                                </div>
                                {slot.snack && (
                                  <div className="slot-field slot-field-sm">
                                    <label>Snack</label>
                                    <div className="msel" style={{ display: "flex", alignItems: "center" }}>{slot.snack}</div>
                                  </div>
                                )}
                                <div className="slot-field">
                                  <label>Note</label>
                                  <div className="msel" style={{ display: "flex", alignItems: "center" }}>{slot.note || "—"}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </>}

            {/* ═══ KITCHEN ════════════════════════════ */}
            {tab==="kitchen"&&<>
              {/* Summary bar */}
              {(()=>{
                const totalPortions = kitchen[kitDay]?.reduce((s,b)=>s+b.total,0)||0;
                const clientsToday  = active.filter(c=>(meals[c.id]?.[kitDay]||[]).length>0).length;
                const alertCount    = active.filter(c=>c.customizations||c.allergies).length;
                return (
                  <div style={{background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:8,padding:"14px 18px",marginBottom:14,display:"flex",alignItems:"center",gap:20,flexWrap:"wrap",justifyContent:"space-between"}}>
                    <div style={{display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
                      <div>
                        <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>Total Portions</div>
                        <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:24,fontWeight:700,color:"var(--blue)"}}>{totalPortions}</div>
                      </div>
                      <div style={{width:1,height:36,background:"var(--bdr)",flexShrink:0}}/>
                      <div>
                        <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>Clients Today</div>
                        <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:24,fontWeight:700,color:"var(--green)"}}>{clientsToday}</div>
                      </div>
                      <div style={{width:1,height:36,background:"var(--bdr)",flexShrink:0}}/>
                      <div>
                        <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>Batches</div>
                        <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:24,fontWeight:700,color:"var(--amber)"}}>{kitchen[kitDay]?.length||0}</div>
                      </div>
                      <div style={{width:1,height:36,background:"var(--bdr)",flexShrink:0}}/>
                      <div>
                        <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>Allergy Alerts</div>
                        <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:24,fontWeight:700,color:alertCount?"var(--amber)":"var(--dim)"}}>{alertCount}{alertCount>0?" ⚠️":""}</div>
                      </div>
                    </div>
                    <button className="btn btn-r btn-sm" onClick={()=>printKitchen()}>⬇ Print / PDF</button>
                  </div>
                );
              })()}

              {/* Batches */}
              {(kitchen[kitDay]||[]).length===0?(
                <div style={{background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:8,padding:20,textAlign:"center",color:"var(--dim)",fontSize:11}}>
                  No meal selections for {kitDay} yet
                </div>
              ):(
                (kitchen[kitDay]||[]).map((batch)=>(
                  <div key={batch.time} style={{marginBottom:16}}>
                    <div className="kd-hd" style={{borderRadius:"6px 6px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span>🔴 BATCH {batch.time}</span>
                      <span style={{fontSize:12,opacity:.85}}>{batch.total} portion{batch.total!==1?"s":""}</span>
                    </div>
                    {batch.unassignedMeals.length>0 && (
                      <div style={{padding:"8px 14px",background:"rgba(251,191,36,.1)",color:"#fbbf24",fontSize:11}}>
                        ⚠ No ingredients assigned yet for: {batch.unassignedMeals.join(", ")} — missing from the amounts below.
                      </div>
                    )}
                    {batch.ingredients.length===0 ? (
                      <div className="kr" style={{background:"var(--s2)",color:"var(--dim)",fontSize:11}}>No ingredients to show for this batch.</div>
                    ) : batch.ingredients.map((ing,i)=>(
                      <div className="kr" key={ing.id} style={{background:i%2===0?"var(--s2)":"var(--s1)"}}>
                        <div style={{width:28,height:28,borderRadius:6,overflow:"hidden",background:"var(--s3,#242424)",flexShrink:0,marginRight:10,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {ing.photoUrl ? <img src={ing.photoUrl} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/> : <span style={{fontSize:12,opacity:.4}}>🥕</span>}
                        </div>
                        <div className="km">{ing.name}</div>
                        <div style={{marginLeft:"auto",fontWeight:700,color:"#fff",fontSize:13}}>
                          {fmtQty(ing.grams, ing.category)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}

              {/* Day total summary */}
              {(kitchen[kitDay]||[]).length>0&&(()=>{
                const allGrams = {}; const allMeta = {};
                (kitchen[kitDay]||[]).forEach(b => b.ingredients.forEach(ing => {
                  allGrams[ing.id] = (allGrams[ing.id]||0) + ing.grams;
                  allMeta[ing.id] = ing;
                }));
                const rows = Object.entries(allGrams).sort((a,b)=>b[1]-a[1]);
                const totalCost = rows.reduce((s,[id,grams])=>{
                  const ing = allMeta[id];
                  return s + (ing.cost!=null ? grams/ing.grams*ing.cost : 0);
                },0);
                return (
                  <div style={{marginTop:8,marginBottom:20}}>
                    <div style={{background:"#0f0f0f",border:"1px solid var(--bdr)",borderRadius:"6px 6px 0 0",padding:"9px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:14,fontWeight:700,letterSpacing:1,color:"var(--dim)"}}>DAY TOTAL — {kitDay.toUpperCase()}</span>
                      <span style={{fontSize:11,color:"var(--dim)"}}>~¥{totalCost.toFixed(0)} in ingredients</span>
                    </div>
                    {rows.map(([id,grams],i)=>(
                      <div className="kr" key={id} style={{background:i%2===0?"var(--s2)":"var(--s1)"}}>
                        <div style={{width:28,height:28,borderRadius:6,overflow:"hidden",background:"var(--s3,#242424)",flexShrink:0,marginRight:10,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {allMeta[id].photoUrl ? <img src={allMeta[id].photoUrl} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/> : <span style={{fontSize:12,opacity:.4}}>🥕</span>}
                        </div>
                        <div className="km" style={{color:"#aaa"}}>{allMeta[id].name}</div>
                        <div style={{marginLeft:"auto",fontWeight:700,color:"#fff",fontSize:13}}>
                          {fmtQty(grams, allMeta[id].category)}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="sec-title">Allergy & Customization Alerts</div>
              {active.filter(c=>c.customizations||c.allergies).length===0?(
                <div className="tbl-wrap"><div style={{padding:16,textAlign:"center",color:"var(--dim)",fontSize:11}}>No alerts</div></div>
              ):(
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Client</th><th>Plan</th><th>Allergies</th><th>Customizations</th><th>Access</th></tr></thead>
                  <tbody>{active.filter(c=>c.customizations||c.allergies).map(c=>(
                    <tr key={c.id}>
                      <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                      <td><PlanBadge planName={c.planName} plans={plans}/></td>
                      <td style={{color:"#f87171"}}>{c.allergies||"—"}</td>
                      <td style={{color:"#fcd34d"}}>{c.customizations||"—"}</td>
                      <td style={{color:"var(--muted)"}}>{c.access||"—"}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </>}

            {/* ═══ DELIVERY ═══════════════════════════ */}
            {tab==="delivery"&&<>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div className="alert-bar" style={{background:"#0d1a0d",borderColor:"#14532d",color:"#86efac",margin:0,flex:1}}>
                  🛵 Sorted by delivery time.
                </div>
                <button className="btn btn-r" onClick={()=>printDelivery()} style={{flexShrink:0}}>⬇ Download PDF</button>
              </div>
              {Object.keys(delivery).length===0?(
                <div className="empty-state"><div className="empty-state-icon">🛵</div><div className="empty-state-title">No deliveries scheduled</div><div className="empty-state-sub">Add delivery slots in Meal Selections</div></div>
              ):Object.entries(delivery).map(([time,entries])=>(
                <div className="del-grp" key={time}>
                  <div className="del-time">🕐 {time} — {entries.length} stop{entries.length>1?"s":""}</div>
                  <div className="tbl-wrap"><table style={{tableLayout:"fixed",width:"100%"}}>
                    <colgroup>
                      <col style={{width:"3%"}}/>
                      <col style={{width:"13%"}}/>
                      <col style={{width:"9%"}}/>
                      <col style={{width:"18%"}}/>
                      <col style={{width:"10%"}}/>
                      <col style={{width:"22%"}}/>
                      <col style={{width:"7%"}}/>
                      <col style={{width:"12%"}}/>
                      <col style={{width:"6%"}}/>
                    </colgroup>
                    <thead><tr><th>#</th><th>Client</th><th>Plan</th><th>Address</th><th>Access</th><th>Meals</th><th>Cutlery</th><th>Note</th><th>Done</th></tr></thead>
                    <tbody>{entries.map(({client:c, slot},i)=>(
                      <tr key={slot.id}>
                        <td style={{color:"var(--dim)",whiteSpace:"nowrap"}}>{i+1}</td>
                        <td style={{color:"#fff",fontWeight:500,whiteSpace:"nowrap"}}>{c.name}</td>
                        <td style={{whiteSpace:"nowrap"}}><PlanBadge planName={c.planName} plans={plans}/></td>
                        <td style={{color:"var(--muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.address||"TBC"}</td>
                        <td style={{color:"var(--muted)",fontSize:10}}>{c.access||"—"}</td>
                        <td>
                          {(slot.meals||[]).filter(Boolean).map((m,i)=>(
                            <div key={i} style={{fontSize:10,color:"#ccc",whiteSpace:"nowrap"}}>{mealName(m)||m}</div>
                          ))}
                        </td>
                        <td style={{textAlign:"center",fontSize:11,whiteSpace:"nowrap"}}>{c.cutlery ? "Yes" : "No"}</td>
                        <td style={{color:"#fcd34d",fontSize:10}}>{slot.note||c.customizations||"—"}</td>
                        <td style={{whiteSpace:"nowrap"}}><button className={`bx bx-clk ${checks["d_"+slot.id]?"bx-g":"bx-gr"}`} onClick={()=>toggleCheck("d_"+slot.id)}>{checks["d_"+slot.id]?"✓ Done":"Pending"}</button></td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </div>
              ))}
            </>}

            {/* ═══ ORDERS ══════════════════════════════ */}
            {tab==="orders"&&<>
              <div className="sec-title" style={{marginTop:0}}>New Orders</div>
              {pendingOrders.length===0?(
                <div className="empty-state" style={{padding:"30px 20px"}}><div className="empty-state-title">No pending orders</div></div>
              ):(
                <div className="tbl-wrap" style={{marginBottom:24}}><table>
                  <thead><tr><th>Client</th><th>Contact</th><th>Address</th><th>Plan</th><th>Goal / Allergies</th><th>Start Date</th><th>Submitted</th><th>Action</th></tr></thead>
                  <tbody>
                    {pendingOrders.map(o=>(
                      <tr key={o.id}>
                        <td style={{color:"#fff",fontWeight:500}}>{o.name}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.phone||"—"}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.district} {o.address}</td>
                        <td><span className="bx bx-b">{plans.find(p=>p.id===o.plan_id)?.name||o.plan_id||"—"}</span></td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.goal||"—"} / {o.allergies||"—"}</td>
                        <td style={{color:"var(--green)",fontSize:11,fontWeight:500,whiteSpace:"nowrap"}}>{o.start_date?fmtDate(o.start_date):"—"}</td>
                        <td style={{color:"var(--dim)",fontSize:10}}>{o.created_at?new Date(o.created_at).toLocaleDateString():"—"}</td>
                        <td>
                          <div style={{display:"flex",gap:6}}>
                            <button className="btn btn-r btn-sm" disabled={ordersBusyId===o.id} onClick={()=>handleApproveOrder(o)}>
                              {ordersBusyId===o.id?"Working…":"Approve"}
                            </button>
                            <button className="btn btn-g btn-sm" disabled={ordersBusyId===o.id} onClick={()=>handleRejectOrder(o)}>Reject</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}

              <div className="sec-title">Approved Orders</div>
              {approvedOrders.length===0?(
                <div className="empty-state" style={{padding:"30px 20px"}}><div className="empty-state-title">No approved orders</div></div>
              ):(
                <div className="tbl-wrap" style={{marginBottom:24}}><table>
                  <thead><tr><th>Client</th><th>Contact</th><th>Address</th><th>Plan</th><th>Goal / Allergies</th><th>Start Date</th><th>Submitted</th><th>Action</th></tr></thead>
                  <tbody>
                    {approvedOrders.map(o=>(
                      <tr key={o.id}>
                        <td style={{color:"#fff",fontWeight:500}}>{o.name}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.phone||"—"}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.district} {o.address}</td>
                        <td><span className="bx bx-b">{plans.find(p=>p.id===o.plan_id)?.name||o.plan_id||"—"}</span></td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.goal||"—"} / {o.allergies||"—"}</td>
                        <td style={{color:"var(--green)",fontSize:11,fontWeight:500,whiteSpace:"nowrap"}}>{o.start_date?fmtDate(o.start_date):"—"}</td>
                        <td style={{color:"var(--dim)",fontSize:10}}>{o.created_at?new Date(o.created_at).toLocaleDateString():"—"}</td>
                        <td>
                          <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} disabled={orderDeleteBusyId===o.id} onClick={()=>handleDeleteOrder(o)}>
                            {orderDeleteBusyId===o.id?"Borrando…":"Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}

              <div className="sec-title">Rejected Orders</div>
              {rejectedOrders.length===0?(
                <div className="empty-state" style={{padding:"30px 20px"}}><div className="empty-state-title">No rejected orders</div></div>
              ):(
                <div className="tbl-wrap" style={{marginBottom:24}}><table>
                  <thead><tr><th>Client</th><th>Contact</th><th>Address</th><th>Plan</th><th>Goal / Allergies</th><th>Start Date</th><th>Rejected</th><th>Reason</th><th>Action</th></tr></thead>
                  <tbody>
                    {rejectedOrders.map(o=>(
                      <tr key={o.id}>
                        <td style={{color:"#fff",fontWeight:500}}>{o.name}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.phone||"—"}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.district} {o.address}</td>
                        <td><span className="bx bx-b">{plans.find(p=>p.id===o.plan_id)?.name||o.plan_id||"—"}</span></td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.goal||"—"} / {o.allergies||"—"}</td>
                        <td style={{color:"var(--green)",fontSize:11,fontWeight:500,whiteSpace:"nowrap"}}>{o.start_date?fmtDate(o.start_date):"—"}</td>
                        <td style={{color:"var(--dim)",fontSize:10}}>{o.created_at?new Date(o.created_at).toLocaleDateString():"—"}</td>
                        <td style={{color:"#fcd34d",fontSize:10}}>{o.note||"—"}</td>
                        <td>
                          <div style={{display:"flex",gap:6}}>
                            <button className="btn btn-r btn-sm" disabled={ordersBusyId===o.id} onClick={()=>handleReApproveOrder(o)}>
                              {ordersBusyId===o.id?"Working…":"Approve"}
                            </button>
                            <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} disabled={orderDeleteBusyId===o.id} onClick={()=>handleDeleteOrder(o)}>
                              {orderDeleteBusyId===o.id?"Borrando…":"Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}

              <div className="sec-title">Address Change Requests</div>
              {pendingAddrChanges.length===0?(
                <div className="empty-state" style={{padding:"30px 20px"}}><div className="empty-state-title">No pending address changes</div></div>
              ):(
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Client</th><th>Current Address</th><th>Requested Address</th><th>Submitted</th><th>Action</th></tr></thead>
                  <tbody>
                    {pendingAddrChanges.map(ch=>(
                      <tr key={ch.id}>
                        <td style={{color:"#fff",fontWeight:500}}>{ch.client?.name||`Client #${ch.client_id}`}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{ch.old_district} {ch.old_address}</td>
                        <td style={{color:"#ccc",fontSize:11,fontWeight:500}}>{ch.new_district} {ch.new_address}</td>
                        <td style={{color:"var(--dim)",fontSize:10}}>{ch.created_at?new Date(ch.created_at).toLocaleDateString():"—"}</td>
                        <td>
                          <div style={{display:"flex",gap:6}}>
                            <button className="btn btn-r btn-sm" disabled={ordersBusyId===ch.id} onClick={()=>handleApproveAddrChange(ch)}>
                              {ordersBusyId===ch.id?"Working…":"Approve"}
                            </button>
                            <button className="btn btn-g btn-sm" disabled={ordersBusyId===ch.id} onClick={()=>handleRejectAddrChange(ch)}>Reject</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </>}

            {/* ═══ REFERRALS ═══════════════════════════ */}
            {tab==="referrals"&&<>
              <div className="sec-title" style={{marginTop:0}}>Coaches & Referral Codes</div>
              <form onSubmit={handleAddCoach} style={{display:"flex",gap:10,marginBottom:24,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <label style={{fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:.5}}>Coach Name</label>
                  <input className="inp" style={{width:200}} placeholder="e.g. Dave" value={coachForm.name} onChange={e=>setCoachForm(f=>({...f,name:e.target.value}))}/>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <label style={{fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:.5}}>Promo Code</label>
                  <input className="inp" style={{width:220}} placeholder="e.g. davefitignyte" value={coachForm.code} onChange={e=>setCoachForm(f=>({...f,code:e.target.value.toLowerCase().replace(/\s/g,"")}))}/>
                </div>
                <button className="btn btn-r" type="submit" disabled={coachBusy||!coachForm.name.trim()||!coachForm.code.trim()}>
                  {coachBusy?"Adding…":"+ Add Coach"}
                </button>
              </form>
              {coaches.length===0?(
                <div className="empty-state" style={{padding:"30px 20px"}}><div className="empty-state-title">No coaches yet</div><div className="empty-state-sub">Add a coach above to start tracking referrals</div></div>
              ):(
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Coach</th><th>Promo Code</th><th>Referrals</th><th>Added</th><th></th></tr></thead>
                  <tbody>
                    {coaches.sort((a,b)=>b.referrals-a.referrals).map(c=>(
                      <tr key={c.id}>
                        <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                        <td><span style={{fontFamily:"monospace",background:"var(--s3)",padding:"2px 8px",borderRadius:4,fontSize:11,color:"var(--red)",border:"1px solid var(--bdr2)"}}>{c.code}</span></td>
                        <td><span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:20,fontWeight:700,color:c.referrals>0?"var(--green)":"var(--dim)"}}>{c.referrals}</span></td>
                        <td style={{color:"var(--dim)",fontSize:10}}>{new Date(c.created_at).toLocaleDateString()}</td>
                        <td><button className="btn btn-g btn-sm" onClick={()=>handleDeleteCoach(c.id)}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </>}

            {/* ═══ NOTIFICATIONS ═══════════════════════ */}
            {tab==="notifications"&&<>
              <div className="sec-title" style={{marginTop:0,textAlign:"center",fontSize:18}}>Send Notification</div>
              <form onSubmit={handleSendNotification} style={{maxWidth:920,margin:"0 auto 40px",background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:14,padding:44,display:"flex",flexDirection:"column",gap:28,fontSize:16}}>

                <div className="fl">
                  <label style={{fontSize:15}}>Send To</label>
                  <div style={{display:"flex",gap:14}}>
                    {[{id:"select",lbl:"Specific clients"},{id:"status",lbl:"By status"},{id:"all",lbl:"All clients"}].map(m=>(
                      <button key={m.id} type="button" className={`btn ${notifForm.recipientMode===m.id?"btn-r":"btn-g"}`} style={{padding:"14px 24px",fontSize:16}}
                        onClick={()=>setNotifForm(f=>({...f,recipientMode:m.id}))}>{m.lbl}</button>
                    ))}
                  </div>
                </div>

                {notifForm.recipientMode==="status"&&(
                  <div className="fl">
                    <label style={{fontSize:15}}>Status Filter</label>
                    <select className="sel" style={{fontSize:16,padding:"16px 18px"}} value={notifForm.statusFilter} onChange={e=>setNotifForm(f=>({...f,statusFilter:e.target.value}))}>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                      <option value="Paused">Paused</option>
                      <option value="Trial">Trial</option>
                      <option value="Expired">Expired</option>
                    </select>
                  </div>
                )}

                {notifForm.recipientMode==="select"&&(
                  <div className="fl">
                    <label style={{fontSize:15}}>Clients ({notifForm.clientIds.length} selected)</label>
                    <div style={{maxHeight:280,overflowY:"auto",border:"1px solid var(--bdr)",borderRadius:8,padding:18,display:"flex",flexDirection:"column",gap:14}}>
                      {clients.map(c=>(
                        <label key={c.id} style={{display:"flex",alignItems:"center",gap:14,fontSize:16,color:"var(--muted)",cursor:"pointer"}}>
                          <input type="checkbox" style={{width:20,height:20}} checked={notifForm.clientIds.includes(c.id)} onChange={()=>toggleNotifClient(c.id)}/>
                          {c.name}
                        </label>
                      ))}
                      {clients.length===0&&<span style={{fontSize:16,color:"var(--dim)"}}>No clients yet.</span>}
                    </div>
                  </div>
                )}

                <div className="fl">
                  <label style={{fontSize:15}}>Template</label>
                  <select className="sel" style={{fontSize:16,padding:"16px 18px"}} defaultValue="Custom" onChange={e=>applyNotifTemplate(e.target.value)}>
                    {NOTIF_TEMPLATES.map(t=><option key={t.label} value={t.label}>{t.label}</option>)}
                  </select>
                </div>

                <div className="fl">
                  <label style={{fontSize:15}}>Title</label>
                  <input className="inp" style={{fontSize:16,padding:"16px 18px"}} value={notifForm.title} onChange={e=>setNotifForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Delivery delayed" required/>
                </div>

                <div className="fl">
                  <label style={{fontSize:15}}>Message</label>
                  <input className="inp" style={{fontSize:16,padding:"16px 18px"}} value={notifForm.message} onChange={e=>setNotifForm(f=>({...f,message:e.target.value}))} placeholder="Message shown to the client"/>
                </div>

                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:15,color:"var(--dim)"}}>{notifRecipients.length} recipient{notifRecipients.length===1?"":"s"}</span>
                  <button className="btn btn-r" style={{padding:"16px 32px",fontSize:17}} type="submit" disabled={notifBusy||notifRecipients.length===0}>{notifBusy?"Sending…":"Send Notification"}</button>
                </div>
              </form>

              <div className="sec-title">Sent Notifications</div>
              {notifications.length===0?(
                <div className="empty-state" style={{padding:"30px 20px"}}><div className="empty-state-title">No notifications sent yet</div></div>
              ):(
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Client</th><th>Title</th><th>Message</th><th>Status</th><th>Sent</th><th></th></tr></thead>
                  <tbody>
                    {notifications.map(n=>(
                      <tr key={n.id}>
                        <td style={{color:"#fff",fontWeight:500}}>{n.client?.name||`Client #${n.client_id}`}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{n.title}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{n.message||"—"}</td>
                        <td><span className={`bx ${n.is_read?"bx-g":"bx-gr"}`}>{n.is_read?"Read":"Unread"}</span></td>
                        <td style={{color:"var(--dim)",fontSize:10}}>{n.created_at?new Date(n.created_at).toLocaleString():"—"}</td>
                        <td>
                          <button className="btn btn-sm" style={{background:"#450a0a",color:"#f87171",border:"none"}}
                            onClick={()=>handleDeleteNotification(n.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </>}

            {/* ═══ PLANS ════════════════════════════════ */}
            {tab==="plans"&&<>
              {!selectedTierId ? (
                // ── Tier grid ──
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
                  {tiers.map(t=>{
                    const tierPlans = plans.filter(p=>p.tier_id===t.id);
                    const c = t.color||"#38BDF8";
                    return (
                      <div key={t.id} className="plan-card" style={{"--pc":c,cursor:"pointer",padding:20}} onClick={()=>setSelectedTierId(t.id)}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                          <div>
                            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:22,fontWeight:700,color:"#fff",lineHeight:1.1}}>{t.name}</div>
                            {t.name_zh&&<div style={{fontSize:13,color:"var(--muted)",marginTop:3}}>{t.name_zh}</div>}
                          </div>
                          <div style={{width:14,height:14,borderRadius:"50%",background:c,flexShrink:0,marginTop:4}}/>
                        </div>
                        <div style={{fontSize:11,color:"var(--dim)",marginBottom:14}}>{tierPlans.length} plan{tierPlans.length!==1?"s":""}</div>
                        <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                          <button className="btn btn-g btn-xs" onClick={()=>openEditTier(t)}>Edit</button>
                          <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>deleteTierHandler(t.id)}>Delete</button>
                        </div>
                      </div>
                    );
                  })}
                  {tiers.length===0&&<div style={{color:"var(--dim)",fontSize:11,padding:20}}>No tiers yet. Click + New Tier to get started.</div>}
                </div>
              ) : (
                // ── Plans for selected tier ──
                <>
                  {(()=>{ const t=tiers.find(x=>x.id===selectedTierId); return t&&(
                    <div style={{marginBottom:14}}>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:20,fontWeight:700,color:"#fff"}}>{t.name}</div>
                      {t.name_zh&&<div style={{fontSize:13,color:"var(--muted)"}}>{t.name_zh}</div>}
                    </div>
                  ); })()}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
                    {plans.filter(p=>p.tier_id===selectedTierId).map(pd=>(
                      <div key={pd.id} className="plan-card" style={{"--pc":pd.color}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                          <div>
                            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:17,fontWeight:700,color:"#fff"}}>{pd.name}</div>
                            {pd.name_zh&&<div style={{fontSize:11,color:"var(--muted)",marginTop:1}}>{pd.name_zh}</div>}
                            <div style={{fontSize:10,color:"var(--muted)",marginTop:2}}>~{pd.kcal?.toLocaleString()} kcal · {pd.meals} meal{pd.meals>1?"s":""}/day</div>
                          </div>
                          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:24,fontWeight:800,color:pd.color}}>&#165;{pd.price}</div>
                        </div>
                        <div style={{fontSize:10,color:"var(--dim)",marginTop:6}}>{active.filter(c=>c.planName===pd.name).length} active client{active.filter(c=>c.planName===pd.name).length!==1?"s":""}</div>
                        <div style={{display:"flex",gap:6,marginTop:10}}>
                          <button className="btn btn-g btn-xs" onClick={()=>openEditPlan(pd)}>Edit</button>
                          <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>deletePlanHandler(pd.id)}>Delete</button>
                        </div>
                      </div>
                    ))}
                    {plans.filter(p=>p.tier_id===selectedTierId).length===0&&<div style={{color:"var(--dim)",fontSize:11,padding:20}}>No plans in this tier yet. Click + New Plan to add one.</div>}
                  </div>
                </>
              )}
            </>}

            {/* ═══ MENU ════════════════════════════════ */}
            {tab==="menu"&&<MenuTab
              menu={menu} plans={plans} active={active} currentWeekIndex={currentWeekIndex}
              rotationOrder={rotationOrder} saveRotationOrder={saveRotationOrder}
              upsertMenuDay={upsertMenuDay} flash={flash}
              openEditPlan={openEditPlan} deletePlanHandler={deletePlanHandler}
              mealLibraryRef={mealLibraryRef}
            />}

            {/* ═══ MEAL STATS ════════════════════════════════ */}
            {tab==="mealstats"&&<MealStatsTab plans={plans} />}

            {/* ═══ INGREDIENTS & COSTS ════════════════════════ */}
            {tab==="ingredients"&&<IngredientsTab
              ingredients={ingredients} setIngredients={setIngredients}
              mealIngredients={mealIngredients} setMealIngredients={setMealIngredients}
              mealLibrary={mealLibraryState}
              deliveryClients={deliveryClients} meals={meals}
              flash={flash}
            />}

            {/* ═══ ACCOUNTING ═════════════════════════════════ */}
            {tab==="accounting"&&<AccountingTab
              active={active} plans={plans} paidPayments={paidPayments}
              ingredients={ingredients} mealIngredients={mealIngredients}
              mealLibrary={mealLibraryState}
              deliveryClients={deliveryClients} meals={meals}
              employees={employees} setEmployees={setEmployees}
              otherExpenses={otherExpenses} setOtherExpenses={setOtherExpenses}
              acctSnapshots={acctSnapshots} setAcctSnapshots={setAcctSnapshots}
              oneTimeExpenses={oneTimeExpenses} setOneTimeExpenses={setOneTimeExpenses}
              coaches={coaches} setCoaches={setCoaches}
            />}

          </div>
        </div>
      </div>

      {/* ═══ CLIENT MODAL ════════════════════════════ */}
      {showClientModal&&(
        <div className="mo" onClick={e=>{if(e.target===e.currentTarget)setShowClientModal(false);}}>
          <div className="mo-box" style={{maxWidth:560}}>
            <div className="mo-hd">
              <div className="mo-title">{editClientId?"Edit Client":"New Client"}</div>
              <button className="btn btn-g btn-sm" onClick={()=>setShowClientModal(false)}>✕</button>
            </div>
            <div className="mo-body">

              {/* Section: Identity */}
              <div style={{marginBottom:18}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Identity</div>
                <div className="fg">
                  <div className="fl fg-full"><label>Full Name *</label><input className="inp" value={clientForm.name||""} onChange={e=>cfld("name",e.target.value)} placeholder="e.g. Sarah Chen"/></div>
                  <div className="fl"><label>Phone / WeChat</label><input className="inp" value={clientForm.phone||""} onChange={e=>cfld("phone",e.target.value)} placeholder="+86 138..."/></div>
                  <div className="fl"><label>Language</label>
                    <select className="sel" value={clientForm.language||"EN"} onChange={e=>cfld("language",e.target.value)}>
                      <option value="EN">English</option>
                      <option value="CN">中文</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section: Delivery */}
              <div style={{marginBottom:18}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Delivery</div>
                <div className="fg">
                  <div className="fl"><label>District / Area</label><input className="inp" value={clientForm.district||""} onChange={e=>cfld("district",e.target.value)} placeholder="e.g. Jing'an"/></div>
                  <div className="fl fg-full"><label>Address</label><input className="inp" value={clientForm.address||""} onChange={e=>cfld("address",e.target.value)} placeholder="288 Nanjing Rd, 801B"/></div>
                  <div className="fl fg-full"><label>Building Access</label><input className="inp" value={clientForm.access||""} onChange={e=>cfld("access",e.target.value)} placeholder="e.g. Leave at door, ring doorbell..."/></div>
                  <div className="fl"><label>Delivery Fee (¥/week)</label><input className="inp" type="number" value={clientForm.deliveryFee ?? ""} onChange={e=>cfld("deliveryFee",e.target.value)} placeholder="e.g. 35"/></div>
                </div>
              </div>

              {/* Section: Plan & Status */}
              <div style={{marginBottom:18}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Plan & Status</div>
                <div className="fg">
                  <div className="fl"><label>Plan</label>
                    <select className="sel" value={clientForm.planId||""} onChange={e=>cfld("planId",e.target.value)}>
                      <option value="">— Select plan —</option>
                      {plans.map(p=><option key={p.id} value={p.id}>{p.name} · ¥{p.price}/wk</option>)}
                    </select>
                  </div>
                  <div className="fl">
                    <label>Status</label>
                    <div style={{padding:"8px 10px",fontSize:11,color:"var(--dim)",background:"var(--s3)",borderRadius:6,border:"1px solid var(--bdr)"}}>
                      Auto-calculated from dates
                    </div>
                  </div>
                  <div className="fl"><label>Start Date</label><input className="inp" type="date" value={clientForm.startDate||""} onChange={e=>cfld("startDate",e.target.value)}/></div>
                  <div className="fl"><label>Expiry Date</label><input className="inp" type="date" value={clientForm.expiryDate||""} onChange={e=>cfld("expiryDate",e.target.value)}/></div>
                  <div className="fl"><label>Paid This Week?</label>
                    <select className="sel" value={String(clientForm.paid)} onChange={e=>cfld("paid",e.target.value==="true")}>
                      <option value="true">Yes, paid</option>
                      <option value="false">No</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section: Health & Notes */}
              <div>
                <div style={{fontSize:9,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Health & Notes</div>
                <div className="fg">
                  <div className="fl fg-full"><label>Goal</label><input className="inp" value={clientForm.goal||""} onChange={e=>cfld("goal",e.target.value)} placeholder="e.g. Lose weight, gain muscle..."/></div>
                  <div className="fl fg-full"><label>Allergies / Restrictions</label><input className="inp" value={clientForm.allergies||""} onChange={e=>cfld("allergies",e.target.value)} placeholder="e.g. No nuts, gluten-free..."/></div>
                  <div className="fl fg-full"><label>Notes</label><input className="inp" value={clientForm.customizations||""} onChange={e=>cfld("customizations",e.target.value)} placeholder="e.g. No onion, extra sauce..."/></div>
                </div>
              </div>

            </div>
            <div className="mo-ft">
              <button className="btn btn-g" onClick={()=>setShowClientModal(false)}>Cancel</button>
              <button className="btn btn-r" onClick={saveClient}>{editClientId?"Save Changes":"Add Client"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ APPROVE ORDER MODAL ═══════════════════════ */}
      {orderToApprove&&(
        <div className="mo" onClick={e=>{if(e.target===e.currentTarget)setOrderToApprove(null);}}>
          <div className="mo-box" style={{maxWidth:420}}>
            <div className="mo-hd">
              <div className="mo-title">Approve Order</div>
              <button className="btn btn-g btn-sm" onClick={()=>setOrderToApprove(null)}>✕</button>
            </div>
            <div className="mo-body">
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Client</div>
                <div style={{color:"#fff",fontWeight:500}}>{orderToApprove.name}</div>
                <div style={{color:"var(--muted)",fontSize:12,marginTop:2}}>{orderToApprove.district} {orderToApprove.address}</div>
              </div>
              <div className="fg">
                <div className="fl fg-full">
                  <label>Delivery Fee for this week (¥)</label>
                  <input
                    className="inp"
                    type="number"
                    autoFocus
                    value={approveFeeInput}
                    onChange={e=>setApproveFeeInput(e.target.value)}
                    placeholder="e.g. 35"
                  />
                </div>
              </div>
            </div>
            <div className="mo-ft">
              <button className="btn btn-g" onClick={()=>setOrderToApprove(null)}>Cancel</button>
              <button className="btn btn-r" disabled={ordersBusyId===orderToApprove.id} onClick={confirmApproveOrder}>
                {ordersBusyId===orderToApprove.id?"Working…":"Approve"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PLAN MODAL ══════════════════════════════ */}
      {showPlanModal&&(
        <div className="mo" onClick={e=>{if(e.target===e.currentTarget)setShowPlanModal(false);}}>
          <div className="mo-box" style={{maxWidth:480}}>
            <div className="mo-hd">
              <div className="mo-title">{editPlanId?"Edit Plan":"New Plan"}</div>
              <button className="btn btn-g btn-sm" onClick={()=>setShowPlanModal(false)}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fg">
                <div className="fl fg-full"><label>Plan Name *</label><input className="inp" value={planForm.name} onChange={e=>pfld("name",e.target.value)} placeholder="e.g. Light Fuel"/></div>
                <div className="fl fg-full"><label>Plan Name (Chinese)</label><input className="inp" value={planForm.name_zh||""} onChange={e=>pfld("name_zh",e.target.value||null)} placeholder="e.g. 轻燃计划"/></div>
                {!selectedTierId&&(
                  <div className="fl"><label>Tier</label>
                    <select className="sel" value={planForm.tier_id||""} onChange={e=>pfld("tier_id",e.target.value)}>
                      <option value="">&#8212; select tier &#8212;</option>
                      {tiers.map(t=><option key={t.id} value={t.id}>{t.name}{t.name_zh?` / ${t.name_zh}`:""}</option>)}
                    </select>
                  </div>
                )}
                <div className="fl"><label>Weekly Price (¥)</label><input className="inp" type="number" value={planForm.price} onChange={e=>pfld("price",Number(e.target.value))}/></div>
                <div className="fl"><label>Calories (~kcal)</label><input className="inp" type="number" value={planForm.kcal} onChange={e=>pfld("kcal",Number(e.target.value))}/></div>
                <div className="fl"><label>Meals per Day</label>
                  <select className="sel" value={planForm.meals} onChange={e=>pfld("meals",Number(e.target.value))}>
                    <option value={1}>1 meal/day</option><option value={2}>2 meals/day</option><option value={3}>3 meals/day</option>
                  </select>
                </div>
                <div className="fl fg-full"><label>Plan Color</label>
                  <div className="color-row">
                    {PLAN_COLORS.map(c=>(
                      <div key={c} className={`color-dot${planForm.color===c?" sel":""}`} style={{background:c}} onClick={()=>pfld("color",c)}/>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="mo-ft">
              <button className="btn btn-g" onClick={()=>setShowPlanModal(false)}>Cancel</button>
              <button className="btn btn-r" onClick={savePlan}>{editPlanId?"Save Changes":"Create Plan"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MENU MODAL ══════════════════════════════ */}
      {showMenuModal&&(
        <div className="mo" onClick={e=>{if(e.target===e.currentTarget)setShowMenuModal(false);}}>
          <div className="mo-box" style={{maxWidth:520}}>
            <div className="mo-hd">
              <div className="mo-title">Edit Menu — {menuEditDay}</div>
              <button className="btn btn-g btn-sm" onClick={()=>setShowMenuModal(false)}>✕</button>
            </div>
            <div className="mo-body">
              <div style={{marginBottom:16}}>
                <div className="sec-title" style={{marginBottom:8}}>Meals of the Day</div>
                {menuForm.meals.map((m,i)=>(
                  <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                    <span style={{fontSize:10,color:"var(--dim)",minWidth:60}}>Meal {i+1}</span>
                    <input className="inp" placeholder={`Meal ${i+1} name`} value={m||""} onChange={e=>{
                      const nm=[...menuForm.meals]; nm[i]=e.target.value; setMenuForm(p=>({...p,meals:nm}));
                    }}/>
                    {menuForm.meals.length>1&&(
                      <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>setMenuForm(p=>({...p,meals:p.meals.filter((_,j)=>j!==i)}))}>✕</button>
                    )}
                  </div>
                ))}
                <button className="btn btn-g btn-sm" onClick={()=>setMenuForm(p=>({...p,meals:[...p.meals,""]}))}>+ Add Meal</button>
              </div>
            </div>
            <div className="mo-ft">
              <button className="btn btn-g" onClick={()=>setShowMenuModal(false)}>Cancel</button>
              <button className="btn btn-r" onClick={saveMenu}>Save Menu</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TIER MODAL ══════════════════════════════ */}
      {showTierModal&&(
        <div className="mo" onClick={e=>{if(e.target===e.currentTarget)setShowTierModal(false);}}>
          <div className="mo-box" style={{maxWidth:420}}>
            <div className="mo-hd">
              <div className="mo-title">{editTierId?"Edit Tier":"New Tier"}</div>
              <button className="btn btn-g btn-sm" onClick={()=>setShowTierModal(false)}>&#x2715;</button>
            </div>
            <div className="mo-body">
              <div className="fg">
                <div className="fl fg-full"><label>Tier Name *</label><input className="inp" value={tierForm.name} onChange={e=>tfld("name",e.target.value)} placeholder="e.g. Lean Fit"/></div>
                <div className="fl fg-full"><label>Tier Name (Chinese)</label><input className="inp" value={tierForm.name_zh||""} onChange={e=>tfld("name_zh",e.target.value)} placeholder="e.g. 精瘦计划"/></div>
                <div className="fl fg-full"><label>Color</label><div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>{PLAN_COLORS.map(c=><div key={c} className={`color-dot${tierForm.color===c?" sel":""}`} style={{background:c}} onClick={()=>tfld("color",c)}/>)}</div></div>
              </div>
            </div>
            <div className="mo-ft">
              <button className="btn btn-g" onClick={()=>setShowTierModal(false)}>Cancel</button>
              <button className="btn btn-r" onClick={saveTier}>{editTierId?"Save Changes":"Create Tier"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CUSTOM ITEM MODAL ═══════════════════════ */}
      {showBatchEditor&&(
        <div className="mo" onClick={e=>{if(e.target===e.currentTarget)setShowBatchEditor(false);}}>
          <div className="mo-box" style={{maxWidth:380}}>
            <div className="mo-hd">
              <div className="mo-title">Kitchen Prep Batches</div>
              <button className="btn btn-g btn-sm" onClick={()=>setShowBatchEditor(false)}>✕</button>
            </div>
            <div className="mo-body">
              <p style={{fontSize:11,color:"var(--muted)",marginBottom:14}}>Cada horario es un corte de "cocinar hasta esta hora" — un pedido con delivery a las 10:30 cae en el batch 09:45 si el siguiente es 11:00. Formato 24hs, HH:MM.</p>
              {batchDraft.map((t,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                  <input className="inp" value={t} placeholder="HH:MM"
                    onChange={e=>setBatchDraft(p=>p.map((x,j)=>j===i?e.target.value:x))}
                    style={{width:110}} />
                  <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}}
                    onClick={()=>setBatchDraft(p=>p.filter((_,j)=>j!==i))}>Remove</button>
                </div>
              ))}
              <button className="btn btn-g btn-sm" onClick={()=>setBatchDraft(p=>[...p,""])}>+ Add batch</button>
            </div>
            <div className="mo-ft">
              <button className="btn btn-g" onClick={()=>setShowBatchEditor(false)}>Cancel</button>
              <button className="btn btn-r" onClick={saveBatchEditor}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showCustomItemModal&&(
        <div className="mo" onClick={e=>{if(e.target===e.currentTarget)setShowCustomItemModal(false);}}>
          <div className="mo-box" style={{maxWidth:440}}>
            <div className="mo-hd">
              <div className="mo-title">Custom Meal Items</div>
              <button className="btn btn-g btn-sm" onClick={()=>setShowCustomItemModal(false)}>✕</button>
            </div>
            <div className="mo-body">
              <p style={{fontSize:11,color:"var(--muted)",marginBottom:14}}>Add extra meals or items that aren't in the weekly menu (e.g. vegetarian options, special requests). They'll appear in all meal dropdowns.</p>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <input className="inp" placeholder="e.g. Veggie Tofu Bowl" value={newCustomItem} onChange={e=>setNewCustomItem(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&newCustomItem.trim()){setCustomItems(p=>[...p,newCustomItem.trim()]);setNewCustomItem("");}}}
                />
                <button className="btn btn-r" style={{flexShrink:0}} onClick={()=>{
                  if(newCustomItem.trim()){setCustomItems(p=>[...p,newCustomItem.trim()]);setNewCustomItem("");}
                }}>Add</button>
              </div>
              {customItems.length===0?(
                <div style={{color:"var(--dim)",fontSize:11}}>No custom items yet.</div>
              ):(
                <div className="tbl-wrap">
                  {customItems.map((item,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",padding:"8px 12px",borderBottom:"1px solid #161616",fontSize:11}}>
                      <span style={{flex:1,color:"#ccc"}}>{item}</span>
                      <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>setCustomItems(p=>p.filter((_,j)=>j!==i))}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mo-ft">
              <button className="btn btn-r" onClick={()=>setShowCustomItemModal(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
