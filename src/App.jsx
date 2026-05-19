// FitIgnyte.jsx — Full app connected to Supabase
import { useState, useEffect, useMemo } from "react";
import {
  getPlans, upsertPlan, deletePlan as dbDeletePlan,
  getClients, upsertClient, deleteClient as dbDeleteClient,
  getMenu, updateMenuDay,
  getMealSelections, upsertMealSelection,
  getChecklist, toggleChecklistItem,
} from "./lib/supabase";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PLAN_COLORS = ["#38BDF8","#A78BFA","#F472B6","#FBBF24","#FB923C","#F87171","#34D399","#60A5FA","#E879F9","#FCD34D"];
const uid = () => Math.random().toString(36).slice(2, 9);

const BLANK_CLIENT = {
  name:"", phone:"", language:"EN", district:"", address:"", access:"",
  deliveries:1, deliveryTime:"", plan:"", status:"Active",
  startDate:"", expiryDate:"", paid:false, amountPaid:0,
  goal:"", allergies:"", customizations:"", acqChannel:"", ltv:0, weeks:0,
};
const BLANK_PLAN = { id:"", name:"", kcal:0, meals:1, price:0, tier:"", color:"#38BDF8" };

// A delivery slot for a client on a given day
// { id, clientId, day, time, meals:[], snack:"", note:"" }

const TODAY     = new Date();
const daysUntil = d => Math.round((new Date(d) - TODAY) / 86400000);
const fmtDate   = d => { try { return new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); } catch { return d||"—"; } };
const todayIso  = () => TODAY.toISOString().split("T")[0];

// ─── STYLES ──────────────────────────────────────────────────────────────────
const G = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap');
:root{--bg:#0a0a0a;--s1:#111;--s2:#1a1a1a;--s3:#242424;--bdr:#2a2a2a;--bdr2:#333;--txt:#e8e8e8;--muted:#666;--dim:#444;--red:#E8342A;--red2:#ff4438;--green:#22c55e;--amber:#f59e0b;--blue:#38bdf8}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--txt)}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--red);border-radius:2px}
.app{display:flex;height:100vh;overflow:hidden}
.hamburger{display:none;position:fixed;top:12px;left:12px;z-index:400;background:var(--s2);border:1px solid var(--bdr2);border-radius:6px;padding:8px 10px;cursor:pointer;color:var(--txt);font-size:18px;line-height:1}
.sb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:150}
.sb{width:220px;min-width:220px;background:var(--s1);border-right:1px solid var(--bdr);display:flex;flex-direction:column;transition:transform .25s;z-index:200}
.sb-logo{padding:22px 18px 16px;border-bottom:1px solid var(--bdr)}
.sb-brand{font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:700;letter-spacing:2px}
.sb-brand span{color:var(--red)}
.sb-sub{font-size:9px;color:var(--muted);letter-spacing:3px;text-transform:uppercase;margin-top:1px}
.sb-week{margin:14px 18px;background:var(--s2);border:1px solid var(--bdr);border-radius:6px;padding:9px 12px}
.sb-week-lbl{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.sb-week-val{font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:600;color:var(--red);margin-top:2px}
.nav{flex:1;overflow-y:auto;padding:6px 0}
.ni{display:flex;align-items:center;gap:9px;width:100%;padding:10px 18px;background:none;border:none;border-left:3px solid transparent;color:var(--muted);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;text-align:left}
.ni:hover{color:var(--txt);background:var(--s2)}
.ni.on{color:#fff;background:var(--s2);border-left-color:var(--red)}
.ni-ic{font-size:15px;flex-shrink:0}
.ni-badge{margin-left:auto;background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px}
.sb-footer{padding:14px 18px;border-top:1px solid var(--bdr)}
.sb-stat{font-size:10px;color:var(--dim)}
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
  if (d <= 3) return <span className="bx bx-r">Expires {d}d</span>;
  if (d <= 7) return <span className="bx bx-a">Renew {d}d</span>;
  return <span className="bx bx-g">Active {d}d</span>;
}

// ─── MEAL OPTIONS BUILDER ─────────────────────────────────────────────────────
// Returns grouped <optgroup> options: all meals by day + all snacks + custom items
function MealOptions({ menu, extraItems = [] }) {
  const allSnacks = [...new Set(DAYS.map(d => menu[d]?.snack).filter(Boolean))];
  return (
    <>
      <option value="">— none —</option>
      {DAYS.map(day => {
        const meals = menu[day]?.meals || [];
        if (!meals.length) return null;
        return (
          <optgroup key={day} label={`── ${day} ──`}>
            {meals.map(m => <option key={m} value={m}>{m}</option>)}
          </optgroup>
        );
      })}
      <optgroup label="── Snacks ──">
        {allSnacks.map(s => <option key={s} value={s}>{s}</option>)}
      </optgroup>
      {extraItems.length > 0 && (
        <optgroup label="── Custom ──">
          {extraItems.map(i => <option key={i} value={i}>{i}</option>)}
        </optgroup>
      )}
    </>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [clients,    setClients]    = useState([]);
  // meals: { [clientId]: { [day]: [ {id, time, meals:[], snack, note} ] } }
  // Each day can have MULTIPLE delivery slots per client
  const [meals,      setMeals]      = useState({});
  const [menu,       setMenu]       = useState({});
  const [plans,      setPlans]      = useState([]);
  const [checks,     setChecks]     = useState({});
  // cookTimes: { Monday: "10:00", Tuesday: "09:30", ... }
  const [cookTimes,  setCookTimes]  = useState({});
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

  // ── Load
  useEffect(() => {
    (async () => {
      try {
        const [pl, cl, mn, ms, ch] = await Promise.all([
          getPlans(), getClients(), getMenu(), getMealSelections(), getChecklist(),
        ]);
        setPlans(pl);
        setClients(cl);
        setMenu(mn);
        // Convert DB format to multi-slot format
        const converted = {};
        for (const cid of Object.keys(ms)) {
          converted[cid] = {};
          for (const day of DAYS) {
            const row = ms[cid]?.[day];
            if (!row) { converted[cid][day] = []; continue; }
            if (Array.isArray(row)) { converted[cid][day] = row; continue; }
            // Serialized multi-slot format
            if (row.note === "__multi__") {
              try {
                const parsed = JSON.parse(row.meal1);
                converted[cid][day] = Array.isArray(parsed) ? parsed : [];
              } catch { converted[cid][day] = []; }
              continue;
            }
            // Old flat format -> single slot
            const mealsList = [row.meal1, row.meal2, row.meal3].filter(m => m && m !== "—");
            converted[cid][day] = (mealsList.length || row.snack) ? [{
              id: uid(), time: "",
              meals: mealsList.length ? mealsList : [""],
              snack: row.snack || "",
              note: row.note || "",
            }] : [];
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
  }, []);

  const flash = () => { setSaving(true); setTimeout(() => setSaving(false), 1800); };

  // Save cook times + custom items to localStorage when they change
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("fi_cooktimes",  JSON.stringify(cookTimes));
    localStorage.setItem("fi_customitems", JSON.stringify(customItems));
  }, [cookTimes, customItems, loaded]);

  // ── Derived
  const active   = useMemo(() => clients.filter(c=>c.status==="Active"), [clients]);
  const unpaid   = useMemo(() => active.filter(c=>!c.paid), [active]);
  const renewDue = useMemo(() => active.filter(c=>{ const d=daysUntil(c.expiryDate); return d>=0&&d<=7; }), [active]);
  const overdue  = useMemo(() => active.filter(c=>daysUntil(c.expiryDate)<0), [active]);
  const revenue  = useMemo(() => active.reduce((s,c)=>s+(plans.find(p=>p.name===c.plan)?.price||0),0), [active,plans]);
  const totalMl  = useMemo(() => active.reduce((s,c)=>s+(plans.find(p=>p.name===c.plan)?.meals||0),0)*5, [active,plans]);

  const filtered = useMemo(() => {
    let l = clients;
    if (filterSt!=="all") l=l.filter(c=>c.status===filterSt);
    if (search) l=l.filter(c=>
      c.name.toLowerCase().includes(search.toLowerCase())||
      (c.district||"").toLowerCase().includes(search.toLowerCase())||
      (c.plan||"").toLowerCase().includes(search.toLowerCase())
    );
    return l;
  }, [clients,filterSt,search]);

  // Kitchen: aggregate all meals across all slots for a given day
  const kitchen = useMemo(() => {
    const d = {};
    DAYS.forEach(day => {
      const map={}, who={};
      active.forEach(c => {
        const slots = meals[c.id]?.[day] || [];
        slots.forEach(slot => {
          (slot.meals||[]).forEach(m => {
            if (m && m!=="—") { map[m]=(map[m]||0)+1; (who[m]=who[m]||[]).push(c.name.split(" ")[0]); }
          });
          if (slot.snack && slot.snack!=="—") {
            map[slot.snack]=(map[slot.snack]||0)+1;
            (who[slot.snack]=who[slot.snack]||[]).push(c.name.split(" ")[0]);
          }
        });
      });
      d[day]=Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([meal,count])=>({meal,count,who:who[meal]}));
    });
    return d;
  }, [active, meals]);

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
  }, [active, meals, deliveryDay]);

  // ── Handlers
  const togglePaid = async id => {
    const c = clients.find(x=>x.id===id);
    if (!c) return;
    const updated = {...c, paid:!c.paid};
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
  const addSlot = (clientId, day) => {
    const newSlot = { id: uid(), time: "", meals: [""], snack: "", note: "" };
    setMeals(p => ({
      ...p,
      [clientId]: { ...p[clientId], [day]: [...(p[clientId]?.[day]||[]), newSlot] }
    }));
  };

  const removeSlot = (clientId, day, slotId) => {
    setMeals(p => ({
      ...p,
      [clientId]: { ...p[clientId], [day]: (p[clientId]?.[day]||[]).filter(s=>s.id!==slotId) }
    }));
  };

  const updateSlot = async (clientId, day, slotId, field, value) => {
    setMeals(p => {
      const slots = (p[clientId]?.[day]||[]).map(s =>
        s.id === slotId ? {...s, [field]: value} : s
      );
      return { ...p, [clientId]: { ...p[clientId], [day]: slots } };
    });
    // Persist — save the entire day's slots as JSON in the note field
    // We use a special encoding via upsertMealSelection
    try {
      const updated = meals[clientId]?.[day]?.map(s =>
        s.id === slotId ? {...s, [field]: value} : s
      ) || [];
      // Store serialized slots in meal1 field as JSON, meal2/3 unused
      await upsertMealSelection(clientId, day, {
        meal1: JSON.stringify(updated),
        meal2: "—", meal3: "—", snack: "", note: "__multi__"
      });
    } catch(e){ console.error(e); }
  };

  const updateSlotMeal = async (clientId, day, slotId, mealIndex, value) => {
    setMeals(p => {
      const slots = (p[clientId]?.[day]||[]).map(s => {
        if (s.id !== slotId) return s;
        const newMeals = [...(s.meals||[])];
        newMeals[mealIndex] = value;
        return {...s, meals: newMeals};
      });
      return { ...p, [clientId]: { ...p[clientId], [day]: slots } };
    });
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
      const saved = await upsertClient(clientForm);
      if (editClientId) {
        setClients(p=>p.map(c=>c.id===editClientId?saved:c));
      } else {
        setClients(p=>[...p,saved]);
        const defaultMeals = {};
        for (const day of DAYS) {
          defaultMeals[day] = [];
          await upsertMealSelection(saved.id, day, { meal1:"", meal2:"—", meal3:"—", snack:"", note:"" });
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
    try { await dbDeletePlan(id); flash(); } catch(e){ console.error(e); }
  };

  // ── Menu modal
  const openEditMenu = day => {
    setMenuEditDay(day);
    setMenuForm({meals:[...(menu[day]?.meals||["","",""])],snack:menu[day]?.snack||""});
    setShowMenuModal(true);
  };
  const saveMenu = async () => {
    try {
      const [meal1,meal2,meal3,...rest] = menuForm.meals;
      await updateMenuDay(menuEditDay, {
        meal1:meal1||"", meal2:meal2||"", meal3:meal3||"", snack:menuForm.snack||""
      });
      setMenu(p=>({...p,[menuEditDay]:{meals:menuForm.meals.filter(Boolean),snack:menuForm.snack}}));
      setShowMenuModal(false); flash();
    } catch(e){ console.error(e); }
  };

  const CHECKLIST = [
    {k:"f1",day:"FRIDAY",   t:"Send WeChat to all clients — confirm next week attendance"},
    {k:"f2",day:"FRIDAY",   t:"Ask clients if they want to swap meals next week"},
    {k:"f3",day:"FRIDAY",   t:"Flag renewals due — check Renewals tab"},
    {k:"f4",day:"FRIDAY",   t:"Send payment reminders for unpaid clients"},
    {k:"s1",day:"SAT / SUN",t:"Update Meal Selections with confirmed client choices"},
    {k:"s2",day:"SAT / SUN",t:"Confirm all payments received — mark paid"},
    {k:"s3",day:"SAT / SUN",t:"Add new clients to system with full details"},
    {k:"m1",day:"MONDAY",   t:"Print Kitchen Prep sheet and give to kitchen team"},
    {k:"m2",day:"MONDAY",   t:"Print Delivery Sheet and give to driver (sorted by time)"},
    {k:"m3",day:"MONDAY",   t:"Confirm all boxes labeled: name + meal + day"},
    {k:"d1",day:"DAILY",    t:"Mark deliveries done — note any issues"},
    {k:"d2",day:"DAILY",    t:"Respond to client messages within 2 hours"},
  ];

  const nowStr = TODAY.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});

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
              {id:"renewals", ic:"🔄",lbl:"Renewals",       badge:(renewDue.length+overdue.length)||null},
              {id:"payments", ic:"💳",lbl:"Payments",       badge:unpaid.length||null},
              {id:"menu",     ic:"📋",lbl:"Menu Reference"},
              {id:"workflow", ic:"✅",lbl:"Weekly Checklist"},
            ].map(n=>(
              <button key={n.id} className={`ni${tab===n.id?" on":""}`} onClick={()=>navTo(n.id)}>
                <span className="ni-ic">{n.ic}</span>{n.lbl}
                {n.badge?<span className="ni-badge">{n.badge}</span>:null}
              </button>
            ))}
          </nav>
          <div className="sb-footer">
            <div className="sb-stat">Active clients: <strong>{active.length}</strong></div>
            <div className="sb-stat" style={{marginTop:4}}>Weekly revenue: <strong style={{color:"#22c55e"}}>¥{revenue}</strong></div>
          </div>
        </div>

        {/* ── MAIN ── */}
        <div className="main">
          <div className="topbar">
            <div className="tb-title">
              {{dashboard:"Operations Dashboard",clients:"Client Master List",meals:"Weekly Meal Selections",kitchen:"Kitchen Prep Summary",delivery:"Delivery Sheet",renewals:"Renewal Tracker",payments:"Payment Tracker",menu:"Menu Reference",workflow:"Weekly Checklist"}[tab]}
            </div>
            <div className="tb-right">
              {tab==="clients"&&<>
                <input className="srch" placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}/>
                <select className="fltr" value={filterSt} onChange={e=>setFilterSt(e.target.value)}>
                  <option value="all">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Paused">Paused</option>
                </select>
                <button className="btn btn-r" onClick={openAddClient}>+ New Client</button>
              </>}
              {tab==="meals"&&<>
                <button className="btn btn-g btn-sm" onClick={()=>setShowCustomItemModal(true)}>+ Custom Meal</button>
              </>}
              {tab==="menu"&&<button className="btn btn-r" onClick={openAddPlan}>+ New Plan</button>}
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
                  {lbl:"Active Clients", val:active.length,  sub:`${clients.filter(c=>c.status!=="Active").length} inactive`, c:"var(--red)"},
                  {lbl:"Weekly Revenue", val:`¥${revenue}`,  sub:"this week",                                                  c:"var(--green)"},
                  {lbl:"Unpaid",         val:unpaid.length,  sub:unpaid.length?"Follow up":"All paid ✓",                      c:unpaid.length?"var(--amber)":"var(--green)"},
                  {lbl:"Renewals ≤7d",   val:renewDue.length+overdue.length, sub:"includes overdue",                          c:"var(--amber)"},
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
                    <table><thead><tr><th>Client</th><th>Plan</th><th>Paid</th><th>Renewal</th></tr></thead>
                    <tbody>{active.map(c=>(
                      <tr key={c.id}>
                        <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                        <td><PlanBadge planName={c.plan} plans={plans}/></td>
                        <td><button className={`bx bx-clk ${c.paid?"bx-g":"bx-r"}`} onClick={()=>togglePaid(c.id)}>{c.paid?"✓ Paid":"Unpaid"}</button></td>
                        <td><RenewalBadge c={c}/></td>
                      </tr>
                    ))}</tbody></table>
                  )}
                </div>
                <div className="panel" style={{padding:14}}>
                  <div className="sec-title" style={{marginBottom:12}}>Plan Distribution</div>
                  {plans.map(pd=>{
                    const cnt=active.filter(c=>c.plan===pd.name).length;
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
                <div className="tbl-wrap"><table>
                  <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Lang</th><th>District</th><th>Plan</th><th>¥/Wk</th><th>Status</th><th>Expiry</th><th>Paid</th><th>LTV</th><th>Actions</th></tr></thead>
                  <tbody>{filtered.map(c=>(
                    <tr key={c.id}>
                      <td style={{color:"var(--dim)"}}>{c.id}</td>
                      <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                      <td style={{color:"var(--muted)"}}>{c.phone||"—"}</td>
                      <td><span className="bx bx-gr">{c.language}</span></td>
                      <td><span className="chip">{c.district||"—"}</span></td>
                      <td><PlanBadge planName={c.plan} plans={plans}/></td>
                      <td style={{color:"var(--green)"}}>¥{plans.find(p=>p.name===c.plan)?.price||0}</td>
                      <td>{c.status==="Active"?<span className="bx bx-g">Active</span>:c.status==="Paused"?<span className="bx bx-a">Paused</span>:<span className="bx bx-gr">Inactive</span>}</td>
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
              {active.length===0?(
                <div className="empty-state"><div className="empty-state-icon">🍱</div><div className="empty-state-title">No active clients</div><div className="empty-state-sub">Add clients to manage their meals</div></div>
              ):(
                active.map(c => {
                  const slots = meals[c.id]?.[mealDay] || [];
                  return (
                    <div className="client-card" key={c.id}>
                      <div className="client-card-hd">
                        <div className="client-card-name">{c.name}</div>
                        <PlanBadge planName={c.plan} plans={plans}/>
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
                                    <select className="msel" value={meal||""} onChange={e=>updateSlotMeal(c.id,mealDay,slot.id,mi,e.target.value)} style={{flex:1}}>
                                      <MealOptions menu={menu} extraItems={customItems}/>
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
                              <select className="msel" value={slot.snack||""} onChange={e=>updateSlot(c.id,mealDay,slot.id,"snack",e.target.value)}>
                                <option value="">— none —</option>
                                {[...new Set(DAYS.map(d=>menu[d]?.snack).filter(Boolean))].map(s=>(
                                  <option key={s} value={s}>{s}</option>
                                ))}
                                {customItems.map(i=><option key={i} value={i}>{i}</option>)}
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
                })
              )}
            </>}

            {/* ═══ KITCHEN ════════════════════════════ */}
            {tab==="kitchen"&&<>
              {/* Summary bar */}
              {(()=>{
                const totalPortions = kitchen[kitDay]?.reduce((s,r)=>s+r.count,0)||0;
                const clientsToday  = active.filter(c=>(meals[c.id]?.[kitDay]||[]).length>0).length;
                const alertCount    = active.filter(c=>c.customizations||c.allergies).length;
                return (
                  <div style={{background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:8,padding:"14px 18px",marginBottom:14,display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
                    <div>
                      <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>Start Cooking At</div>
                      <input
                        className="cook-time-inp"
                        type="time"
                        value={cookTimes[kitDay]||""}
                        onChange={e=>setCookTimes(p=>({...p,[kitDay]:e.target.value}))}
                        placeholder="--:--"
                        style={{fontSize:20,fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:"var(--red)",background:"transparent",border:"none",outline:"none",padding:0,width:90}}
                      />
                    </div>
                    <div style={{width:1,height:36,background:"var(--bdr)",flexShrink:0}}/>
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
                      <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>Allergy Alerts</div>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:24,fontWeight:700,color:alertCount?"var(--amber)":"var(--dim)"}}>{alertCount}{alertCount>0?" ⚠️":""}</div>
                    </div>
                  </div>
                );
              })()}

              <div className="kd-hd">
                <span>{kitDay.toUpperCase()}</span>
                <span style={{fontSize:12,opacity:.85}}>{kitchen[kitDay]?.reduce((s,r)=>s+r.count,0)||0} total portions</span>
              </div>
              {(kitchen[kitDay]||[]).map(({meal,count,who},i)=>(
                <div className="kr" key={i} style={{background:i%2===0?"var(--s2)":"var(--s1)"}}>
                  <div className="kc">{count}</div>
                  <div className="km">{meal}</div>
                  <div className="kclients">→ {who.join(", ")}</div>
                </div>
              ))}
              {(!kitchen[kitDay]||kitchen[kitDay].length===0)&&<div className="kr" style={{justifyContent:"center",color:"var(--dim)"}}>No selections for this day</div>}

              <div className="sec-title" style={{marginTop:20}}>Allergy & Customization Alerts</div>
              {active.filter(c=>c.customizations||c.allergies).length===0?(
                <div className="tbl-wrap"><div style={{padding:16,textAlign:"center",color:"var(--dim)",fontSize:11}}>No alerts</div></div>
              ):(
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Client</th><th>Plan</th><th>Allergies</th><th>Customizations</th><th>Access</th></tr></thead>
                  <tbody>{active.filter(c=>c.customizations||c.allergies).map(c=>(
                    <tr key={c.id}>
                      <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                      <td><PlanBadge planName={c.plan} plans={plans}/></td>
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
              <div className="alert-bar" style={{background:"#0d1a0d",borderColor:"#14532d",color:"#86efac"}}>
                🛵 Sorted by delivery time. Each slot shown separately.
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
                        <td><PlanBadge planName={c.plan} plans={plans}/></td>
                        <td style={{maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",color:"var(--muted)"}}>{c.address||"TBC"}</td>
                        <td style={{color:"var(--muted)",fontSize:10}}>{c.access||"—"}</td>
                        <td style={{maxWidth:180}}>
                          {(slot.meals||[]).filter(Boolean).map((m,i)=>(
                            <div key={i} style={{fontSize:10,color:"#ccc"}}>{m}</div>
                          ))}
                        </td>
                        <td style={{fontSize:10,color:"var(--blue)"}}>{slot.snack||"—"}</td>
                        <td style={{color:"#fcd34d",fontSize:10}}>{slot.note||c.customizations||"—"}</td>
                        <td><button className={`bx bx-clk ${checks["d_"+slot.id]?"bx-g":"bx-gr"}`} onClick={()=>toggleCheck("d_"+slot.id)}>{checks["d_"+slot.id]?"✓ Done":"Pending"}</button></td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </div>
              ))}
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
                      <td><PlanBadge planName={c.plan} plans={plans}/></td>
                      <td style={{color:"#f87171"}}>{fmtDate(c.expiryDate)}</td>
                      <td><span className="bx bx-r">{Math.abs(daysUntil(c.expiryDate))}d overdue</span></td>
                      <td><button className={`bx bx-clk ${c.paid?"bx-g":"bx-r"}`} onClick={()=>togglePaid(c.id)}>{c.paid?"Paid":"Unpaid"}</button></td>
                      <td><button className="btn btn-r btn-sm" onClick={()=>openEditClient(c)}>Renew Now</button></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </>}
              <div className="sec-title">Renewing This Week (≤7 days)</div>
              <div className="tbl-wrap" style={{marginBottom:20}}><table>
                <thead><tr><th>Client</th><th>Plan</th><th>Expiry</th><th>Days Left</th><th>Next Week Price</th><th>Paid?</th></tr></thead>
                <tbody>
                  {renewDue.map(c=>(
                    <tr key={c.id}>
                      <td style={{color:"#fff",fontWeight:500}}>{c.name}</td>
                      <td><PlanBadge planName={c.plan} plans={plans}/></td>
                      <td style={{color:"var(--amber)"}}>{fmtDate(c.expiryDate)}</td>
                      <td><RenewalBadge c={c}/></td>
                      <td style={{color:"var(--green)"}}>¥{plans.find(p=>p.name===c.plan)?.price||0}</td>
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
                    <td><PlanBadge planName={c.plan} plans={plans}/></td>
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
                  {lbl:"Collected This Week", val:`¥${active.filter(c=>c.paid).reduce((s,c)=>s+(plans.find(p=>p.name===c.plan)?.price||0),0)}`, c:"var(--green)"},
                  {lbl:"Pending / Unpaid",    val:`¥${unpaid.reduce((s,c)=>s+(plans.find(p=>p.name===c.plan)?.price||0),0)}`,                    c:"var(--amber)"},
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
                      <td><PlanBadge planName={c.plan} plans={plans}/></td>
                      <td style={{color:"#f87171",fontWeight:600}}>¥{plans.find(p=>p.name===c.plan)?.price||0}</td>
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
                    <td><PlanBadge planName={c.plan} plans={plans}/></td>
                    <td>¥{plans.find(p=>p.name===c.plan)?.price||0}</td>
                    <td><button className={`bx bx-clk ${c.paid?"bx-g":"bx-r"}`} onClick={()=>togglePaid(c.id)}>{c.paid?"✓ Paid":"Unpaid"}</button></td>
                    <td style={{color:"var(--green)"}}>¥{c.amountPaid}</td>
                    <td><RenewalBadge c={c}/></td>
                    <td><button className="btn btn-g btn-xs" onClick={()=>openEditClient(c)}>Edit</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>}

            {/* ═══ MENU ════════════════════════════════ */}
            {tab==="menu"&&<>
              <div className="sec-title" style={{marginBottom:12}}>Available Plans</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12,marginBottom:24}}>
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
                    <div style={{fontSize:10,color:"var(--dim)",marginTop:6}}>{active.filter(c=>c.plan===pd.name).length} active client{active.filter(c=>c.plan===pd.name).length!==1?"s":""}</div>
                    <div style={{display:"flex",gap:6,marginTop:10}}>
                      <button className="btn btn-g btn-xs" onClick={()=>openEditPlan(pd)}>Edit</button>
                      <button className="btn btn-xs" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>deletePlanHandler(pd.id)}>Delete</button>
                    </div>
                  </div>
                ))}
                {plans.length===0&&<div style={{color:"var(--dim)",fontSize:11,padding:20}}>No plans yet.</div>}
              </div>
              <div className="sec-title">This Week's Menu</div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>Slot</th>{DAYS.map(d=><th key={d} style={{color:"var(--red)"}}>{d}</th>)}<th>Edit</th></tr></thead>
                <tbody>
                  {["Meal 1","Meal 2","Meal 3","Snack"].map((slot,si)=>(
                    <tr key={slot}>
                      <td><span className="bx bx-r">{slot}</span></td>
                      {DAYS.map(day=>{
                        const val=slot==="Snack"?menu[day]?.snack:(menu[day]?.meals[si]||"—");
                        return <td key={day} style={{fontSize:11,color:"#ccc"}}>{val||"—"}</td>;
                      })}
                      {si===0&&(
                        <td rowSpan={4} style={{verticalAlign:"middle"}}>
                          {DAYS.map(d=>(
                            <button key={d} className="btn btn-g btn-xs" style={{display:"block",marginBottom:4,width:"100%"}} onClick={()=>openEditMenu(d)}>
                              ✏️ {d.slice(0,3)}
                            </button>
                          ))}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>}

            {/* ═══ WORKFLOW ════════════════════════════ */}
            {tab==="workflow"&&<>
              <div className="alert-bar" style={{background:"#0a1020",borderColor:"#1e3a5f",color:"#93c5fd"}}>
                ✅ Click circles to check off tasks. Saved automatically.
              </div>
              {["FRIDAY","SAT / SUN","MONDAY","DAILY"].map(day=>(
                <div key={day} style={{marginBottom:20}}>
                  <div className="sec-title" style={{marginTop:0}}>{day}</div>
                  <div className="tbl-wrap" style={{padding:"2px 14px"}}>
                    {CHECKLIST.filter(t=>t.day===day).map(t=>(
                      <div key={t.k} className="chkrow">
                        <div className={`chk${checks[t.k]?" done":""}`} onClick={()=>toggleCheck(t.k)}>
                          {checks[t.k]&&<span style={{color:"#fff",fontSize:9}}>✓</span>}
                        </div>
                        <span style={{textDecoration:checks[t.k]?"line-through":"none",color:checks[t.k]?"var(--dim)":"var(--muted)"}}>{t.t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>}

          </div>
        </div>
      </div>

      {/* ═══ CLIENT MODAL ════════════════════════════ */}
      {showClientModal&&(
        <div className="mo" onClick={e=>{if(e.target===e.currentTarget)setShowClientModal(false);}}>
          <div className="mo-box">
            <div className="mo-hd">
              <div className="mo-title">{editClientId?"Edit Client":"New Client"}</div>
              <button className="btn btn-g btn-sm" onClick={()=>setShowClientModal(false)}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fg">
                {[
                  ["name",         "Full Name *",               "text",     "fg-full"],
                  ["phone",        "Phone / WeChat",            "text",     ""],
                  ["language",     "Language",                  "sel:EN,CN",""],
                  ["district",     "District / Area",           "text",     ""],
                  ["address",      "Delivery Address",          "text",     "fg-full"],
                  ["access",       "Building / Access Notes",   "text",     "fg-full"],
                  ["deliveryTime", "Default Delivery Time",     "text",     ""],
                  ["deliveries",   "Deliveries / Day",          "number",   ""],
                  ["plan",         "Plan",                      "sel_plans",""],
                  ["status",       "Status",                    "sel:Active,Inactive,Paused,Trial",""],
                  ["startDate",    "Start Date",                "date",     ""],
                  ["expiryDate",   "Expiry Date",               "date",     ""],
                  ["paid",         "Paid This Week?",           "sel_paid", ""],
                  ["amountPaid",   "Amount Paid (¥)",           "number",   ""],
                  ["goal",         "Goal",                      "text",     ""],
                  ["allergies",    "Allergies / Restrictions",  "text",     ""],
                  ["customizations","Permanent Customizations", "text",     "fg-full"],
                  ["acqChannel",   "Acquisition Channel",       "text",     ""],
                ].map(([k,lbl,type,cls])=>(
                  <div key={k} className={`fl ${cls}`}>
                    <label>{lbl}</label>
                    {type==="sel_plans"?(
                      <select className="sel" value={clientForm[k]||""} onChange={e=>cfld(k,e.target.value)}>
                        <option value="">— Select plan —</option>
                        {plans.map(p=><option key={p.id} value={p.name}>{p.name} · ¥{p.price}/wk</option>)}
                      </select>
                    ):type==="sel_paid"?(
                      <select className="sel" value={String(clientForm[k])} onChange={e=>cfld(k,e.target.value==="true")}>
                        <option value="true">Yes, paid</option>
                        <option value="false">No</option>
                      </select>
                    ):type.startsWith("sel:")?(
                      <select className="sel" value={clientForm[k]||""} onChange={e=>cfld(k,e.target.value)}>
                        {type.slice(4).split(",").map(opt=><option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ):(
                      <input className="inp" type={type} value={clientForm[k]||""} onChange={e=>{
                        let v=e.target.value;
                        if(type==="number") v=v===""?"":Number(v);
                        cfld(k,v);
                      }}/>
                    )}
                  </div>
                ))}
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
