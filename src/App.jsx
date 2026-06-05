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

function MenuTab({ menu, plans, active, upsertMenuDay, flash, openEditPlan, deletePlanHandler }) {
  const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
  const [menuTab,      setMenuTab]      = useState("library");
  const [showAddMeal,  setShowAddMeal]  = useState(false);
  const [mealForm,     setMealForm]     = useState({name:"",sauce:"",kcal:"",protein:"",carbs:"",fat:"",photoUrl:""});
  const [draggingMeal, setDraggingMeal] = useState(null);
  const [dragOver,     setDragOver]     = useState(null);
  const [extraRows,    setExtraRows]    = useState(0);
  const [mealLibrary,  setMealLibrary]  = useState([]);
  const [savingMeal,   setSavingMeal]   = useState(false);

  // Load meal library from Supabase on mount
  useEffect(()=>{
    import("./lib/supabase").then(({getMealLibrary})=>{
      getMealLibrary().then(data=>setMealLibrary(data||[])).catch(console.error);
    });
  },[]);

  // allMeals = meal_library + any snacks from weekly menu not already in library
  const allMeals = useMemo(()=>{
    const libNames = new Set(mealLibrary.map(m=>m.name));
    const snacks = [];
    DAYS.forEach(d=>{
      const s=menu[d]?.snack;
      if(s&&s!=="—"&&!libNames.has(s)) snacks.push({name:s,source:"snack",id:null});
    });
    return [
      ...mealLibrary.map(m=>({...m,source:m.sauce?"meal":"meal"})).sort((a,b)=>a.name.localeCompare(b.name)),
      ...snacks
    ];
  },[mealLibrary, menu]);

  const saveMealToLibrary = async () => {
    if(!mealForm.name.trim()){alert("Meal name is required");return;}
    setSavingMeal(true);
    try {
      const {upsertMealLibrary} = await import("./lib/supabase");
      const payload = {
        name: mealForm.name.trim(),
        sauce: mealForm.sauce||"",
        kcal: parseInt(mealForm.kcal)||0,
        protein: parseInt(mealForm.protein)||0,
        carbs: parseInt(mealForm.carbs)||0,
        fat: parseInt(mealForm.fat)||0,
      };
      if(editingMealId) payload.id = editingMealId;
      const saved = await upsertMealLibrary(payload);
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
    if(!confirm(`Delete "${name}"?`)) return;
    try {
      const {deleteMealLibrary} = await import("./lib/supabase");
      await deleteMealLibrary(id);
      setMealLibrary(p=>p.filter(m=>m.id!==id));
      flash();
    } catch(e){ console.error(e); }
  };

  const [editingMealId, setEditingMealId] = useState(null);

  const openEditMeal = (m) => {
    setEditingMealId(m.id);
    setMealForm({name:m.name,sauce:m.sauce||"",kcal:m.kcal||"",protein:m.protein||"",carbs:m.carbs||"",fat:m.fat||"",photoUrl:""});
    setShowAddMeal(true);
  };

  const handlePhotoDrop = (e) => {
    e.preventDefault();
    const file=e.dataTransfer?.files[0]||e.target?.files?.[0];
    if(file&&file.type.startsWith("image/")){
      setMealForm(p=>({...p,photoUrl:URL.createObjectURL(file)}));
    }
  };

  const handleAssignMeal = (day, slot) => {
    if(!draggingMeal) return;
    const isSnack=slot==="Snack";
    const si=isSnack?null:parseInt(slot.replace("Meal ",""))-1;
    const dm=menu[day]||{meals:[],snack:""};
    const newMeals=[...(dm.meals||[])];
    // Extend array if needed
    while(!isSnack && newMeals.length<=si) newMeals.push("");
    if(isSnack){upsertMenuDay(day,{meals:newMeals,snack:draggingMeal});}
    else{newMeals[si]=draggingMeal;upsertMenuDay(day,{meals:newMeals,snack:dm.snack||""});}
    setDraggingMeal(null); setDragOver(null);
  };

  return <>
    <div style={{display:"flex",gap:8,marginBottom:20}}>
      <button className={`btn btn-sm ${menuTab==="library"?"btn-r":"btn-g"}`} onClick={()=>setMenuTab("library")} style={{flex:1}}>🍽️ Meal Library</button>
      <button className={`btn btn-sm ${menuTab==="planner"?"btn-r":"btn-g"}`} onClick={()=>setMenuTab("planner")} style={{flex:1}}>📅 Weekly Planner</button>
    </div>

    {menuTab==="library"&&<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div className="sec-title" style={{marginBottom:0}}>All Meals ({allMeals.length})</div>
        <button className="btn btn-r btn-sm" onClick={()=>{setMealForm({name:"",sauce:"",kcal:"",protein:"",carbs:"",fat:"",photoUrl:""});setEditingMealId(null);setShowAddMeal(true);}}>+ Add Meal</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
        {allMeals.map((m,i)=>(
          <div key={m.id||i} draggable onDragStart={()=>setDraggingMeal(m.name)} onDragEnd={()=>setDraggingMeal(null)}
            style={{overflow:"hidden",borderRadius:10,border:`1px solid ${m.source==="snack"?"#166534":"var(--bdr)"}`,background:"var(--s2)",cursor:"grab",userSelect:"none",position:"relative"}}>
            {m.id&&<button onClick={e=>{e.stopPropagation();deleteMealFromLibrary(m.id,m.name);}}
              style={{position:"absolute",top:5,left:5,background:"rgba(0,0,0,0.7)",border:"none",color:"#f87171",width:20,height:20,borderRadius:"50%",cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>✕</button>}
            <div style={{width:"100%",height:90,background:"var(--s3)",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",borderBottom:"1px solid var(--bdr)"}}>
              <span style={{fontSize:10,color:"var(--dim)"}}>No photo yet</span>
              <span style={{position:"absolute",top:5,right:5,fontSize:8,background:"var(--s1)",color:m.source==="snack"?"#4ade80":"var(--muted)",padding:"2px 5px",borderRadius:3,border:"1px solid var(--bdr)"}}>{m.source==="snack"?"SNACK":"MEAL"}</span>
            </div>
            <div style={{padding:"8px 10px"}}>
              <div style={{fontSize:11,fontWeight:600,color:"#fff",marginBottom:2}}>{m.name}</div>
              {m.sauce&&<div style={{fontSize:9,color:"var(--muted)",marginBottom:1}}>{m.sauce}</div>}
              {m.kcal>0&&<div style={{fontSize:9,color:"var(--dim)"}}>{m.kcal} kcal · {m.protein}P {m.carbs}C {m.fat}F</div>}
              {!m.kcal&&<div style={{fontSize:9,color:"var(--muted)"}}>Drag to planner →</div>}
              {m.id&&<button onClick={e=>{e.stopPropagation();openEditMeal(m);}}
                style={{marginTop:6,background:"var(--s3)",border:"1px solid var(--bdr)",color:"var(--muted)",fontSize:9,padding:"3px 8px",borderRadius:5,cursor:"pointer",width:"100%"}}>
                ✏️ Edit
              </button>}
            </div>
          </div>
        ))}
        {allMeals.length===0&&<div style={{color:"var(--dim)",fontSize:11,padding:20,gridColumn:"1/-1"}}>No meals yet. Click + Add Meal to get started.</div>}
      </div>
    </>}

    {menuTab==="planner"&&<>
      <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
        <div style={{width:200,flexShrink:0}}>
          <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:700}}>Drag meals →</div>
          <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:560,overflowY:"auto",paddingRight:4}}>
            {allMeals.map((m,i)=>(
              <div key={i} draggable onDragStart={()=>setDraggingMeal(m.name)} onDragEnd={()=>setDraggingMeal(null)}
                style={{background:draggingMeal===m.name?"var(--red)":"var(--s2)",border:`1px solid ${m.source==="snack"?"#166534":"var(--bdr)"}`,borderRadius:8,padding:"10px 12px",fontSize:11,color:draggingMeal===m.name?"#fff":m.source==="snack"?"#4ade80":"#ccc",cursor:"grab",userSelect:"none",lineHeight:1.3,transition:"background .15s",wordBreak:"break-word"}}>
                {m.source==="snack"&&<span style={{fontSize:8,color:"#4ade80",display:"block",marginBottom:2,letterSpacing:1,fontWeight:700}}>SNACK</span>}
                {m.name}
              </div>
            ))}
            {allMeals.length===0&&<div style={{fontSize:10,color:"var(--dim)",padding:8}}>Add meals in Library first</div>}
          </div>
        </div>
        <div style={{flex:1,overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
            <thead><tr>
              <th style={{width:50,padding:"5px 6px",textAlign:"left",color:"var(--muted)",fontSize:9,fontWeight:700}}>Slot</th>
              {DAYS.map(d=><th key={d} style={{padding:"5px 4px",color:"var(--red)",fontSize:9,fontWeight:700,textAlign:"center"}}>{d.slice(0,3)}</th>)}
            </tr></thead>
            <tbody>
              {[...["Meal 1","Meal 2","Meal 3"],...Array.from({length:extraRows},(_,i)=>`Meal ${4+i}`),"Snack"].map((slot,si)=>{
                const isSnack=slot==="Snack";
                const mealIdx=isSnack?null:parseInt(slot.replace("Meal ",""))-1;
                return (
                <tr key={slot}>
                  <td style={{padding:"3px 6px",color:"var(--dim)",fontSize:9,fontWeight:700,whiteSpace:"nowrap"}}>{slot}</td>
                  {DAYS.map(day=>{
                    const val=isSnack?menu[day]?.snack:(menu[day]?.meals?.[mealIdx]||"");
                    const isOver=dragOver===`${day}-${slot}`;
                    return (
                      <td key={day}
                        onDragOver={e=>{e.preventDefault();setDragOver(`${day}-${slot}`);}}
                        onDragLeave={()=>setDragOver(null)}
                        onDrop={()=>handleAssignMeal(day,slot)}
                        style={{padding:3}}>
                        <div title={val||""}
                          style={{background:isOver?"rgba(232,52,42,0.15)":val?"var(--s2)":"var(--s3)",border:`1px ${isOver?"solid":"dashed"} ${isOver?"var(--red)":val?"var(--bdr)":"#333"}`,borderRadius:5,padding:"6px 5px",minHeight:56,fontSize:9,color:val?"#ccc":"var(--dim)",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3}}>
                          <span style={{width:"100%",textAlign:"center",lineHeight:1.3,wordBreak:"break-word"}}>{val||<span style={{fontSize:8,color:"#333"}}>Drop</span>}</span>
                          {val&&<span style={{fontSize:8,color:"var(--dim)",cursor:"pointer",marginTop:2}}
                            onClick={()=>{const nm=[...(menu[day]?.meals||[])];if(isSnack){upsertMenuDay(day,{meals:nm,snack:""});}else{nm[mealIdx]="";upsertMenuDay(day,{meals:nm.filter(Boolean),snack:menu[day]?.snack||""});}}}>
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
                    <button className="btn btn-g btn-sm" onClick={()=>setExtraRows(r=>r+1)} style={{flex:1}}>
                      + Add Meal Row
                    </button>
                    {extraRows>0&&<button className="btn btn-sm" style={{background:"#450a0a",color:"#f87171",border:"none"}} onClick={()=>setExtraRows(r=>r-1)}>
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

    {showAddMeal&&(
      <div className="mo" onClick={()=>{setShowAddMeal(false);setEditingMealId(null);}}>
        <div className="mo-box" onClick={e=>e.stopPropagation()}>
          <div className="mo-hd"><div className="mo-title">{editingMealId?"Edit Meal":"Add New Meal"}</div><button className="mo-close" onClick={()=>{setShowAddMeal(false);setEditingMealId(null);}}>✕</button></div>
          <div onDragOver={e=>e.preventDefault()} onDrop={handlePhotoDrop}
            style={{border:"2px dashed var(--bdr)",borderRadius:10,height:130,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",marginBottom:16,background:"var(--s2)",cursor:"pointer",overflow:"hidden"}}
            onClick={()=>document.getElementById("meal-photo-inp").click()}>
            {mealForm.photoUrl
              ?<img src={mealForm.photoUrl} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="meal"/>
              :<><span style={{fontSize:26,marginBottom:5}}>📸</span><span style={{fontSize:11,color:"var(--muted)"}}>Drag & drop photo here</span><span style={{fontSize:10,color:"var(--dim)"}}>or click to browse</span></>}
            <input id="meal-photo-inp" type="file" accept="image/*" style={{display:"none"}} onChange={handlePhotoDrop}/>
          </div>
          <div style={{display:"grid",gap:10}}>
            <div><div className="form-label">Meal name *</div><input className="form-inp" value={mealForm.name} onChange={e=>setMealForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Minced Beef Bowl"/></div>
            <div><div className="form-label">Sauce</div><input className="form-inp" value={mealForm.sauce} onChange={e=>setMealForm(p=>({...p,sauce:e.target.value}))} placeholder="e.g. Chimichurri"/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
              {[["kcal","Kcal"],["protein","Protein g"],["carbs","Carbs g"],["fat","Fat g"]].map(([k,lbl])=>(
                <div key={k}><div className="form-label">{lbl}</div><input className="form-inp" type="number" value={mealForm[k]||""} onChange={e=>setMealForm(p=>({...p,[k]:e.target.value}))} placeholder="0"/></div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:16}}>
            <button className="btn btn-g" style={{flex:1}} onClick={()=>setShowAddMeal(false)}>Cancel</button>
            <button className="btn btn-r" style={{flex:1}} onClick={saveMealToLibrary} disabled={savingMeal}>
              {savingMeal?"Saving...":"Save Meal"}
            </button>
          </div>
        </div>
      </div>
    )}
  </>;
}

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
  const renewDue = useMemo(() => active.filter(c=>{ const d=daysUntil(c.expiryDate); return d>=0&&d<=2; }), [active]);
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

  // Extract size tag from plan name: "Big x 2" → "BIG", "Small x 1" → "SMALL", "Vegetarian x 1" → "VEG"
  const getPlanSize = (planName) => {
    if (!planName) return "";
    const lower = planName.toLowerCase();
    if (lower.includes("big")) return "BIG";
    if (lower.includes("small")) return "SMALL";
    if (lower.includes("vegetarian")) return "VEG";
    return "";
  };

  // Kitchen: aggregate meals by batch + size for each day
  const kitchen = useMemo(() => {
    const d = {};
    DAYS.forEach(day => {
      // key: "09:45__Minced Beef Bowl__BIG" → { count, who }
      const batches = {};
      BATCHES.forEach(b => { batches[b] = {}; });

      active.forEach(c => {
        const slots = meals[c.id]?.[day] || [];
        const size = getPlanSize(c.plan);
        const name = c.name.split(" ")[0];

        slots.forEach(slot => {
          const batch = getBatch(slot.time || "");

          (slot.meals||[]).filter(m => m && m !== "—").forEach(m => {
            const key = m + (size ? "__" + size : "");
            if (!batches[batch][key]) batches[batch][key] = { count: 0, who: [], meal: m, size };
            batches[batch][key].count++;
            batches[batch][key].who.push(name);
          });
          if (slot.snack && slot.snack !== "—") {
            const key = slot.snack + (size ? "__" + size : "");
            if (!batches[batch][key]) batches[batch][key] = { count: 0, who: [], meal: slot.snack, size };
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
  }, [active, meals, plans]);

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
    // Calculate updated slots BEFORE setMeals (state not updated yet)
    const updated = (meals[clientId]?.[day]||[]).map(s =>
      s.id === slotId ? {...s, [field]: value} : s
    );
    setMeals(p => ({
      ...p,
      [clientId]: { ...p[clientId], [day]: updated }
    }));
    try {
      await upsertMealSelection(clientId, day, {
        meal1: JSON.stringify(updated),
        meal2: "—", meal3: "—", snack: "", note: "__multi__"
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
    setMeals(p => ({
      ...p,
      [clientId]: { ...p[clientId], [day]: updated }
    }));
    try {
      await upsertMealSelection(clientId, day, {
        meal1: JSON.stringify(updated),
        meal2: "—", meal3: "—", snack: "", note: "__multi__"
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

  const upsertMenuDay = async (day, {meals, snack}) => {
    try {
      const [meal1,meal2,meal3] = meals;
      await updateMenuDay(day, {meal1:meal1||"",meal2:meal2||"",meal3:meal3||"",snack:snack||""});
      setMenu(p=>({...p,[day]:{meals:meals.filter(Boolean),snack:snack||""}}));
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
        plan: c.plan,
        address: c.address || "TBC",
        access: c.access || "—",
        meals: (slot.meals||[]).filter(Boolean),
        snack: slot.snack || "—",
        note: slot.note || c.customizations || "—",
      }))
    );

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Delivery Sheet — ${dayName}</title>
  <style>
    body { font-family: Arial, 'Microsoft YaHei', sans-serif; font-size: 9px; margin: 8px; color: #111; }
    h1 { font-size: 14px; margin: 0 0 2px; }
    h2 { font-size: 9px; color: #666; margin: 0 0 10px; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    col.c0  { width: 3%; }
    col.c1  { width: 6%; }
    col.c2  { width: 9%; }
    col.c3  { width: 9%; }
    col.c4  { width: 16%; }
    col.c5  { width: 8%; }
    col.c6  { width: 30%; }
    col.c7  { width: 7%; }
    col.c8  { width: 9%; }
    col.c9  { width: 3%; }
    th { background: #111; color: #fff; padding: 4px 5px; text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: .5px; }
    td { padding: 4px 5px; border-bottom: 1px solid #e0e0e0; vertical-align: top; font-size: 8.5px; word-wrap: break-word; }
    tr:nth-child(even) td { background: #f7f7f7; }
    .time { font-weight: bold; color: #e8342a; white-space: nowrap; }
    .name { font-weight: bold; }
    .note { color: #b45309; font-style: italic; }
    .meal { display: block; line-height: 1.4; }
    .check { width: 14px; height: 14px; border: 1.5px solid #aaa; display: inline-block; }
    @media print { body { margin: 5px; } button { display: none; } }
  </style>
</head>
<body>
  <h1>🔥 FIT IGNYTE — Delivery Sheet</h1>
  <h2>${dayName} &nbsp;·&nbsp; ${dateStr} &nbsp;·&nbsp; ${rows.length} stop${rows.length!==1?"s":""}</h2>
  <table>
    <colgroup>
      <col class="c0"><col class="c1"><col class="c2"><col class="c3"><col class="c4">
      <col class="c5"><col class="c6"><col class="c7"><col class="c8"><col class="c9">
    </colgroup>
    <thead>
      <tr><th>#</th><th>Time</th><th>Client</th><th>Plan</th><th>Address</th><th>Access</th><th>Meals</th><th>Snack</th><th>Notes</th><th>✓</th></tr>
    </thead>
    <tbody>
      ${rows.map((r,i) => `
        <tr>
          <td>${i+1}</td>
          <td class="time">${r.time}</td>
          <td class="name">${r.name}</td>
          <td>${r.plan}</td>
          <td>${r.address}</td>
          <td>${r.access}</td>
          <td>${r.meals.map(m=>`<span class="meal">• ${m}</span>`).join("") || "—"}</td>
          <td>${r.snack}</td>
          <td class="note">${r.note}</td>
          <td><span class="check"></span></td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "delivery-" + dayName.toLowerCase() + ".html";
    a.click();
    URL.revokeObjectURL(url);
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
              {id:"plans",    ic:"🗂️", lbl:"Plans"},
              {id:"menu",     ic:"📋",lbl:"Menu Reference"},
              {id:"workflow", ic:"✅",lbl:"Weekly Checklist"},
              {id:"wechat",   ic:"💬",lbl:"WeChat Messages"},
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
              {{dashboard:"Operations Dashboard",clients:"Client Master List",meals:"Weekly Meal Selections",kitchen:"Kitchen Prep Summary",delivery:"Delivery Sheet",renewals:"Renewal Tracker",payments:"Payment Tracker",plans:"Plans",menu:"Menu Reference",workflow:"Weekly Checklist"}[tab]}
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
                  {lbl:"Active Clients", val:active.length,  sub:`${clients.filter(c=>c.status!=="Active").length} inactive`, c:"var(--red)"},
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
                        <td><PlanBadge planName={c.plan} plans={plans}/></td>
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
              <div className="sec-title">Renewing Soon (≤2 days)</div>
              <div className="tbl-wrap" style={{marginBottom:20}}><table>
                <thead><tr><th>Client</th><th>Plan</th><th>Expiry</th><th>Days Left</th><th>Price</th><th>Paid?</th></tr></thead>
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
                    <div style={{fontSize:10,color:"var(--dim)",marginTop:6}}>{active.filter(c=>c.plan===pd.name).length} active client{active.filter(c=>c.plan===pd.name).length!==1?"s":""}</div>
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
              menu={menu} plans={plans} active={active}
              upsertMenuDay={upsertMenuDay} flash={flash}
              openEditPlan={openEditPlan} deletePlanHandler={deletePlanHandler}
            />}

            {/* ═══ WECHAT ═════════════════════════════ */}
            {tab==="wechat"&&<>
              {/* ── MSG 1: Weekly Menu Broadcast ── */}
              <div className="sec-title" style={{marginTop:0}}>📋 Weekly Menu Broadcast</div>
              <div style={{background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:8,padding:16,marginBottom:20}}>
                <p style={{fontSize:11,color:"var(--muted)",marginBottom:12}}>Copy this message and send it to all clients on Friday to confirm next week.</p>
                {(()=>{
                  const lines = ["🔥 FIT IGNYTE — This Week's Menu", ""];
                  DAYS.forEach(day => {
                    const meals = (menu[day]?.meals||[]).filter(Boolean);
                    const snack = menu[day]?.snack || "";
                    lines.push(`📅 ${day}`);
                    meals.forEach((m,i) => lines.push(`  Meal ${i+1}: ${m}`));
                    if (snack) lines.push(`  Snack: ${snack}`);
                    lines.push("");
                  });
                  lines.push("Reply with your choices by Friday! 💪");
                  lines.push("Any customizations? Let us know 🙏");
                  const text = lines.join("\n");
                  return (
                    <div>
                      <pre style={{background:"var(--s3)",border:"1px solid var(--bdr)",borderRadius:6,padding:14,fontSize:11,color:"#ccc",whiteSpace:"pre-wrap",wordBreak:"break-word",marginBottom:12,lineHeight:1.6}}>{text}</pre>
                      <button className="btn btn-r" onClick={()=>{navigator.clipboard.writeText(text);alert("Copied to clipboard!");}}>📋 Copy Message</button>
                    </div>
                  );
                })()}
              </div>

              {/* ── MSG 2: Payment Reminder per client ── */}
              <div className="sec-title">💳 Payment Reminder Messages</div>
              <div style={{background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:8,padding:16,marginBottom:20}}>
                <p style={{fontSize:11,color:"var(--muted)",marginBottom:12}}>One message per unpaid client. Copy and send individually on WeChat.</p>
                {unpaid.length===0?(
                  <div style={{color:"var(--green)",fontSize:11,fontWeight:600}}>✓ All clients have paid this week!</div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {unpaid.map(c=>{
                      const price = plans.find(p=>p.name===c.plan)?.price||0;
                      const lines = [
                        `Hi ${c.name.split(" ")[0]}! 👋`,
                        ``,
                        `Just a reminder that your FIT IGNYTE payment is due.`,
                        ``,
                        `📋 Plan: ${c.plan}`,
                        `💰 Amount: ¥${price}`,
                        ``,
                        `Please transfer before Monday so we can confirm your meals for next week.`,
                        `Thank you! 🙏💪`,
                      ].join("");
                      return (
                        <div key={c.id} style={{background:"var(--s3)",border:"1px solid var(--bdr)",borderRadius:6,padding:12}}>
                          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                            <span style={{color:"#fff",fontWeight:600,fontSize:12}}>{c.name}</span>
                            <PlanBadge planName={c.plan} plans={plans}/>
                            <span style={{color:"#f87171",fontSize:11,fontWeight:600}}>¥{price}</span>
                          </div>
                          <pre style={{background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:5,padding:10,fontSize:11,color:"#ccc",whiteSpace:"pre-wrap",wordBreak:"break-word",marginBottom:8,lineHeight:1.6}}>{lines}</pre>
                          <button className="btn btn-g btn-sm" onClick={()=>{navigator.clipboard.writeText(lines);alert("Copied!");}}>📋 Copy</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── MSG 3: Delivery Confirmation per client ── */}
              <div className="sec-title">🛵 Delivery Confirmation Messages</div>
              <p style={{fontSize:11,color:"var(--muted)",marginBottom:12}}>Send to each client when their delivery is on the way. Select a day first.</p>
              <div className="tabs" style={{marginBottom:16}}>
                {DAYS.map(d=><button key={d} className={`tab${mealDay===d?" on":""}`} onClick={()=>setMealDay(d)}>{d}</button>)}
              </div>
              {active.length===0?(
                <div className="empty-state"><div className="empty-state-icon">💬</div><div className="empty-state-title">No active clients</div></div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {active.map(c=>{
                    const slots = meals[c.id]?.[mealDay]||[];
                    if (!slots.length) return null;
                    return slots.map(slot=>{
                      const mealsList = (slot.meals||[]).filter(Boolean);
                      const lines = [
                        `🛵 Your FIT IGNYTE delivery is on the way!`,
                        ``,
                        `Hi ${c.name.split(" ")[0]}! 👋`,
                        ``,
                        `📦 Today's order:`,
                        ...mealsList.map(m=>`  • ${m}`),
                        slot.snack ? `  • Snack: ${slot.snack}` : "",
                        slot.time  ? `⏰ ETA: ${slot.time}` : "",
                        ``,
                        `Enjoy your meal! 💪🔥`,
                      ].filter(l=>l!==undefined);
                      const text = lines.join("\n");
                      return (
                        <div key={slot.id} style={{background:"var(--s2)",border:"1px solid var(--bdr)",borderRadius:8,padding:14}}>
                          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                            <span style={{color:"#fff",fontWeight:600,fontSize:12}}>{c.name}</span>
                            <PlanBadge planName={c.plan} plans={plans}/>
                            {slot.time&&<span className="bx bx-b">🕐 {slot.time}</span>}
                          </div>
                          <pre style={{background:"var(--s3)",border:"1px solid var(--bdr)",borderRadius:6,padding:12,fontSize:11,color:"#ccc",whiteSpace:"pre-wrap",wordBreak:"break-word",marginBottom:10,lineHeight:1.6}}>{text}</pre>
                          <button className="btn btn-g btn-sm" onClick={()=>{navigator.clipboard.writeText(text);alert("Copied!");}}>📋 Copy</button>
                        </div>
                      );
                    });
                  })}
                  {active.every(c=>!(meals[c.id]?.[mealDay]||[]).length)&&(
                    <div style={{color:"var(--dim)",fontSize:11,padding:20,textAlign:"center"}}>No delivery slots added for {mealDay} yet.</div>
                  )}
                </div>
              )}
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
