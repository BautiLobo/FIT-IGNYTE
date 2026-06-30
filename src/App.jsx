// FitIgnyte.jsx — Full app connected to Supabase
import { useState, useEffect, useMemo, useRef } from "react";
import {
  getPlans, upsertPlan, deletePlan as dbDeletePlan,
  getClients, upsertClient, deleteClient as dbDeleteClient,
  getMenu, updateMenuDay, getCurrentWeekIndex, getMenuRotationOrder, setMenuRotationOrder,
  getMealSelections, upsertMealSelection,
  getChecklist, toggleChecklistItem,
  signIn, signOut, getSession, onAuthChange,
  getPendingOrders, approveOrder, rejectOrder,
  getPendingAddressChanges, approveAddressChange, rejectAddressChange,
  getNotifications, sendNotification, deleteNotification,
} from "./lib/supabase";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const BATCHES = ["09:45", "11:00", "12:00", "16:00", "16:45", "17:45"];

function getBatch(time) {
  if (!time) return BATCHES[BATCHES.length - 1];
  // Find the last batch that is <= delivery time
  let assigned = BATCHES[0];
  for (const b of BATCHES) {
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
};
const BLANK_PLAN = { id:"", name:"", kcal:0, meals:1, price:0, tier:"", color:"#38BDF8" };

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
const fmtDate   = d => { try { return new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); } catch { return d||"—"; } };
const todayIso  = () => TODAY.toISOString().split("T")[0];

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
  const todayIdx = TODAY.getDay(); // 0=Sun
  const targetIdx = DAY_INDEX[dayName] ?? -1;
  if (targetIdx === -1) return getRealStatus(c.startDate, c.expiryDate) === "Active";
  const diff = (targetIdx - todayIdx + 7) % 7;
  const targetDate = new Date(TODAY);
  targetDate.setDate(TODAY.getDate() + diff);
  targetDate.setHours(0,0,0,0);
  const start  = new Date(c.startDate  + "T00:00:00");
  const expiry = new Date(c.expiryDate + "T00:00:00");
  return targetDate >= start && targetDate <= expiry;
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const G = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap');
:root{--bg:#0a0a0a;--s1:#111;--s2:#1a1a1a;--s3:#242424;--bdr:#2a2a2a;--bdr2:#333;--txt:#e8e8e8;--muted:#666;--dim:#444;--red:#E8342A;--red2:#ff4438;--green:#22c55e;--amber:#f59e0b;--blue:#38bdf8}
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
table{width:100%;border-collapse:collapse;font-size:11px}
thead tr{background:#0f0f0f}
th{padding:9px 12px;text-align:left;font-size:9px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--bdr);white-space:nowrap}
td{padding:8px 12px;border-bottom:1px solid #161616;color:var(--txt);vertical-align:middle}
tr:last-child td{border-bottom:none}
tbody tr:hover{background:#1e1e1e}
.bx{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:.2px;white-space:nowrap}
.bx-g{background:#052e16;color:#4ade80}
.bx-r{background:#450a0a;color:#f87171}
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
  if (isNaN(d)) return <span className="bx bx-gr">—</span>;
  if (d < 0)  return <span className="bx bx-r">Expired {Math.abs(d)}d</span>;
  if (d === 0) return <span className="bx bx-r">Last day</span>;
  if (d <= 3) return <span className="bx bx-r">Expires {d}d</span>;
  if (d <= 7) return <span className="bx bx-a">Renew {d}d</span>;
  return <span className="bx bx-g">Active {d}d</span>;
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
function MealOptions({ menu, day, clientTier = null, extraItems = [] }) {
  const days = day ? [day] : DAYS;
  const seen = new Set();
  const allMeals = [];

  // Find the matching menu key for this client's tier (case-insensitive)
  const matchingKeys = clientTier
    ? Object.keys(menu).filter(k => k === clientTier || k.toLowerCase() === clientTier.toLowerCase())
    : Object.keys(menu); // no tier = show all

  days.forEach(d => {
    matchingKeys.forEach(k => {
      (menu[k]?.[d]?.meals || []).forEach(m => {
        const id   = typeof m === "object" ? m.id   : null;
        const name = typeof m === "object" ? m.name : m;
        if (id && !seen.has(id)) { seen.add(id); allMeals.push({id, name}); }
      });
    });
  });

  return (
    <>
      <option value="">— none —</option>
      {allMeals.length > 0 && (
        <optgroup label="── Meals ──">
          {allMeals.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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

// ─── APP ─────────────────────────────────────────────────────────────────────

function MenuTab({ menu, plans, active, currentWeekIndex, rotationOrder, saveRotationOrder, upsertMenuDay, flash, openEditPlan, deletePlanHandler, mealLibraryRef }) {
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
  const [showSaucePicker, setShowSaucePicker] = useState(false);
  const [mealForm,     setMealForm]     = useState({name:"",sauce:"",kcal:"",protein:"",carbs:"",fat:"",photoUrl:"",photoFile:null});
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
    const typeOrder = {meal:0, snack:1, sauce:2};
    return mealLibrary
      .filter(m => {
        if (m.item_type === "sauce") return menuTab !== "planner";
        if (menuTab === "planner" && m.item_type === "meal") {
          // Match meal tier against active tier — case-insensitive, no hardcoding
          return m.tier === activeTier || (m.tier||"").toLowerCase() === activeTier.toLowerCase();
        }
        return true;
      })
      .map(m=>({...m, source:m.item_type||"meal"}))
      .sort((a,b)=>{
        const td = (typeOrder[a.item_type]||0)-(typeOrder[b.item_type]||0);
        if (td !== 0) return td;
        return a.name.localeCompare(b.name);
      });
  },[mealLibrary, menuTier, menuTab, activeTier]);

  const saveMealToLibrary = async () => {
    if(!mealForm.name.trim()){alert("Meal name is required");return;}
    setSavingMeal(true);
    try {
      const {upsertMealLibrary, uploadMealPhoto, supabase} = await import("./lib/supabase");
      const payload = {
        name: mealForm.name.trim(),
        sauce: mealForm.sauce||"",
        kcal: parseInt(mealForm.kcal)||0,
        protein: parseInt(mealForm.protein)||0,
        carbs: parseInt(mealForm.carbs)||0,
        fat: parseInt(mealForm.fat)||0,
        item_type: mealForm.itemType||"meal",
        tier: mealForm.itemType==="meal" ? (mealForm.tier||availableTiers[0]?.tier||"") : null,
        is_snack: mealForm.itemType==="snack",
        available_sauce_ids: mealForm.itemType==="meal" ? (mealForm.availableSauceIds||[]) : [],
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
    setMealForm({name:m.name,sauce:m.sauce||"",kcal:m.kcal||"",protein:m.protein||"",carbs:m.carbs||"",fat:m.fat||"",photoUrl:m.photo_url||"",photoFile:null,itemType:m.item_type||"meal",tier:m.tier||"",availableSauceIds:m.available_sauce_ids||[]});
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
    const isSnack = slot==="Snack";
    const si = isSnack ? null : parseInt(slot.replace("Meal ",""))-1;
    const dm = tierMenu[day] || {mealIds:[], snack:"", snackId:""};
    const newIds = [...(dm.mealIds||[])];
    if(isSnack){
      upsertMenuDay(day, activeTierKey, effectivePlannerWeek, {mealIds:newIds, snackId:meal.id});
    } else {
      while(newIds.length <= si) newIds.push("");
      newIds[si] = meal.id;
      upsertMenuDay(day, activeTierKey, effectivePlannerWeek, {mealIds:newIds.filter(Boolean), snackId:dm.snackId||""});
    }
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
        <span style={{fontSize:12,color:"var(--muted)",fontWeight:600}}>Semana:</span>
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
            Semana {w}
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
        <button className="btn btn-r btn-sm" onClick={()=>{setMealForm({name:"",sauce:"",kcal:"",protein:"",carbs:"",fat:"",photoUrl:"",photoFile:null});setEditingMealId(null);setShowAddMeal(true);}}>+ Add Meal</button>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        <button className={`btn btn-sm ${libraryTierFilter==="ALL"?"btn-r":"btn-g"}`} onClick={()=>setLibraryTierFilter("ALL")}>All</button>
        {availableTiers.map(({tier:t,label:lbl,color:col})=>(
          <button key={t} className="btn btn-sm" style={{background:libraryTierFilter===t?col:"var(--s2)",color:libraryTierFilter===t?"#000":col,border:`1px solid ${col}66`,fontWeight:700}} onClick={()=>setLibraryTierFilter(t)}>
            {lbl}
          </button>
        ))}
        <button className={`btn btn-sm ${libraryTierFilter==="SNACK"?"btn-r":"btn-g"}`} onClick={()=>setLibraryTierFilter("SNACK")}>Snacks</button>
        <button className={`btn btn-sm ${libraryTierFilter==="SAUCE"?"btn-r":"btn-g"}`} onClick={()=>setLibraryTierFilter("SAUCE")}>Sauces</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16}}>
        {allMeals
          .filter(m=>{
            if(libraryTierFilter==="ALL") return true;
            if(libraryTierFilter==="SNACK") return m.item_type==="snack";
            if(libraryTierFilter==="SAUCE") return m.item_type==="sauce";
            return m.item_type==="meal" && (m.tier===libraryTierFilter || (m.tier||"").toLowerCase()===libraryTierFilter.toLowerCase());
          })
          .slice()
          .sort((a,b)=>{
            const order = {meal:0, snack:1, sauce:2};
            const ta = order[a.item_type]??3, tb = order[b.item_type]??3;
            if(ta!==tb) return ta-tb;
            const tierA = (a.tier||"").toLowerCase(), tierB = (b.tier||"").toLowerCase();
            if(tierA!==tierB) return tierA.localeCompare(tierB);
            return (a.name||"").localeCompare(b.name||"");
          })
          .map((m,i)=>{
          const tierDef = m.item_type==="meal"
            ? availableTiers.find(t=>t.tier===m.tier||t.tier.toLowerCase()===(m.tier||"").toLowerCase())
            : null;
          const tc = m.item_type==="sauce"?"#f87171":m.item_type==="snack"?"#4ade80":tierDef?.color||"#60a5fa";
          const badgeLabel = m.item_type==="sauce"?"SAUCE":m.item_type==="snack"?"SNACK":tierDef?.label||m.tier||"—";
          const assignedSauces = (m.available_sauce_ids||[])
            .map(sid=>mealLibrary.find(x=>x.id===sid)?.name)
            .filter(Boolean);
          return (
          <div key={m.id||i} draggable onDragStart={()=>{draggingMealRef.current=m;setDraggingMeal(m);}} onDragEnd={()=>{draggingMealRef.current=null;setDraggingMeal(null);}}
            style={{overflow:"hidden",borderRadius:10,border:`1px solid ${tc}55`,background:"var(--s2)",cursor:"grab",userSelect:"none",position:"relative"}}>
            {m.id&&<button onClick={e=>{e.stopPropagation();deleteMealFromLibrary(m.id,m.name);}}
              style={{position:"absolute",top:8,left:8,background:"rgba(0,0,0,0.75)",border:"none",color:"#f87171",width:24,height:24,borderRadius:"50%",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>✕</button>}
            <div style={{width:"100%",height:130,background:"var(--s3)",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",borderBottom:`1px solid ${tc}33`}}>
              {m.photo_url
                ? <img src={m.photo_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={m.name}/>
                : <span style={{fontSize:12,color:"var(--dim)"}}>No photo yet</span>}
              <span style={{position:"absolute",top:8,right:8,fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:4,
                background:tc,color:"#000",letterSpacing:.5,fontWeight:800}}>
                {badgeLabel}
              </span>
            </div>
            <div style={{padding:"12px 14px"}}>
              <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:4}}>{m.name}</div>
              {assignedSauces.length>0&&
                <div style={{fontSize:11,color:"var(--muted)",marginBottom:4,lineHeight:1.4}}>🧂 {assignedSauces.join(", ")}</div>}
              {m.item_type==="meal"&&assignedSauces.length===0&&
                <div style={{fontSize:11,color:"var(--dim)",marginBottom:4}}>No sauces assigned</div>}
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
      <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>

        {/* ── Sidebar: meals for active tier ── */}
        <div style={{width:260,flexShrink:0}}>
          {/* Header with tier color accent */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,paddingBottom:10,borderBottom:`1px solid ${activeTierColor}44`}}>
            <div style={{width:4,height:16,borderRadius:2,background:activeTierColor,flexShrink:0}}/>
            <span style={{fontSize:11,color:activeTierColor,textTransform:"uppercase",letterSpacing:1.5,fontWeight:700}}>
              Drag meals →
            </span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:640,overflowY:"auto",paddingRight:4}}>
            {/* Meals for this tier */}
            {(()=>{
              const tierMeals = allMeals.filter(m => m.item_type === "meal");
              const snacks    = allMeals.filter(m => m.item_type === "snack");
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
              const getSnackStyle = (m) => ({
                background: draggingMeal?.id===m.id ? "#166534" : "var(--s2)",
                border: `1px solid ${draggingMeal?.id===m.id ? "#4ade80" : "#166534"}`,
                borderRadius: 8,
                padding: "13px 14px",
                fontSize: 14,
                color: draggingMeal?.id===m.id ? "#fff" : "#4ade80",
                cursor: "grab",
                userSelect: "none",
                lineHeight: 1.35,
                transition: "background .15s",
                wordBreak: "break-word",
              });
              return <>
                {tierMeals.length > 0 && <>
                  <div style={{fontSize:11,color:"var(--dim)",textTransform:"uppercase",letterSpacing:1,fontWeight:700,padding:"3px 0 6px"}}>Meals</div>
                  {tierMeals.map((m,i)=>(
                    <div key={m.id||i} draggable
                      onDragStart={()=>{draggingMealRef.current=m;setDraggingMeal(m);}}
                      onDragEnd={()=>{draggingMealRef.current=null;setDraggingMeal(null);}}
                      style={getMealStyle(m)}>
                      {m.name}
                    </div>
                  ))}
                </>}
                {snacks.length > 0 && <>
                  <div style={{fontSize:11,color:"var(--dim)",textTransform:"uppercase",letterSpacing:1,fontWeight:700,padding:"10px 0 6px"}}>Snacks</div>
                  {snacks.map((m,i)=>(
                    <div key={m.id||i} draggable
                      onDragStart={()=>{draggingMealRef.current=m;setDraggingMeal(m);}}
                      onDragEnd={()=>{draggingMealRef.current=null;setDraggingMeal(null);}}
                      style={getSnackStyle(m)}>
                      <span style={{fontSize:10,fontWeight:700,display:"block",marginBottom:3,letterSpacing:1,color:"#4ade80"}}>SNACK</span>
                      {m.name}
                    </div>
                  ))}
                </>}
                {tierMeals.length===0 && snacks.length===0 && (
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
        <div style={{flex:1,overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
            <thead><tr>
              <th style={{width:75,padding:"8px 10px",textAlign:"left",color:"var(--muted)",fontSize:12,fontWeight:700}}>SLOT</th>
              {DAYS.map(d=><th key={d} style={{padding:"8px 6px",color:activeTierColor,fontSize:12,fontWeight:700,textAlign:"center",letterSpacing:.5}}>{d.slice(0,3).toUpperCase()}</th>)}
            </tr></thead>
            <tbody>
              {[...["Meal 1","Meal 2","Meal 3"],...Array.from({length:extraRows},(_,i)=>`Meal ${4+i}`),"Snack"].map((slot)=>{
                const isSnack=slot==="Snack";
                const mealIdx=isSnack?null:parseInt(slot.replace("Meal ",""))-1;
                return (
                <tr key={slot}>
                  <td style={{padding:"6px 10px",color:"var(--dim)",fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>{slot}</td>
                  {DAYS.map(day=>{
                    const mealObj = isSnack ? tierMenu[day]?.snackObj : (tierMenu[day]?.meals?.[mealIdx]||null);
                    const val = mealObj?.name || (isSnack ? tierMenu[day]?.snack : "") || "";
                    const isOver=dragOver===`${day}-${slot}`;
                    return (
                      <td key={day}
                        onDragOver={e=>{e.preventDefault();setDragOver(`${day}-${slot}`);}}
                        onDragLeave={()=>setDragOver(null)}
                        onDrop={()=>handleAssignMeal(day,slot)}
                        style={{padding:5}}>
                        <div title={val||""}
                          style={{
                            background:isOver?`${activeTierColor}18`:val?"var(--s2)":"var(--s3)",
                            border:`1px ${isOver?"solid":"dashed"} ${isOver?activeTierColor:val?`${activeTierColor}33`:"#2a2a2a"}`,
                            borderRadius:8,padding:"14px 10px",minHeight:92,fontSize:13,
                            color:val?"#ddd":"var(--dim)",textAlign:"center",
                            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,
                            transition:"background .1s,border-color .1s",
                          }}>
                          <span style={{width:"100%",textAlign:"center",lineHeight:1.45,wordBreak:"break-word",fontWeight:val?500:400}}>
                            {val||<span style={{fontSize:12,color:"#333"}}>Drop</span>}
                          </span>
                          {val&&<span style={{fontSize:11,color:"var(--dim)",cursor:"pointer",marginTop:3,opacity:.7}}
                            onClick={()=>{
                              const dm=tierMenu[day]||{mealIds:[],snack:"",snackId:""};
                              const newIds=[...(dm.mealIds||[])];
                              if(isSnack){upsertMenuDay(day,activeTierKey,effectivePlannerWeek,{mealIds:newIds,snackId:""});}
                              else{newIds[mealIdx]="";upsertMenuDay(day,activeTierKey,effectivePlannerWeek,{mealIds:newIds.filter(Boolean),snackId:dm.snackId||""});}
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
      <div className="mo" onClick={()=>{setShowAddMeal(false);setEditingMealId(null);setShowSaucePicker(false);}}>
        <div className="mo-box" style={{maxWidth:820,maxHeight:"95vh"}} onClick={e=>e.stopPropagation()}>
          <div className="mo-hd"><div className="mo-title">{editingMealId?"Edit Meal":"Add New Meal"}</div><button className="mo-close" onClick={()=>{setShowAddMeal(false);setEditingMealId(null);setShowSaucePicker(false);}}>✕</button></div>
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
              <div>
                <div className="form-label">Type</div>
                <div style={{display:"flex",gap:6}}>
                  {[["meal","Meal"],["snack","Snack"],["sauce","Sauce"]].map(([t,lbl])=>(
                    <button key={t} type="button" className={`btn btn-sm ${mealForm.itemType===t?"btn-r":"btn-g"}`} style={{flex:1,padding:"7px 0"}} onClick={()=>setMealForm(p=>({...p,itemType:t}))}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {mealForm.itemType==="meal"&&<div style={{gridColumn:"1 / -1"}}>
              <div className="form-label">Plan</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {availableTiers.map(({tier:t,label:lbl})=>(
                  <button key={t} type="button" className={`btn btn-sm ${mealForm.tier===t?"btn-r":"btn-g"}`} style={{flex:1,minWidth:90,padding:"7px 0"}} onClick={()=>setMealForm(p=>({...p,tier:t}))}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>}
            {mealForm.itemType==="meal"&&<div style={{gridColumn:"1 / -1",position:"relative"}}>
              <div className="form-label">Available Sauces</div>
              <button type="button" className="btn btn-g" style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 13px",fontSize:12}}
                onClick={()=>setShowSaucePicker(v=>!v)}>
                <span>
                  {(mealForm.availableSauceIds||[]).length>0
                    ? `${mealForm.availableSauceIds.length} sauce${mealForm.availableSauceIds.length>1?"s":""} selected`
                    : "Select sauces..."}
                </span>
                <span style={{fontSize:11,color:"var(--dim)"}}>{showSaucePicker?"▲":"▼"}</span>
              </button>
              {showSaucePicker&&(
                <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:6,zIndex:20,background:"var(--s3,#181818)",border:"1px solid var(--bdr2)",borderRadius:8,padding:10,maxHeight:180,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,.5)"}}>
                  {mealLibrary.filter(m=>m.item_type==="sauce").map(s=>{
                    const checked = (mealForm.availableSauceIds||[]).includes(s.id);
                    return (
                      <label key={s.id} style={{display:"flex",alignItems:"center",gap:10,fontSize:13,color:"var(--text,#eee)",padding:"7px 6px",cursor:"pointer",borderRadius:5}}
                        onMouseDown={e=>e.preventDefault()}>
                        <input type="checkbox" checked={checked}
                          onChange={()=>setMealForm(p=>{
                            const cur = p.availableSauceIds||[];
                            return {...p, availableSauceIds: cur.includes(s.id) ? cur.filter(x=>x!==s.id) : [...cur, s.id]};
                          })}/>
                        {s.name}
                      </label>
                    );
                  })}
                  {mealLibrary.filter(m=>m.item_type==="sauce").length===0&&<span style={{fontSize:12,color:"var(--dim)",padding:"6px"}}>No sauces in library yet. Add one with Type: Sauce.</span>}
                </div>
              )}
            </div>}
            <div style={{gridColumn:"1 / -1",display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
              {[["kcal","Kcal"],["protein","Protein g"],["carbs","Carbs g"],["fat","Fat g"]].map(([k,lbl])=>(
                <div key={k}><div className="form-label">{lbl}</div><input className="form-inp" type="number" style={{fontSize:13,padding:"8px 9px"}} value={mealForm[k]||""} onChange={e=>setMealForm(p=>({...p,[k]:e.target.value}))} placeholder="0"/></div>
              ))}
            </div>
          </div>
          <div className="mo-ft">
            <button className="btn btn-g" style={{flex:1,padding:"11px 0"}} onClick={()=>{setShowAddMeal(false);setShowSaucePicker(false);}}>Cancel</button>
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
  const [menu,       setMenu]       = useState({1:{},2:{},3:{},4:{}});
  const [currentWeekIndex, setCurrentWeekIndex] = useState(1);
  const [rotationOrder, setRotationOrder] = useState([1,2,3,4]);
  const [plans,      setPlans]      = useState([]);
  const [checks,     setChecks]     = useState({});
  // cookTimes: { Monday: "10:00", Tuesday: "09:30", ... }
  const [cookTimes,  setCookTimes]  = useState({});
  const mealLibraryRef = useRef([]);
  const [mealLibraryState, setMealLibraryState] = useState([]);
  const [pdfUrls,    setPdfUrls]    = useState({en:"", cn:""});
  const [pdfUploading,setPdfUploading]= useState({en:false, cn:false});
  // customMealItems: extra meals added manually
  const [customItems, setCustomItems] = useState([]);

  const [tab,         setTab]         = useState("dashboard");
  const [kitDay,      setKitDay]      = useState("Monday");
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
  const [menuEditDay,   setMenuEditDay]   = useState("Monday");
  const [menuForm,      setMenuForm]      = useState({meals:["","",""],snack:""});

  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  const [newCustomItem,       setNewCustomItem]       = useState("");

  const [search,   setSearch]   = useState("");
  const [filterSt, setFilterSt] = useState("all");

  const [pendingOrders,      setPendingOrders]      = useState([]);
  const [pendingAddrChanges, setPendingAddrChanges]  = useState([]);
  const [ordersBusyId,       setOrdersBusyId]        = useState(null);

  const [notifications,    setNotifications]    = useState([]);
  const [notifBusy,        setNotifBusy]        = useState(false);
  const [notifForm,        setNotifForm]        = useState({recipientMode:"select", statusFilter:"Active", clientIds:[], title:"", message:""});

  const refreshOrders = async () => {
    const [ords, addrs] = await Promise.all([getPendingOrders(), getPendingAddressChanges()]);
    setPendingOrders(ords || []);
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

  const notifRecipients = useMemo(() => {
    if (notifForm.recipientMode === "all") return clients.map(c => c.id);
    if (notifForm.recipientMode === "status") {
      if (notifForm.statusFilter === "Expired") return clients.filter(c => c.expiryDate && daysUntil(c.expiryDate) < 0).map(c => c.id);
      return clients.filter(c => c.status === notifForm.statusFilter).map(c => c.id);
    }
    return notifForm.clientIds;
  }, [notifForm.recipientMode, notifForm.statusFilter, notifForm.clientIds, clients]);

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

  const handleApproveOrder = async (order) => {
    setOrdersBusyId(order.id);
    try { await approveOrder(order); await refreshOrders(); }
    catch (e) { console.error(e); alert("Could not approve order."); }
    finally { setOrdersBusyId(null); }
  };
  const handleRejectOrder = async (order) => {
    const note = prompt("Reason for rejection (optional):") || "";
    setOrdersBusyId(order.id);
    try { await rejectOrder(order.id, note); await refreshOrders(); }
    catch (e) { console.error(e); alert("Could not reject order."); }
    finally { setOrdersBusyId(null); }
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
        const [pl, cl, mn, ms, ch, st, lib, curWeek, rotOrder] = await Promise.all([
          getPlans(), getClients(), getMenu(), getMealSelections(), getChecklist(),
          getSettings(["brochure_en","brochure_cn"]),
          getMealLibrary(),
          getCurrentWeekIndex(),
          getMenuRotationOrder(),
        ]);
        refreshOrders().catch(e => console.error(e));
        refreshNotifications().catch(e => console.error(e));
        // Populate ref immediately so mealName() works in useMemos
        mealLibraryRef.current = lib || [];
        setMealLibraryState(lib || []);
        setPdfUrls({en: st.brochure_en||"", cn: st.brochure_cn||""});
        setPlans(pl);
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
  }, [session]);

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
  const renewDue = useMemo(() => active.filter(c=>{ const d=daysUntil(c.expiryDate); return d>=0&&d<=2; }), [active]);
  const overdue  = useMemo(() => active.filter(c=>daysUntil(c.expiryDate)<0), [active]);
  const revenue  = useMemo(() => active.reduce((s,c)=>s+(c.planObj?.price||0),0), [active,plans]);
  const totalMl  = useMemo(() => active.reduce((s,c)=>s+(c.planObj?.meals||0),0)*5, [active,plans]);

  const filtered = useMemo(() => {
    let l = clients;
    if (filterSt!=="all") l=l.filter(c=>getRealStatus(c.startDate,c.expiryDate)===filterSt);
    if (search) l=l.filter(c=>
      c.name.toLowerCase().includes(search.toLowerCase())||
      (c.district||"").toLowerCase().includes(search.toLowerCase())||
      (c.planName||"").toLowerCase().includes(search.toLowerCase())
    );
    return l;
  }, [clients,filterSt,search]);

  // Extract size tag from plan name: "Big x 2" → "BIG", "Small x 1" → "SMALL", "Vegetarian x 1" → "VEG"
  const getPlanSize = (planName) => {
    if (!planName) return "";
    const lower = planName.toLowerCase();
    if (lower.includes("big")) return "BIG";
    if (lower.includes("small")) return "SMALL";
    if (lower.includes("vegetarian")) return "VEG";
    return "";
  };

  // Helper: resolve meal ID to name using mealLibraryRef
  const mealName = (id) => {
    if (!id) return "";
    const m = mealLibraryRef.current.find(m => m.id === id);
    return m ? m.name : id;
  };
  const getMealObj = (id) => id ? mealLibraryRef.current.find(m => m.id === id) || null : null;

  // Kitchen: aggregate meals by batch + size for each day
  const kitchen = useMemo(() => {
    const d = {};
    DAYS.forEach(day => {
      // key: "09:45__Minced Beef Bowl__BIG" → { count, who }
      const batches = {};
      BATCHES.forEach(b => { batches[b] = {}; });

      active.forEach(c => {
        const slots = meals[c.id]?.[day] || [];
        const size = getPlanSize(c.planName);
        const name = c.name.split(" ")[0];

        slots.forEach(slot => {
          const batch = getBatch(slot.time || "");

          (slot.meals||[]).filter(id => id && id.trim() && id !== "—").forEach(rawId => {
            const m = mealName(rawId) || rawId;
            const key = m + (size ? "__" + size : "");
            if (!batches[batch][key]) batches[batch][key] = { count: 0, who: [], meal: m, size };
            batches[batch][key].count++;
            batches[batch][key].who.push(name);
          });
          const snackName = slot.snackId ? mealName(slot.snackId) : (slot.snack||"");
          if (snackName && snackName !== "—") {
            const key = snackName + (size ? "__" + size : "");
            if (!batches[batch][key]) batches[batch][key] = { count: 0, who: [], meal: snackName, size };
            batches[batch][key].count++;
            batches[batch][key].who.push(name);
          }
        });
      });

      // Convert to sorted array per batch
      d[day] = BATCHES.map(b => ({
        time: b,
        items: Object.values(batches[b])
          .sort((a, bv) => bv.count - a.count)
          .map(({ meal, size, count, who }) => ({ meal, size, count, who })),
        total: Object.values(batches[b]).reduce((s, v) => s + v.count, 0),
      })).filter(b => b.items.length > 0);
    });
    return d;
  }, [active, meals, plans, mealLibraryState]);

  // Delivery: group by time, filtered by selected day
  const delivery = useMemo(() => {
    const allSlots = [];
    active.forEach(c => {
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
  }, [active, meals, deliveryDay, mealLibraryState]);

  // ── Handlers
  const togglePaid = async id => {
    const c = clients.find(x=>x.id===id);
    if (!c) return;
    const updated = {...c, paid:!c.paid, planId: c.planId||c.plan_id||""};
    setClients(p=>p.map(x=>x.id===id?updated:x));
    try { await upsertClient(updated); flash(); } catch(e){ console.error(e); }
  };

  const toggleCheck = async k => {
    const next = !checks[k];
    setChecks(p=>({...p,[k]:next}));
    try { await toggleChecklistItem(k, next); } catch(e){ console.error(e); }
  };

  const deleteClientHandler = async id => {
    if (!window.confirm("Delete this client?")) return;
    setClients(p=>p.filter(c=>c.id!==id));
    try { await dbDeleteClient(id); flash(); } catch(e){ console.error(e); }
  };

  const navTo = t => { setTab(t); setSbOpen(false); };

  // ── Meal slot handlers
  const addSlot = async (clientId, day) => {
    const existingSlots = meals[clientId]?.[day] || [];
    const nextSlot = existingSlots.length + 1;
    const newSlot = { id: uid(), slot: nextSlot, time: "", meals: [], snack: "", snackId: "", sauceIds: [], note: "" };
    setMeals(p => ({
      ...p,
      [clientId]: { ...p[clientId], [day]: [...(p[clientId]?.[day]||[]), newSlot] }
    }));
    try {
      await upsertMealSelection(clientId, day, nextSlot, { mealIds:[], deliveryTime:"", snackId:null, note:"" });
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
        amountPaid:   rawSaved.amount_paid     || 0,
        acqChannel:   rawSaved.acq_channel     || "",
        wechatOpenid: rawSaved.wechat_openid   || "",
        statusNote:   rawSaved.status_note     || "",
      };
      if (editClientId) {
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
  const openAddPlan  = () => { setEditPlanId(null); setPlanForm({...BLANK_PLAN,id:uid()}); setShowPlanModal(true); };
  const openEditPlan = p  => { setEditPlanId(p.id); setPlanForm({...p}); setShowPlanModal(true); };
  const pfld = (k,v) => setPlanForm(p=>({...p,[k]:v}));

  const savePlan = async () => {
    if (!planForm.name.trim()) return;
    try {
      const saved = await upsertPlan(planForm);
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

  // ── Menu modal
  const openEditMenu = day => {
    setMenuEditDay(day);
    const d0 = Object.values(menu).map(tm=>tm[day]).find(Boolean) || {};
    setMenuForm({meals:[...(d0.meals||[]).map(m=>typeof m==="object"?m.name:m),...["","",""]].slice(0,3),snack:d0.snack||""});
    setShowMenuModal(true);
  };
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
  const printDelivery = () => {
    const dayName = deliveryDay;
    const dateStr = new Date().toLocaleDateString("en-GB");
    const rows = Object.entries(delivery).flatMap(([time, slots]) =>
      slots.map(({client:c, slot}, i) => ({
        num: i+1,
        time,
        name: c.name,
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
    col.cc  { width: 9%; }
    col.ca  { width: 16%; }
    col.cm  { width: 30%; }
    col.cs  { width: 10%; }
    col.cno { width: 22%; }
    col.ck  { width: 4%; }

    thead tr { background: #1a1a1a; }
    th { color: #fff; padding: 6px 7px; text-align: left; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px; white-space: nowrap; }

    tbody tr:nth-child(odd)  td { background: #ffffff; }
    tbody tr:nth-child(even) td { background: #f0f2f5; }
    tbody tr { page-break-inside: avoid; }

    td { padding: 8px 7px; border-bottom: 1px solid #dde1e8; vertical-align: top; word-wrap: break-word; line-height: 1.35; }

    /* ── Cell styles ── */
    .cn-num  { font-weight: 900; font-size: 14px; color: #bbb; text-align: center; vertical-align: middle; }
    .ct-time { font-weight: 800; font-size: 12px; color: #e8342a; white-space: nowrap; vertical-align: middle; }
    .cc-name { font-weight: 800; font-size: 11.5px; }
    .cc-plan { font-size: 9px; color: #777; margin-top: 2px; }
    .ca-addr { font-size: 10.5px; font-weight: 600; }
    .ca-acc  { font-size: 9.5px; color: #999; margin-top: 3px; font-style: italic; }
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
      <col class="cn"><col class="ct"><col class="cc"><col class="ca">
      <col class="cm"><col class="cs"><col class="cno"><col class="ck">
    </colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th>Time</th>
        <th>Client</th>
        <th>Address &amp; Access</th>
        <th>Meals</th>
        <th>Snack</th>
        <th>Notes &amp; Allergies</th>
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
                  (m.sauce ? "<span class=\"meal-sauce\"> &mdash; " + m.sauce + "</span>" : "") +
                "</div>" +
              "</div>"
            ).join("")
          : "<span class=\"dash\">&mdash;</span>";
        return "<tr>" +
          "<td class=\"cn-num\">" + (i+1) + "</td>" +
          "<td class=\"ct-time\">" + r.time + "</td>" +
          "<td><div class=\"cc-name\">" + r.name + "</div><div class=\"cc-plan\">" + r.plan + "</div></td>" +
          "<td><div class=\"ca-addr\">" + r.address + "</div>" + accessHtml + "</td>" +
          "<td>" + mealsHtml + "</td>" +
          "<td class=\"snack-val\">" + (r.snack||"&mdash;") + "</td>" +
          "<td>" + notesCell + "</td>" +
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
    const allItems = {};
    batches.forEach(b => b.items.forEach(({meal,size,count}) => {
      const key = meal + (size ? "__" + size : "");
      allItems[key] = (allItems[key]||0) + count;
    }));
    const totalPortions = batches.reduce((s,b)=>s+b.total,0);

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210;
    let y = 0;

    // Header
    doc.setFillColor(232, 52, 42);
    doc.rect(0, 0, W, 18, "F");
    doc.setTextColor(255,255,255);
    doc.setFontSize(14); doc.setFont("helvetica","bold");
    doc.text("FIT IGNYTE — Kitchen Prep", 10, 12);
    doc.setFontSize(9); doc.setFont("helvetica","normal");
    doc.text(dayName + "  |  " + dateStr + "  |  " + totalPortions + " portions  |  " + batches.length + " batches", 10, 17);
    y = 24;

    const sizeColor = (size) => {
      if (size === "BIG")   return [251,146,60];
      if (size === "VEG")   return [74,222,128];
      if (size === "SMALL") return [96,165,250];
      return [150,150,150];
    };
    const sizeBg = (size) => {
      if (size === "BIG")   return [67,20,7];
      if (size === "VEG")   return [5,46,22];
      if (size === "SMALL") return [12,26,46];
      return [30,30,30];
    };

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

      batch.items.forEach(({meal,size,count,who},i) => {
        if (y > 275) { doc.addPage(); y = 10; }
        const rowH = 8;
        if (i%2===0) { doc.setFillColor(245,245,245); doc.rect(0,y,W,rowH,"F"); }
        // Count badge
        doc.setFillColor(232,52,42);
        doc.rect(8, y+1, 10, 6, "F");
        doc.setTextColor(255,255,255);
        doc.setFontSize(9); doc.setFont("helvetica","bold");
        doc.text(String(count), 13, y+5.5, {align:"center"});
        // Meal name
        doc.setTextColor(20,20,20);
        doc.setFont("helvetica","normal");
        doc.text(doc.splitTextToSize(meal, 100)[0], 22, y+5.5);
        // Size badge
        if (size) {
          const bg = sizeBg(size); const fg = sizeColor(size);
          doc.setFillColor(bg[0],bg[1],bg[2]);
          doc.rect(124, y+1.5, 14, 5, "F");
          doc.setTextColor(fg[0],fg[1],fg[2]);
          doc.setFontSize(7); doc.setFont("helvetica","bold");
          doc.text(size, 131, y+5.2, {align:"center"});
        }
        // Who
        doc.setTextColor(150,150,150);
        doc.setFontSize(7); doc.setFont("helvetica","normal");
        doc.text("→ " + who.join(", "), 140, y+5.5);
        y += rowH;
      });
      y += 4;
    });

    doc.save("kitchen-" + dayName.toLowerCase() + ".pdf");
  };

  const _sizeStyle = (size) => {
    if (size === "BIG") return "background:#431407;color:#fb923c;";
    if (size === "VEG") return "background:#052e16;color:#4ade80;";
    if (size === "SMALL") return "background:#0c1a2e;color:#60a5fa;";
    return "";
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
              {id:"orders",   ic:"◧",lbl:"Orders",         badge:(pendingOrders.length+pendingAddrChanges.length)||null},
              {id:"notifications",ic:"◔",lbl:"Notifications"},
              {id:"renewals", ic:"🔄",lbl:"Renewals",       badge:(renewDue.length+overdue.length)||null},
              {id:"payments", ic:"💳",lbl:"Payments",       badge:unpaid.length||null},
              {id:"plans",    ic:"🗂️", lbl:"Plans"},
              {id:"menu",     ic:"📋",lbl:"Menu Reference"},
            ].map(n=>(
              <button key={n.id} className={`ni${tab===n.id?" on":""}`} onClick={()=>navTo(n.id)}>
                <span className="ni-ic">{n.ic}</span>{n.lbl}
                {n.badge?<span className="ni-badge">{n.badge}</span>:null}
              </button>
            ))}
          </nav>
          <div className="sb-footer">
            <div className="sb-stat">Active clients: <strong>{active.length}</strong></div>
            <div className="sb-stat" style={{marginTop:6}}>Weekly revenue: <strong style={{color:"#22c55e"}}>¥{revenue}</strong></div>
            <button className="btn btn-g" style={{width:"100%",marginTop:14,padding:"11px 0",fontSize:13}} onClick={async()=>{await signOut(); setSession(null);}}>Log Out</button>
          </div>
        </div>

        {/* ── MAIN ── */}
        <div className="main">
          <div className="topbar">
            <div className="tb-title">
              {{dashboard:"Operations Dashboard",clients:"Client Master List",meals:"Weekly Meal Selections",kitchen:"Kitchen Prep Summary",delivery:"Delivery Sheet",orders:"Orders",notifications:"Notifications",renewals:"Renewal Tracker",payments:"Payment Tracker",plans:"Plans",menu:"Menu Reference"}[tab]}
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
              {tab==="plans"&&<button className="btn btn-r" onClick={openAddPlan}>+ New Plan</button>}
              {tab==="kitchen"&&(
                <div className="tabs" style={{margin:0,border:"none",paddingBottom:0}}>
                  {DAYS.map(d=><button key={d} className={`tab${kitDay===d?" on":""}`} onClick={()=>setKitDay(d)}>{d.slice(0,3)}</button>)}
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
                  {lbl:"Renewals ≤2d",   val:renewDue.length+overdue.length, sub:"includes overdue",                          c:"var(--amber)"},
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
                  <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Plan</th><th>¥/Wk</th><th>Status</th><th>Expiry</th><th>Paid</th><th>LTV</th><th>Actions</th></tr></thead>
                  <tbody>{filtered.map(c=>(
                    <tr key={c.id}>
                      <td style={{color:"var(--dim)",fontSize:10}}>{c.id}</td>
                      <td style={{color:"#fff",fontWeight:500,whiteSpace:"nowrap"}}>{c.name}</td>
                      <td style={{color:"var(--muted)"}}>{c.phone||"—"}</td>
                      <td><PlanBadge planName={c.planName} plans={plans}/></td>
                      <td style={{color:"var(--green)"}}>¥{plans.find(p=>p.name===c.planName)?.price||0}</td>
                      <td>{(()=>{
                        const rs = getRealStatus(c.startDate, c.expiryDate);
                        if (rs === "Active")   return <span className="bx bx-g">Active</span>;
                        if (rs === "Upcoming") return <span className="bx bx-a">Upcoming</span>;
                        return <span className="bx bx-gr">Inactive</span>;
                      })()}</td>
                      <td><RenewalBadge c={c}/></td>
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
                const planningClients = clients.filter(c => getRealStatus(c.startDate, c.expiryDate) !== "Inactive");
                const visibleClients  = planningClients.filter(c => clientActiveOnDay(c, mealDay));
                if (planningClients.length === 0) return (
                  <div className="empty-state"><div className="empty-state-icon">🍱</div><div className="empty-state-title">No active or upcoming clients</div><div className="empty-state-sub">Add clients to manage their meals</div></div>
                );
                if (visibleClients.length === 0) return (
                  <div className="empty-state"><div className="empty-state-icon">📅</div><div className="empty-state-title">No clients scheduled for {mealDay}</div><div className="empty-state-sub">All clients either haven't started yet or have expired for this day</div></div>
                );
                return visibleClients.map(c => {
                  const slots = meals[c.id]?.[mealDay] || [];
                  return (
                    <div className="client-card" key={c.id}>
                      <div className="client-card-hd">
                        <div className="client-card-name">{c.name}</div>
                        <PlanBadge planName={c.planName} plans={plans}/>
                        {getRealStatus(c.startDate,c.expiryDate)==="Upcoming"&&
                          <span className="bx bx-a" style={{fontSize:9}}>Upcoming · starts {fmtDate(c.startDate)}</span>}
                        {c.customizations&&<span style={{fontSize:10,color:"#fcd34d"}}>⚠️ {c.customizations}</span>}
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

                            {/* Meals — one select per meal, + add more */}
                            <div className="slot-field" style={{flex:2,minWidth:200}}>
                              <label>Meals</label>
                              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                                {(slot.meals||[""]).map((meal,mi)=>(
                                  <div key={mi} style={{display:"flex",gap:4,alignItems:"center"}}>
                                    <select className="msel" value={meal||""} onChange={e=>updateSlotMeal(c.id,mealDay,slot.id,mi,e.target.value)} style={{flex:2}}>
                                      <MealOptions menu={mergeAllWeeksMenu(menu)} clientTier={c.planObj?.tier||""} extraItems={customItems}/>
                                    </select>
                                    <select className="msel" style={{flex:1,fontSize:10}}
                                      value={(slot.sauceIds||[])[mi]||""}
                                      onChange={e=>{
                                        const sv=[...(slot.sauceIds||[])];
                                        while(sv.length<=mi) sv.push("");
                                        sv[mi]=e.target.value;
                                        updateSlot(c.id,mealDay,slot.id,"sauceIds",sv);
                                      }}>
                                      <option value="">— sauce —</option>
                                      {(()=>{
                                        const mealObj = mealLibraryState.find(m=>m.id===meal);
                                        const allowed = mealObj?.available_sauce_ids || [];
                                        return mealLibraryState
                                          .filter(m=>m.item_type==="sauce")
                                          .filter(s=>allowed.includes(s.id))
                                          .map(s=>(<option key={s.id} value={s.id}>{s.name}</option>));
                                      })()}
                                    </select>
                                    {(slot.meals||[]).length>1&&(
                                      <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none",padding:"2px 6px"}} onClick={()=>removeMealFromSlot(c.id,mealDay,slot.id,mi)}>✕</button>
                                    )}
                                  </div>
                                ))}
                                <button className="btn btn-g btn-xs" style={{alignSelf:"flex-start",marginTop:2}} onClick={()=>addMealToSlot(c.id,mealDay,slot.id)}>+ meal</button>
                              </div>
                            </div>

                            {/* Snack */}
                            <div className="slot-field slot-field-sm">
                              <label>Snack</label>
                              <select className="msel" value={slot.snackId||""} onChange={e=>updateSlot(c.id,mealDay,slot.id,"snackId",e.target.value)}>
                                <option value="">— none —</option>
                                {Object.values(DAYS.reduce((acc,d)=>{const s=Object.values(menu).map(tm=>tm[d]?.snackObj).find(Boolean);if(s?.id)acc[s.id]=s;return acc},{})).map(s=>(
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
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
                (kitchen[kitDay]||[]).map((batch,bi)=>(
                  <div key={batch.time} style={{marginBottom:16}}>
                    <div className="kd-hd" style={{borderRadius:"6px 6px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span>🔴 BATCH {batch.time}</span>
                      <span style={{fontSize:12,opacity:.85}}>{batch.total} portion{batch.total!==1?"s":""}</span>
                    </div>
                    {batch.items.map(({meal,size,count,who},i)=>(
                      <div className="kr" key={i} style={{background:i%2===0?"var(--s2)":"var(--s1)"}}>
                        <div className="kc">{count}</div>
                        <div className="km">{meal}</div>
                        {size&&<span style={{background:size==="BIG"?"#431407":size==="VEG"?"#052e16":"#0c1a2e",color:size==="BIG"?"#fb923c":size==="VEG"?"#4ade80":"#60a5fa",fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:4,marginLeft:8,flexShrink:0}}>{size}</span>}
                        <div className="kclients">→ {who.join(", ")}</div>
                      </div>
                    ))}
                  </div>
                ))
              )}

              {/* Day total summary */}
              {(kitchen[kitDay]||[]).length>0&&(()=>{
                const allItems = {};
                (kitchen[kitDay]||[]).forEach(b => b.items.forEach(({meal,size,count}) => {
                  const key = meal + (size ? "__" + size : "");
                  allItems[key] = (allItems[key]||0) + count;
                }));
                return (
                  <div style={{marginTop:8,marginBottom:20}}>
                    <div style={{background:"#0f0f0f",border:"1px solid var(--bdr)",borderRadius:"6px 6px 0 0",padding:"9px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:14,fontWeight:700,letterSpacing:1,color:"var(--dim)"}}>DAY TOTAL — {kitDay.toUpperCase()}</span>
                      <span style={{fontSize:11,color:"var(--dim)"}}>{Object.values(allItems).reduce((s,v)=>s+v,0)} portions</span>
                    </div>
                    {Object.entries(allItems).sort((a,b)=>b[1]-a[1]).map(([key,count],i)=>{
                      const parts = key.split("__");
                      const meal = parts[0];
                      const size = parts[1] || "";
                      return (
                        <div className="kr" key={i} style={{background:i%2===0?"var(--s2)":"var(--s1)"}}>
                          <div className="kc" style={{background:"#333",color:"#fff"}}>{count}</div>
                          <div className="km" style={{color:"#aaa"}}>{meal}</div>
                          {size&&<span style={{background:size==="BIG"?"#431407":size==="VEG"?"#052e16":"#0c1a2e",color:size==="BIG"?"#fb923c":size==="VEG"?"#4ade80":"#60a5fa",fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:4,marginLeft:8,flexShrink:0}}>{size}</span>}
                        </div>
                      );
                    })}
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
                  <div className="tbl-wrap"><table>
                    <thead><tr><th>#</th><th>Client</th><th>Plan</th><th>Address</th><th>Access</th><th>Meals</th><th>Snack</th><th>Note</th><th>Done</th></tr></thead>
                    <tbody>{entries.map(({client:c, day, slot},i)=>(
                      <tr key={slot.id}>
                        <td style={{color:"var(--dim)"}}>{i+1}</td>
                        <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                        <td><PlanBadge planName={c.planName} plans={plans}/></td>
                        <td style={{maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",color:"var(--muted)"}}>{c.address||"TBC"}</td>
                        <td style={{color:"var(--muted)",fontSize:10}}>{c.access||"—"}</td>
                        <td style={{maxWidth:180}}>
                          {(slot.meals||[]).filter(Boolean).map((m,i)=>(
                            <div key={i} style={{fontSize:10,color:"#ccc"}}>{mealName(m)||m}</div>
                          ))}
                        </td>
                        <td style={{fontSize:10,color:"var(--blue)"}}>{slot.snackId ? mealName(slot.snackId) : slot.snack||"—"}</td>
                        <td style={{color:"#fcd34d",fontSize:10}}>{slot.note||c.customizations||"—"}</td>
                        <td><button className={`bx bx-clk ${checks["d_"+slot.id]?"bx-g":"bx-gr"}`} onClick={()=>toggleCheck("d_"+slot.id)}>{checks["d_"+slot.id]?"✓ Done":"Pending"}</button></td>
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
                  <thead><tr><th>Client</th><th>Contact</th><th>Address</th><th>Plan</th><th>Goal / Allergies</th><th>Submitted</th><th>Action</th></tr></thead>
                  <tbody>
                    {pendingOrders.map(o=>(
                      <tr key={o.id}>
                        <td style={{color:"#fff",fontWeight:500}}>{o.name}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.phone||"—"}</td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.district} {o.address}</td>
                        <td><span className="bx bx-b">{plans.find(p=>p.id===o.plan_id)?.name||o.plan_id||"—"}</span></td>
                        <td style={{color:"var(--muted)",fontSize:11}}>{o.goal||"—"} / {o.allergies||"—"}</td>
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

            {/* ═══ RENEWALS ═══════════════════════════ */}
            {tab==="renewals"&&<>
              {overdue.length>0&&<>
                <div className="sec-title" style={{color:"#f87171",marginTop:0}}>⚠️ OVERDUE</div>
                <div className="tbl-wrap" style={{marginBottom:20}}><table>
                  <thead><tr><th>Client</th><th>Plan</th><th>Expired</th><th>Days Overdue</th><th>Paid</th><th>Action</th></tr></thead>
                  <tbody>{overdue.map(c=>(
                    <tr key={c.id}>
                      <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                      <td><PlanBadge planName={c.planName} plans={plans}/></td>
                      <td style={{color:"#f87171"}}>{fmtDate(c.expiryDate)}</td>
                      <td><span className="bx bx-r">{Math.abs(daysUntil(c.expiryDate))}d overdue</span></td>
                      <td><button className={`bx bx-clk ${c.paid?"bx-g":"bx-r"}`} onClick={()=>togglePaid(c.id)}>{c.paid?"Paid":"Unpaid"}</button></td>
                      <td><button className="btn btn-r btn-sm" onClick={()=>openEditClient(c)}>Renew Now</button></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </>}
              <div className="sec-title">Renewing Soon (≤2 days)</div>
              <div className="tbl-wrap" style={{marginBottom:20}}><table>
                <thead><tr><th>Client</th><th>Plan</th><th>Expiry</th><th>Days Left</th><th>Price</th><th>Paid?</th></tr></thead>
                <tbody>
                  {renewDue.map(c=>(
                    <tr key={c.id}>
                      <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                      <td><PlanBadge planName={c.planName} plans={plans}/></td>
                      <td style={{color:"var(--amber)"}}>{fmtDate(c.expiryDate)}</td>
                      <td><RenewalBadge c={c}/></td>
                      <td style={{color:"var(--green)"}}>¥{plans.find(p=>p.name===c.planName)?.price||0}</td>
                      <td><button className={`bx bx-clk ${c.paid?"bx-g":"bx-a"}`} onClick={()=>togglePaid(c.id)}>{c.paid?"✓ Paid":"Confirm"}</button></td>
                    </tr>
                  ))}
                  {renewDue.length===0&&<tr><td colSpan={6} style={{textAlign:"center",color:"var(--dim)",padding:20}}>No renewals due this week 🎉</td></tr>}
                </tbody>
              </table></div>
              <div className="sec-title">All Active — Full Status</div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>Client</th><th>Plan</th><th>Start</th><th>Expiry</th><th>Status</th><th>LTV</th><th>Weeks</th><th>Acq.</th></tr></thead>
                <tbody>{active.map(c=>(
                  <tr key={c.id}>
                    <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                    <td><PlanBadge planName={c.planName} plans={plans}/></td>
                    <td style={{color:"var(--muted)"}}>{fmtDate(c.startDate)}</td>
                    <td style={{color:"var(--muted)"}}>{fmtDate(c.expiryDate)}</td>
                    <td><RenewalBadge c={c}/></td>
                    <td style={{color:"var(--amber)"}}>¥{c.ltv}</td>
                    <td style={{color:"var(--muted)"}}>{c.weeks}wk</td>
                    <td style={{color:"var(--muted)",fontSize:10}}>{c.acqChannel||"—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>}

            {/* ═══ PAYMENTS ═══════════════════════════ */}
            {tab==="payments"&&<>
              <div className="kpis" style={{gridTemplateColumns:"repeat(3,1fr)"}}>
                {[
                  {lbl:"Collected This Week", val:`¥${active.filter(c=>c.paid).reduce((s,c)=>s+(c.planObj?.price||0),0)}`, c:"var(--green)"},
                  {lbl:"Pending / Unpaid",    val:`¥${unpaid.reduce((s,c)=>s+(c.planObj?.price||0),0)}`,                    c:"var(--amber)"},
                  {lbl:"Total LTV All Time",  val:`¥${clients.reduce((s,c)=>s+(c.ltv||0),0)}`,                                                    c:"var(--blue)"},
                ].map((k,i)=>(
                  <div className="kpi" key={i} style={{"--kc":k.c}}>
                    <div className="kpi-lbl">{k.lbl}</div>
                    <div className="kpi-val">{k.val}</div>
                  </div>
                ))}
              </div>
              {unpaid.length>0&&<>
                <div className="sec-title" style={{color:"#f87171"}}>Unpaid — Follow Up Now</div>
                <div className="tbl-wrap" style={{marginBottom:20}}><table>
                  <thead><tr><th>Client</th><th>Plan</th><th>Amount Due</th><th>Phone</th><th>District</th><th>Action</th></tr></thead>
                  <tbody>{unpaid.map(c=>(
                    <tr key={c.id}>
                      <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                      <td><PlanBadge planName={c.planName} plans={plans}/></td>
                      <td style={{color:"#f87171",fontWeight:600}}>¥{plans.find(p=>p.name===c.planName)?.price||0}</td>
                      <td style={{color:"var(--muted)"}}>{c.phone||"—"}</td>
                      <td><span className="chip">{c.district||"—"}</span></td>
                      <td><button className="btn btn-grn btn-sm" onClick={()=>togglePaid(c.id)}>Mark Paid</button></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </>}
              <div className="sec-title">All Active — Payment Status</div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>Client</th><th>Plan</th><th>Price/Wk</th><th>Paid</th><th>Amount</th><th>Expiry</th><th>Action</th></tr></thead>
                <tbody>{active.map(c=>(
                  <tr key={c.id}>
                    <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                    <td><PlanBadge planName={c.planName} plans={plans}/></td>
                    <td>¥{plans.find(p=>p.name===c.planName)?.price||0}</td>
                    <td><button className={`bx bx-clk ${c.paid?"bx-g":"bx-r"}`} onClick={()=>togglePaid(c.id)}>{c.paid?"✓ Paid":"Unpaid"}</button></td>
                    <td style={{color:"var(--green)"}}>¥{c.amountPaid}</td>
                    <td><RenewalBadge c={c}/></td>
                    <td><button className="btn btn-g btn-xs" onClick={()=>openEditClient(c)}>Edit</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>}

            {/* ═══ PLANS ════════════════════════════════ */}
            {tab==="plans"&&<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
                {plans.map(pd=>(
                  <div key={pd.id} className="plan-card" style={{"--pc":pd.color}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontSize:9,color:pd.color,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{pd.tier}</div>
                        <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:17,fontWeight:700,color:"#fff"}}>{pd.name}</div>
                        <div style={{fontSize:10,color:"var(--muted)",marginTop:2}}>~{pd.kcal?.toLocaleString()} kcal · {pd.meals} meal{pd.meals>1?"s":""}/day</div>
                      </div>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:24,fontWeight:800,color:pd.color}}>¥{pd.price}</div>
                    </div>
                    <div style={{fontSize:10,color:"var(--dim)",marginTop:6}}>{active.filter(c=>c.planName===pd.name).length} active client{active.filter(c=>c.planName===pd.name).length!==1?"s":""}</div>
                    <div style={{display:"flex",gap:6,marginTop:10}}>
                      <button className="btn btn-g btn-xs" onClick={()=>openEditPlan(pd)}>Edit</button>
                      <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>deletePlanHandler(pd.id)}>Delete</button>
                    </div>
                  </div>
                ))}
                {plans.length===0&&<div style={{color:"var(--dim)",fontSize:11,padding:20}}>No plans yet.</div>}
              </div>
            </>}

            {/* ═══ MENU ════════════════════════════════ */}
            {tab==="menu"&&<MenuTab
              menu={menu} plans={plans} active={active} currentWeekIndex={currentWeekIndex}
              rotationOrder={rotationOrder} saveRotationOrder={saveRotationOrder}
              upsertMenuDay={upsertMenuDay} flash={flash}
              openEditPlan={openEditPlan} deletePlanHandler={deletePlanHandler}
              mealLibraryRef={mealLibraryRef}
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
                <div className="fl"><label>Tier / Category</label><input className="inp" value={planForm.tier} onChange={e=>pfld("tier",e.target.value)} placeholder="e.g. Lean Fit"/></div>
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
              <div>
                <div className="sec-title" style={{marginBottom:8}}>Daily Snack</div>
                <input className="inp" placeholder="e.g. Hummus, PB Cookie…" value={menuForm.snack} onChange={e=>setMenuForm(p=>({...p,snack:e.target.value}))}/>
              </div>
            </div>
            <div className="mo-ft">
              <button className="btn btn-g" onClick={()=>setShowMenuModal(false)}>Cancel</button>
              <button className="btn btn-r" onClick={saveMenu}>Save Menu</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CUSTOM ITEM MODAL ═══════════════════════ */}
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
