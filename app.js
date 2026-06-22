/* ============================================================
   ROXIUM CLIENT PORTAL · app.js
   Front end: Netlify (static) · Backend: Supabase (auth + db + RLS)
   ============================================================ */

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const FIELDS = [
  {k:'spend', l:'Ad spend ($)'}, {k:'impr', l:'Impressions'}, {k:'clicks', l:'Clicks'},
  {k:'lpv', l:'Landing page visits'}, {k:'leads', l:'Leads captured'},
  {k:'cons', l:'Booked consultations'}, {k:'proc', l:'Procedures booked'},
  {k:'apv', l:'Avg procedure value ($)'}, {k:'price', l:'Pricing index (×)'},
  {k:'sent', l:'Emails sent'}, {k:'opens', l:'Emails opened'}, {k:'eclk', l:'Email clicks'},
  {k:'sms', l:'SMS reply rate (0–1)', pct:true}, {k:'vid', l:'Video view rate (0–1)', pct:true},
  {k:'foll', l:'Qualified followers'}, {k:'rank', l:'Social rank index (×)'}, {k:'posts', l:'Cadence posts'},
];
const XL_MAP = {
  'Ad spend (all channels)':'spend','Impressions & reach':'impr','Clicks':'clicks',
  'Landing page visits':'lpv','Leads captured (form + email)':'leads','Booked consultations':'cons',
  'Procedures booked':'proc','Average procedure value':'apv','Surgery pricing index (baseline = 1.0x)':'price',
  'Emails sent':'sent','Emails opened':'opens','Email clicks':'eclk','SMS reply rate (enter as %)':'sms',
  'Video view rate (enter as %)':'vid','Qualified followers added':'foll',
  'Social rankings index (baseline = 1.0x)':'rank','Cadence posts published':'posts',
};
const STAGES = [['planned','Planned / Backlog'],['scheduled','Scheduled'],['pre_production','Pre-production'],['shot','Shot'],['editing','Editing'],['delivered','Delivered'],['posted','Posted']];
// Team-only SLA: an item >=3 days in its current stage warns (yellow), >=7 overdue (red). See slaState().

let me = null;            // profile row
let practiceId = null;    // active practice
let previewMode = false;  // team viewing the client-side version
let metricsPeriod = null; // null = follow latest reported month; or a 'YYYY-MM-01' period to view past data
let data = { kpi: [], deliv: [], miles: [], video: [], feed: [], vhist: [], notif: [], practice: null };

/* ---- KPI period helpers (period = first-of-month 'YYYY-MM-01' snapshot key) ---- */
const monthInputToPeriod = v => v ? v + '-01' : null;           // 'YYYY-MM' -> 'YYYY-MM-01'
const periodToMonthInput = p => p ? String(p).slice(0,7) : '';  // 'YYYY-MM-01' -> 'YYYY-MM'
const periodLabel = p => p
  ? new Date(p.length<=10 ? p+'T00:00:00' : p).toLocaleDateString(undefined,{month:'short',year:'numeric'})
  : '';
const currentPeriod = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const KPI_SOURCE = 'marketing'; // the source the team form reads/writes; other sources land via imports

// True only when the real user is team AND not previewing the client view.
function isTeamView(){ return me && me.role === 'team' && !previewMode; }

/* ---------------- auth ---------------- */
const $ = id => document.getElementById(id);

// Run a render step in isolation so one failing section can never blank the rest
// of the page (e.g. a throw in the deliverables wiring must not hide the pipeline
// or the performance metrics). Any failure is surfaced in the console.
function safe(label, fn){
  try { return fn(); }
  catch(e){ console.error(`[render] "${label}" failed:`, e); }
}

/* ---------------- tabbed views (hash router) ---------------- */
const VIEWS = ['roadmap','deliverables','video','metrics','updates','team'];
function currentView(){
  const h = (location.hash||'').replace('#','');
  return VIEWS.includes(h) ? h : 'roadmap';
}
function showView(name){
  if(!VIEWS.includes(name)) name = 'roadmap';
  if(name==='team' && !isTeamView()) name = 'roadmap';   // clients/preview can't open Team
  document.querySelectorAll('.view').forEach(v=> v.classList.toggle('active', v.dataset.view===name));
  document.querySelectorAll('.tab').forEach(t=> t.classList.toggle('active', t.dataset.view===name));
}
// Show/hide team-only chrome (Team tab + panel, preview button, client switcher)
// based on the *real* role and whether we're previewing as a client.
function syncChrome(){
  const realTeam = !!(me && me.role==='team');
  $('btnPreview').classList.toggle('hidden', !realTeam);
  $('practiceSwitcher').classList.toggle('hidden', !realTeam);
  const teamView = isTeamView();
  const teamTab = document.querySelector('.tab[data-view="team"]');
  if(teamTab) teamTab.classList.toggle('hidden', !teamView);
  $('teamPanel').classList.toggle('hidden', !teamView);
  if(!teamView && currentView()==='team') location.hash = '#roadmap';
}
window.addEventListener('hashchange', ()=> showView(currentView()));

/* ---------------- searchable client switcher (team) ---------------- */
let practicesList = [];
let switcherWired = false;
function buildSwitcher(list){
  practicesList = list || [];
  const cur = practicesList.find(p=>p.id===practiceId);
  $('practiceSearch').value = cur ? cur.name : '';
  if(switcherWired) return;
  switcherWired = true;
  const input = $('practiceSearch'), results = $('practiceResults');
  const draw = (q)=>{
    const ql = (q||'').trim().toLowerCase();
    const matches = practicesList.filter(p=> p.name.toLowerCase().includes(ql));
    results.innerHTML = matches.length
      ? matches.map(p=>`<button type="button" class="switcher-item${p.id===practiceId?' current':''}" data-id="${p.id}">${esc(p.name)}</button>`).join('')
      : '<div class="switcher-empty">No matches</div>';
    results.querySelectorAll('.switcher-item').forEach(b=> b.onclick = ()=>{
      practiceId = b.dataset.id;
      const p = practicesList.find(x=>x.id===practiceId);
      input.value = p ? p.name : '';
      results.classList.add('hidden');
      input.blur();
      loadAll();
    });
  };
  input.addEventListener('focus', ()=>{ input.select(); draw(''); results.classList.remove('hidden'); });
  input.addEventListener('input', ()=>{ draw(input.value); results.classList.remove('hidden'); });
  input.addEventListener('keydown', e=>{ if(e.key==='Escape'){ results.classList.add('hidden'); input.blur(); } });
  document.addEventListener('click', e=>{ if(!$('practiceSwitcher').contains(e.target)) results.classList.add('hidden'); });
}

// Team: (re)load every practice and refresh the switcher + the invite dropdown.
async function loadTeamPractices(){
  const { data: prax } = await sb.from('practices').select('*').order('name');
  const list = prax || [];
  buildSwitcher(list);
  const sel = $('inviteePractice');
  if(sel){
    const keep = sel.value;
    sel.innerHTML = list.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if(list.some(p=>p.id===keep)) sel.value = keep;
    else if(practiceId && list.some(p=>p.id===practiceId)) sel.value = practiceId;
  }
  return list;
}

// Single-shot boot so the initial getSession AND the onAuthStateChange event
// (which Supabase fires on load) can't both kick off afterLogin concurrently.
let booted = false;
async function boot(){
  if(booted) return;
  booted = true;
  try { await afterLogin(); }
  catch(e){ booted = false; console.error('[boot] afterLogin failed:', e); }
}

async function init(){
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ $('login').classList.remove('hidden'); return; }
  await boot();
}
// Never await Supabase calls directly inside the auth callback — that can stall
// the client. Defer to a fresh task and let boot() dedupe.
sb.auth.onAuthStateChange((_e, session)=>{ if(session && !me) setTimeout(boot, 0); });

$('btnLogin').onclick = async ()=>{
  const email = $('loginEmail').value.trim();
  if(!email) return;
  // Invite-only: shouldCreateUser:false means a magic link is only sent to users
  // who already exist (i.e. were invited by the team). Random emails get nothing.
  const { error } = await sb.auth.signInWithOtp({
    email, options:{ emailRedirectTo: location.origin, shouldCreateUser: false }
  });
  $('loginMsg').textContent = error
    ? (/not.*found|signups?.*disabled|user/i.test(error.message)
        ? "We couldn't find an invite for that email. Ask your ROXIUM lead to add you."
        : error.message)
    : 'Check your email for the sign-in link.';
};
$('btnLogout').onclick = async ()=>{ await sb.auth.signOut(); location.reload(); };

async function afterLogin(){
  const { data: prof, error } = await sb.from('profiles').select('*').eq('id', (await sb.auth.getUser()).data.user.id).single();
  if(error || !prof){
    $('login').classList.remove('hidden');
    $('loginMsg').textContent = 'Signed in, but no profile exists yet. Ask your ROXIUM lead to add you.';
    return;
  }
  me = prof;
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('whoami').textContent = (me.full_name||'') + ' · ' + me.role;

  if(me.role === 'team'){
    const prax = await loadTeamPractices();
    practiceId = prax && prax.length ? prax[0].id : null;
    $('btnPreview').onclick = ()=>{
      previewMode = !previewMode;
      $('btnPreview').textContent = previewMode ? 'Exit client preview' : 'Preview as client';
      $('btnPreview').classList.toggle('previewing', previewMode);
      $('whoami').textContent = (me.full_name||'') + ' · ' + (previewMode ? 'client preview' : me.role);
      syncChrome();
      showView(currentView());
      render();
    };
  } else {
    practiceId = me.practice_id;
  }
  syncChrome();
  showView(currentView());
  if(practiceId) loadAll();
}

/* ---------------- data ---------------- */
async function loadAll(){
  const [p,k,d,m,v,f,vh,nt] = await Promise.all([
    sb.from('practices').select('*').eq('id', practiceId).single(),
    // Read EVERY source (marketing / coefficient / asana …), not just one — the
    // Coefficient sync may land rows under 'coefficient'. mergeKpiByPeriod() folds
    // all sources for a month into one effective snapshot so the data always shows.
    sb.from('kpi_monthly').select('*').eq('practice_id', practiceId).order('period'),
    sb.from('deliverables').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('milestones').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('video_pipeline').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('activity').select('*').eq('practice_id', practiceId).order('created_at',{ascending:false}).limit(12),
    sb.from('video_history').select('*').eq('practice_id', practiceId).order('moved_at'),
    sb.from('notifications').select('*').eq('practice_id', practiceId).order('created_at',{ascending:false}).limit(10),
  ]);
  data = { practice:p.data, kpi:mergeKpiByPeriod(k.data||[]), deliv:d.data||[], miles:m.data||[], video:v.data||[], feed:f.data||[], vhist:vh.data||[], notif:nt.data||[] };
  render();
}

// Collapse multiple source rows for the same month into one effective snapshot.
// Non-null fields win; if two sources set the same field, the more recently
// updated row wins. Keeps the period model intact (one row per period downstream).
function mergeKpiByPeriod(rows){
  const byPeriod = new Map();
  const ordered = [...rows].sort((a,b)=> new Date(a.updated_at||0) - new Date(b.updated_at||0));
  for(const r of ordered){
    const cur = byPeriod.get(r.period) || { practice_id:r.practice_id, period:r.period };
    for(const key of Object.keys(r)){
      if(key==='id' || key==='source') continue;
      const val = r[key];
      if(val!==null && val!==undefined && val!=='') cur[key] = val;
    }
    byPeriod.set(r.period, cur);
  }
  return [...byPeriod.values()];
}

/* ---------------- derived metrics (same formulas as the workbook) ---------------- */
function derive(m){
  if(!m) return null;
  const n = k => +m[k]||0;
  return {
    ctr: n('impr')? n('clicks')/n('impr'):0, cvr: n('lpv')? n('leads')/n('lpv'):0,
    cpl: n('leads')? n('spend')/n('leads'):0, l2c: n('leads')? n('cons')/n('leads'):0,
    cpc: n('cons')? n('spend')/n('cons'):0, close: n('cons')? n('proc')/n('cons'):0,
    rev: n('proc')*n('apv'), roas: n('spend')? (n('proc')*n('apv'))/n('spend'):0,
    cpp: n('proc')? n('spend')/n('proc'):0, orate: n('sent')? n('opens')/n('sent'):0,
  };
}
const fmt$ = v=>'$'+Math.round(v).toLocaleString();
const fmtP = v=>(v*100).toFixed(1)+'%';
const statusCPL = v=> v===0?'i': v<=180?'g': v<=360?'a':'r';
const statusGen = (v,t)=> v===0?'i': v>=t?'g': v>=t*0.8?'a':'r';

/* ---------------- render ---------------- */
function render(){
  renderBanner();
  $('heroTitle').innerHTML = (data.practice? data.practice.name : 'Your practice') + ': where you are, <em>exactly.</em>';
  // newest → oldest by period (immutable monthly snapshots; never overwrite the past)
  const reported = [...data.kpi].sort((a,b)=> (a.period<b.period?1:a.period>b.period?-1:0));
  const latestPeriod = reported.length? reported[0].period : null;
  // metricsPeriod null = follow latest; otherwise show the chosen past month's snapshot
  const viewPeriod = (metricsPeriod!=null && data.kpi.some(x=>x.period===metricsPeriod)) ? metricsPeriod : latestPeriod;
  const latest = viewPeriod!=null ? data.kpi.find(x=>x.period===viewPeriod) : null;
  // the snapshot immediately before the viewed one — used for trend comparison
  const prev = latest ? reported.find(x=> x.period < latest.period) : null;
  const d = derive(latest);
  const isLive = viewPeriod===latestPeriod;
  $('updated').textContent = latest
    ? `Showing ${periodLabel(latest.period)}${isLive?' (live)':' (archived snapshot)'} · KPI data live from Supabase`
    : 'KPI data will appear here after the first month is reported.';
  // build the month selector (latest + any reported months)
  buildMetricsPicker(reported, viewPeriod, latestPeriod);
  $('kpiSub').textContent = latest? `${periodLabel(latest.period)} against target.` : 'Latest month against target.';

  // hero stats
  const delivered = data.deliv.filter(x=>x.status==='delivered').length;
  const heroes = [
    {v: d? fmt$(d.cpl):'—', l:'Cost per lead', cls: statusCPL(d? d.cpl:0), note: latest? 'this month':'awaiting data'},
    {v: latest? (+latest.cons||0).toLocaleString():'—', l:'Consults this month', cls: latest?'g':'i', note: d? fmt$(d.rev)+' est. revenue':'awaiting data'},
    {v: data.deliv.length? `${delivered}/${data.deliv.length}`:'—', l:'Deliverables shipped', cls: delivered? 'g':'i', note:'project progress'},
    {v: latest&&latest.price? (+latest.price).toFixed(2)+'×':'—', l:'Pricing index', cls: latest&&+latest.price>=1.5?'g':'i', note: latest? 'vs. starting baseline':'awaiting data'},
  ];
  $('heroStats').innerHTML = heroes.map(h=>
    `<div class="stat"><div class="v">${h.v}</div><div class="l">${h.l}</div><div class="d ${({g:'good',a:'warn',r:'bad',i:'idle'})[h.cls]}">${h.note}</div></div>`).join('');

  // timeline
  const isTeam = isTeamView();
  safe('timeline', ()=> renderTimeline(isTeam));

  // deliverables
  safe('deliverables', ()=>{
    const pct = data.deliv.length? Math.round(100*delivered/data.deliv.length):0;
    $('delivSub').textContent = data.deliv.length? `${delivered} of ${data.deliv.length} deliverables shipped (${pct}%).` : 'Deliverables will be loaded at kickoff.';
    $('delivBar').style.width = pct+'%';
    renderDeliverables(isTeam);
  });

  // video pipeline
  safe('video pipeline', ()=> renderPipeline(isTeam));

  // KPI cards + status board
  safe('performance metrics', ()=>{
    const dp = derive(prev);
    // delta vs the previous month's snapshot; lowerBetter flips colour for cost metrics
    const trend = (cur, before, opts={})=>{
      if(before==null || cur==null || !isFinite(+before) || !isFinite(+cur) || +before===0) return '';
      const pct = (cur-before)/Math.abs(before)*100;
      if(Math.abs(pct)<0.5) return `<div class="trend flat">±0% vs ${periodLabel(prev.period)}</div>`;
      const up = pct>0, good = opts.lowerBetter ? !up : up;
      return `<div class="trend ${good?'up':'down'}">${up?'▲':'▼'} ${Math.abs(pct).toFixed(0)}% vs ${periodLabel(prev.period)}</div>`;
    };
    const cards = [
      {k:'Leads captured', v: latest? (+latest.leads||0).toLocaleString():'—', t:'monthly volume', tr: trend(latest?+latest.leads||0:null, prev?+prev.leads||0:null)},
      {k:'LP conversion', v: d? fmtP(d.cvr):'—', t:'leads ÷ page visits', tr: trend(d?d.cvr:null, dp?dp.cvr:null)},
      {k:'Cost per consult', v: d? fmt$(d.cpc):'—', t:'spend ÷ consults', tr: trend(d?d.cpc:null, dp?dp.cpc:null, {lowerBetter:true})},
      {k:'ROAS', v: d&&d.roas? d.roas.toFixed(1)+'×':'—', t:'revenue ÷ spend', tr: trend(d?d.roas:null, dp?dp.roas:null)},
    ];
    $('kpiCards').innerHTML = cards.map(c=>`<div class="card"><div class="k">${c.k}</div><div class="big">${c.v}</div><div class="tgt">${c.t}</div>${c.tr||''}</div>`).join('');
    const rows = latest? [
      ['Cost per lead', fmt$(d.cpl), statusCPL(d.cpl)],
      ['LP conversion', fmtP(d.cvr), statusGen(d.cvr,.04)],
      ['Ad CTR', fmtP(d.ctr), statusGen(d.ctr,.012)],
      ['Email open rate', fmtP(d.orate), statusGen(d.orate,.28)],
      ['Close rate', fmtP(d.close), statusGen(d.close,.35)],
      ['Social rank index', (+latest.rank||0).toFixed(2)+'×', statusGen(+latest.rank||0,1.5)],
    ]:[];
    $('statusBoard').innerHTML = rows.map(r=>
      `<div class="srow"><span class="n">${r[0]} · ${r[1]}</span><span class="s ${r[2]}">${({g:'On target',a:'Watch',r:'Action',i:'—'})[r[2]]}</span></div>`).join('');
  });

  // feed (team can edit/delete each posted update)
  safe('updates feed', ()=>{
    const teamFeed = isTeamView();
    $('feed').innerHTML = data.feed.length? data.feed.map(f=>
      `<div class="fitem" data-fid="${f.id}">
         <span class="fmsg">${esc(f.message)}</span>
         ${teamFeed? `<span class="factions"><button class="fedit" data-fid="${f.id}" title="Edit">✎</button><button class="fdel" data-fid="${f.id}" title="Delete">✕</button></span>`:''}
         <div class="meta">${esc(f.author||'ROXIUM')} · ${new Date(f.created_at).toLocaleDateString()} · ${esc(f.source)}${f.edited_at? ' · <span class="edited">edited '+new Date(f.edited_at).toLocaleDateString()+'</span>':''}</div></div>`).join('')
      : '<p class="note">No updates yet.</p>';
    if(teamFeed){
      $('feed').querySelectorAll('.fedit').forEach(b=> b.onclick = ()=> editFeedItem(b.dataset.fid));
      $('feed').querySelectorAll('.fdel').forEach(b=> b.onclick = async ()=>{
        if(!confirm('Delete this update?')) return;
        const { error } = await sb.from('activity').delete().eq('id', b.dataset.fid);
        if(error) alert('Delete failed: '+error.message); else loadAll();
      });
    }
  });

  // team panel + controls only when team AND not previewing as client
  safe('team panel', ()=>{
    syncChrome();
    if(isTeamView()){
      renderTeam(latest);
      const rt = $('resetTarget');
      if(rt) rt.textContent = (data.practice && data.practice.name) ? `"${data.practice.name}"` : 'this practice';
    }
  });
}

/* Month selector for performance metrics: 'Latest (live)' + each reported month snapshot */
function buildMetricsPicker(reported, viewPeriod, latestPeriod){
  const sel = $('metricsPicker');
  if(!sel) return;
  if(!reported.length){ sel.style.display='none'; return; }
  sel.style.display='';
  // oldest → newest in the dropdown
  const opts = ['<option value="">Latest month (live)</option>']
    .concat(reported.slice().sort((a,b)=> (a.period<b.period?-1:a.period>b.period?1:0)).map(r=>
      `<option value="${r.period}">${periodLabel(r.period)}${r.period===latestPeriod?' (latest)':''}</option>`));
  sel.innerHTML = opts.join('');
  sel.value = (metricsPeriod!=null) ? String(metricsPeriod) : '';
  sel.onchange = ()=>{ metricsPeriod = sel.value===''? null : sel.value; render(); };
}

/* ---------------- team controls ---------------- */
let entryPeriod = null; // 'YYYY-MM-01' month the team is editing; survives re-renders
function renderTeam(){
  const inp = $('inMonth'); // an <input type="month"> — value is 'YYYY-MM'
  if(!entryPeriod) entryPeriod = currentPeriod();
  if(!inp.dataset.wired){
    inp.dataset.wired = '1';
    inp.onchange = ()=>{ entryPeriod = monthInputToPeriod(inp.value) || currentPeriod(); fillKpiForm(); };
  }
  inp.value = periodToMonthInput(entryPeriod); // restore the month the team was on
  const yr = $('inYear'); if(yr && !yr.value) yr.value = new Date().getFullYear();
  fillKpiForm();
}
function fillKpiForm(){
  const m = data.kpi.find(x=>x.period===entryPeriod) || {};
  $('entryFields').innerHTML = FIELDS.map(f=>
    `<div class="f"><label>${f.l}</label><input data-k="${f.k}" type="number" step="any" value="${m[f.k]??''}" placeholder="0"></div>`).join('');
}
const flash = t=>{ $('saveMsg').textContent=t; setTimeout(()=>$('saveMsg').textContent='',3500); };

$('btnSaveKpi').onclick = async ()=>{
  if(!entryPeriod){ flash('Pick a month first.'); return; }
  const row = { practice_id: practiceId, period: entryPeriod, source: KPI_SOURCE };
  document.querySelectorAll('#entryFields input').forEach(i=>{ row[i.dataset.k] = i.value===''? null : +i.value; });
  const { error } = await sb.from('kpi_monthly').upsert(row, { onConflict:'practice_id,period,source' });
  flash(error? error.message : `Saved ${periodLabel(entryPeriod)}.`); if(!error) loadAll();
};

$('xlsxFile').onchange = async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  // the workbook is 12 sequential month columns; the year comes from the import-year field
  const yr = parseInt($('inYear').value, 10) || new Date().getFullYear();
  try{
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets['Dashboard']; if(!ws) throw new Error('No "Dashboard" sheet');
    const grid = XLSX.utils.sheet_to_json(ws,{header:1,raw:true});
    const byLabel = {}; grid.forEach(r=>{ if(r&&r[0]) byLabel[String(r[0]).trim()]=r; });
    const rows = [];
    for(let mIdx=0;mIdx<12;mIdx++){
      const period = `${yr}-${String(mIdx+1).padStart(2,'0')}-01`;
      const row = { practice_id: practiceId, period, source: KPI_SOURCE };
      let any=false;
      Object.entries(XL_MAP).forEach(([label,key])=>{
        const r = byLabel[label]; if(!r) return;
        const v = r[4+mIdx];
        if(typeof v==='number' && !isNaN(v)){ row[key]=v; any=true; }
      });
      if(any) rows.push(row);
    }
    if(!rows.length) throw new Error('No monthly values found');
    const { error } = await sb.from('kpi_monthly').upsert(rows, { onConflict:'practice_id,period,source' });
    flash(error? error.message : `Imported ${rows.length} month(s) of ${yr} from workbook.`);
    if(!error) loadAll();
  }catch(err){ flash('Import failed: '+err.message); }
  e.target.value='';
};

/* ============================================================
   INLINE-EDITABLE RENDERERS  (team edits in place; client sees read-only)
   ============================================================ */
const STATUS_OPTS = [['promised','Promised'],['in_progress','In progress'],['delivered','Delivered']];
const MILE_OPTS   = [['upcoming','Up next'],['current','You are here'],['done','Complete']];
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ---- DELIVERABLES: grouped into draggable phase cards (team) / clean phase blocks (client) ---- */
function phaseGroups(){
  // group deliverables by phase, ordered by phase_order then sort
  const groups = {};
  data.deliv.forEach(d=>{ (groups[d.phase] = groups[d.phase] || []).push(d); });
  const order = {};
  data.deliv.forEach(d=>{ if(!(d.phase in order)) order[d.phase] = d.phase_order ?? 999; });
  return Object.keys(groups)
    .sort((a,b)=> (order[a]-order[b]) || a.localeCompare(b))
    .map(phase=>({ phase, items: groups[phase].sort((x,y)=>(x.sort||0)-(y.sort||0)) }));
}

let delivCollapsed = new Set();   // phase names the user has collapsed (persists in-session)
function phaseProgress(g){
  const done = g.items.filter(i=>i.status==='delivered').length;
  const pct = g.items.length? Math.round(100*done/g.items.length):0;
  return { done, total:g.items.length, pct };
}

function renderDeliverables(isTeam){
  const t = $('delivTable');
  const groups = phaseGroups();
  // Phases start expanded; collapsing is opt-in per session via the ▾ caret.
  if(isTeam){
    t.innerHTML = `<div class="phasewrap" id="phaseWrap">` + groups.map(g=>{
      const {done,total,pct} = phaseProgress(g);
      const collapsed = delivCollapsed.has(g.phase);
      const rows = g.items.map(x=>{
        const sla = slaState(x.status_since, x.status==='delivered');   // team-only age colour
        const ageChip = sla? `<span class="agechip ${sla}" title="${daysIn(x.status_since)} days in this status">${daysIn(x.status_since)}d</span>` : '';
        return `<div class="drow taskrow ${sla}" draggable="true" data-id="${x.id}" data-phase="${esc(g.phase)}">
        <span class="taskgrip">⋮⋮</span>
        <input class="cellinput dname" data-f="name" value="${esc(x.name)}">
        <input class="cellinput owner" data-f="owner_seat" value="${esc(x.owner_seat||'')}" placeholder="—">
        ${ageChip}
        <button class="infobtn${x.description?' has':''}" data-info-edit="${x.id}" title="Edit client explanation">ⓘ</button>
        ${statusSelect('deliv', x.status)}
        <button class="rowdel" title="Delete">✕</button></div>`;}).join('');
      return `<div class="phasecard${collapsed?' collapsed':''}" draggable="true" data-phase="${esc(g.phase)}">
        <div class="phasehead">
          <span class="grip">⋮⋮</span>
          <button class="caret" type="button" data-phase="${esc(g.phase)}" title="Collapse / expand">▾</button>
          <input class="cellinput phasename" data-phase="${esc(g.phase)}" value="${esc(g.phase)}">
          <span class="phaseprog"><span style="width:${pct}%"></span></span>
          <span class="phasecount">${done}/${total}</span>
          <button class="phasedel" data-phase="${esc(g.phase)}" title="Delete phase">✕</button>
        </div>
        <div class="phaserows">${rows}
          <button class="adddeliv" data-phase="${esc(g.phase)}">+ Add deliverable</button>
        </div></div>`;
    }).join('') + `</div>
      <div class="newphase"><input id="ndPhase" class="cellinput" placeholder="New phase name…"><button class="btn sm" id="ndAddPhase">+ Add phase</button></div>`;
    wireDeliverables();
  } else {
    // client: clean, collapsible phase blocks with per-phase progress + info layer
    t.innerHTML = `<div class="phasewrap" id="phaseWrap">` + groups.map(g=>{
      const {done,total,pct} = phaseProgress(g);
      const collapsed = delivCollapsed.has(g.phase);
      const rows = g.items.map(x=>`<div class="drow client">
        <span class="dnameC">${esc(x.name)}${x.description?`<button class="infobtn has" type="button" data-info="${x.id}" title="What is this?">ⓘ</button>`:''}
          ${x.description?`<span class="dinfo hidden" id="dinfo-${x.id}">${esc(x.description)}</span>`:''}</span>
        <span class="chip ${x.status}">${x.status.replace('_',' ')}</span></div>`).join('');
      return `<div class="phasecard${collapsed?' collapsed':''}"><div class="phasehead">
        <button class="caret" type="button" data-phase="${esc(g.phase)}" title="Collapse / expand">▾</button>
        <span class="phasenameC">${esc(g.phase)}</span>
        <span class="phaseprog"><span style="width:${pct}%"></span></span>
        <span class="phasecount">${done}/${total}</span></div>
        <div class="phaserows">${rows}</div></div>`;
    }).join('') + `</div>`;
    wireDelivClient();
  }
}
// caret collapse/expand + client info toggles (shared)
function wireCollapse(scope){
  scope.querySelectorAll('.caret').forEach(c=> c.addEventListener('click', e=>{
    e.preventDefault(); e.stopPropagation();
    const phase = c.dataset.phase;
    if(delivCollapsed.has(phase)) delivCollapsed.delete(phase); else delivCollapsed.add(phase);
    const card = c.closest('.phasecard'); if(card) card.classList.toggle('collapsed');
  }));
}
function wireDelivClient(){
  const wrap = $('phaseWrap');
  wireCollapse(wrap);
  wrap.querySelectorAll('.infobtn[data-info]').forEach(b=> b.addEventListener('click', ()=>{
    const el = document.getElementById('dinfo-'+b.dataset.info);
    if(el) el.classList.toggle('hidden');
  }));
}
function wireDeliverables(){
  const wrap = $('phaseWrap');
  wireCollapse(wrap);
  // inline edits on each deliverable row
  wrap.querySelectorAll('.taskrow[data-id]').forEach(row=>{
    const id = row.dataset.id;
    row.querySelectorAll('.cellinput').forEach(inp=> inp.onchange = ()=> updateRow('deliverables', id, { [inp.dataset.f]: inp.value.trim()||null }));
    const ssel = row.querySelector('select');
    ssel.onchange = ()=> updateDeliverableStatus(id, ssel.value);
    row.querySelector('.rowdel').onclick = ()=> deleteRow('deliverables', id, 'Delete this deliverable?');
    const info = row.querySelector('.infobtn[data-info-edit]');
    if(info) info.onclick = ()=> editDeliverableInfo(id);
  });
  // rename a whole phase (updates every deliverable in it)
  wrap.querySelectorAll('.phasename').forEach(inp=>{
    inp.onchange = async ()=>{
      const oldName = inp.dataset.phase, newName = inp.value.trim();
      if(!newName || newName===oldName) return;
      await sb.from('deliverables').update({ phase:newName }).eq('practice_id',practiceId).eq('phase',oldName);
      loadAll();
    };
  });
  // delete a whole phase + its deliverables
  wrap.querySelectorAll('.phasedel').forEach(b=>{
    b.onclick = async (e)=>{
      e.stopPropagation();
      const phase = b.dataset.phase;
      if(!confirm(`Delete the entire "${phase}" phase and all its deliverables?`)) return;
      const { error } = await sb.from('deliverables').delete().eq('practice_id',practiceId).eq('phase',phase);
      if(error){ alert('Delete failed: '+error.message); return; }
      loadAll();
    };
  });
  // add deliverable within a phase
  wrap.querySelectorAll('.adddeliv').forEach(b=> b.onclick = ()=> addDeliverableTo(b.dataset.phase));
  $('ndAddPhase').onclick = addPhase;

  // drag phase CARDS to reorder phases
  wrap.querySelectorAll('.phasecard[draggable]').forEach(card=>{
    card.addEventListener('dragstart', e=>{ e.stopPropagation(); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', 'phase:'+card.dataset.phase); card.classList.add('dragging'); });
    card.addEventListener('dragend', ()=> card.classList.remove('dragging'));
    card.addEventListener('dragover', e=>{ e.preventDefault(); card.classList.add('over'); });
    card.addEventListener('dragleave', ()=> card.classList.remove('over'));
    card.addEventListener('drop', async e=>{
      e.preventDefault(); card.classList.remove('over');
      const payload = e.dataTransfer.getData('text/plain');
      if(!payload.startsWith('phase:')) return;
      const from = payload.slice(6), to = card.dataset.phase;
      if(!from || from===to) return;
      await reorderPhases(from, to);
    });
  });

  // drag task rows to reorder WITHIN their phase
  wrap.querySelectorAll('.taskrow[draggable]').forEach(row=>{
    row.addEventListener('dragstart', e=>{ e.stopPropagation(); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', 'task:'+row.dataset.id); row.classList.add('dragging'); });
    row.addEventListener('dragend', ()=> row.classList.remove('dragging'));
    row.addEventListener('dragover', e=>{ e.preventDefault(); row.classList.add('taskover'); });
    row.addEventListener('dragleave', ()=> row.classList.remove('taskover'));
    row.addEventListener('drop', async e=>{
      e.preventDefault(); e.stopPropagation(); row.classList.remove('taskover');
      const payload = e.dataTransfer.getData('text/plain');
      if(!payload.startsWith('task:')) return;
      const fromId = payload.slice(5), toId = row.dataset.id;
      if(fromId===toId) return;
      await reorderTaskWithinPhase(fromId, toId, row.dataset.phase);
    });
  });
}

async function reorderTaskWithinPhase(fromId, toId, phase){
  // only reorder if both are in the same phase
  const fromD = data.deliv.find(d=>d.id===fromId);
  const toD = data.deliv.find(d=>d.id===toId);
  if(!fromD || !toD || fromD.phase!==toD.phase) return;  // same-phase only
  const items = data.deliv.filter(d=>d.phase===phase).sort((a,b)=>(a.sort||0)-(b.sort||0));
  const ids = items.map(i=>i.id);
  const fi = ids.indexOf(fromId), ti = ids.indexOf(toId);
  if(fi<0||ti<0) return;
  ids.splice(ti,0,ids.splice(fi,1)[0]);
  // rewrite sort within this phase
  for(let i=0;i<ids.length;i++){
    await sb.from('deliverables').update({ sort:i }).eq('id', ids[i]);
  }
  loadAll();
}

async function reorderPhases(fromPhase, toPhase){
  const order = phaseGroups().map(g=>g.phase);
  const fi = order.indexOf(fromPhase), ti = order.indexOf(toPhase);
  if(fi<0||ti<0) return;
  order.splice(ti, 0, order.splice(fi,1)[0]); // move from -> to position
  // write new phase_order to every deliverable
  for(let i=0;i<order.length;i++){
    await sb.from('deliverables').update({ phase_order:i }).eq('practice_id',practiceId).eq('phase',order[i]);
  }
  loadAll();
}
async function updateDeliverableStatus(id, status){
  const prev = data.deliv.find(d=>d.id===id);
  await sb.from('deliverables').update({ status, delivered_at: status==='delivered'? new Date().toISOString():null }).eq('id', id);
  // notify on newly-delivered
  if(status==='delivered' && prev && prev.status!=='delivered'){
    await notifyClient('deliverable', `Deliverable completed: ${prev.name}.`);
  }
  await autoAdvanceMilestones();
  loadAll();
}

/* Auto-advance the roadmap based on overall deliverable completion %.
   Each milestone gets a threshold; the highest threshold passed becomes "current",
   everything below it "done", everything above "upcoming". Tweak THRESHOLDS freely. */
async function autoAdvanceMilestones(){
  const total = data.deliv.length;
  if(!total || !data.miles.length) return;
  // recompute delivered count from the freshest data we have
  const fresh = await sb.from('deliverables').select('status').eq('practice_id', practiceId);
  const list = fresh.data || [];
  const pct = list.length ? Math.round(100 * list.filter(d=>d.status==='delivered').length / list.length) : 0;

  // milestones in display order
  const miles = [...data.miles].sort((a,b)=>(a.sort||0)-(b.sort||0));
  const n = miles.length;
  // even thresholds: e.g. 4 milestones -> [0, 25, 50, 75]; first is always reachable
  const THRESHOLDS = miles.map((_,i)=> Math.round((i/n)*100));
  // highest threshold index that pct has reached
  let currentIdx = 0;
  for(let i=0;i<n;i++){ if(pct >= THRESHOLDS[i]) currentIdx = i; }

  // apply: below current = done, current = current, above = upcoming
  for(let i=0;i<n;i++){
    const want = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming';
    if(miles[i].status !== want){
      await sb.from('milestones').update({ status: want }).eq('id', miles[i].id);
      if(want==='current') await notifyClient('milestone', `You've reached: ${miles[i].name}.`);
      if(want==='done')    await notifyClient('milestone', `Completed: ${miles[i].name}.`);
    }
  }
}
function statusSelect(kind, cur){
  return `<select class="statussel">`+STATUS_OPTS.map(([v,l])=>`<option value="${v}" ${v===cur?'selected':''}>${l}</option>`).join('')+`</select>`;
}
async function addDeliverableTo(phase){
  const name = prompt('New deliverable in "'+phase+'":'); if(name===null) return;
  if(!name.trim()){ flash('Enter a name.'); return; }
  const po = data.deliv.find(d=>d.phase===phase)?.phase_order ?? 0;
  const sort = (Math.max(0,...data.deliv.filter(d=>d.phase===phase).map(d=>d.sort||0)))+1;
  const { error } = await sb.from('deliverables').insert({ practice_id:practiceId, phase, phase_order:po, name:name.trim(), status:'promised', sort });
  flash(error? error.message : 'Added.'); if(!error) loadAll();
}
async function addPhase(){
  const phase = $('ndPhase').value.trim(); if(!phase){ flash('Enter a phase name.'); return; }
  const po = (Math.max(-1,...data.deliv.map(d=>d.phase_order??0)))+1;
  const { error } = await sb.from('deliverables').insert({ practice_id:practiceId, phase, phase_order:po, name:'New deliverable', status:'promised', sort:0 });
  flash(error? error.message : 'Phase added.'); if(!error) loadAll();
}
// team: set the client-facing explanation for a deliverable (the ⓘ info layer)
async function editDeliverableInfo(id){
  const d = data.deliv.find(x=>x.id===id); if(!d) return;
  const v = prompt(`Client explanation for "${d.name}"\n(what this deliverable means — shown to the client under an ⓘ icon). Leave blank to remove.`, d.description||'');
  if(v===null) return;
  const { error } = await sb.from('deliverables').update({ description: v.trim()||null }).eq('id', id);
  flash(error? error.message : 'Saved.'); if(!error) loadAll();
}

/* ---- VIDEO PIPELINE: column board with dates, drag-drop, stale-red flag, hover detail, click-to-open panel ---- */
let _vDragged = false;   // guards against the click that fires at the end of a drag
const fmtDate = d => d ? new Date(d+ (String(d).length<=10?'T00:00:00':'')).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
// Stage-history timestamps are stored UTC (timestamptz). Render in the viewer's
// local timezone WITH the tz short-name (e.g. "Jun 22, 2026, 3:04 PM PDT") so a
// scheduled time is never ambiguous for people in other time zones.
const fmtHistTime = ts => ts ? new Date(ts).toLocaleString(undefined,
  { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' }) : '';
function daysIn(stage_since){ if(!stage_since) return 0; return Math.max(0,Math.floor((Date.now()-new Date(stage_since))/86400000)); }
// Team-only age-based SLA colour for an item sitting in a non-final stage:
// >= 7 days = overdue (red), >= 3 days = warn (yellow), else none.
function slaState(since, isFinal){
  if(!isTeamView() || isFinal || !since) return '';
  const d = daysIn(since);
  return d>=7 ? 'overdue' : d>=3 ? 'warn' : '';
}
function stageLabelOf(k){ return (STAGES.find(s=>s[0]===k)||[k,k])[1]; }

function videoTooltip(v){
  const lines = [];
  if(v.description) lines.push(v.description);
  if(v.stage_since) lines.push('In '+stageLabelOf(v.stage)+' since:\n'+fmtDate(v.stage_since));
  const hist = data.vhist.filter(h=>h.video_id===v.id).sort((a,b)=>new Date(a.moved_at)-new Date(b.moved_at));
  if(hist.length){
    lines.push('History:\n'+hist.map(h=>'• '+stageLabelOf(h.stage)+' — '+new Date(h.moved_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})).join('\n'));
  }
  return lines.join('\n\n') || 'No details yet — double-click to add.';
}

function renderPipeline(isTeam){
  const wrap = $('pipeline');
  wrap.innerHTML = STAGES.map(([key,label])=>{
    const items = data.video.filter(v=>v.stage===key);
    const cards = items.map(v=>{
      const isFinal = key==='posted' || key==='delivered';
      const sla = slaState(v.stage_since, isFinal);   // '', 'warn' or 'overdue' (team only)
      const enteredStr = v.stage_since ? fmtDate(v.stage_since) : '';
      const days = daysIn(v.stage_since);
      const daysLine = isTeam? `<span class="vdays ${sla}">${days} day${days===1?'':'s'} in this stage${sla==='overdue'?' · overdue':sla==='warn'?' · watch':''}</span>` : '';
      const stageDateLine = enteredStr? `<span class="vdate">${stageLabelOf(key)} · ${enteredStr}</span>` : '';
      return `<div class="vitem ${v.blocked?'blocked':''} ${sla}" ${isTeam?`draggable="true"`:''} data-vid="${v.id}" title="${esc(videoTooltip(v))}">
        ${isTeam?`<button class="vdel" data-del="${v.id}" title="Delete">✕</button>`:''}
        <span class="vtitle">${esc(v.item)}</span>
        ${v.video_url && key==='posted'?`<a class="vlink" href="${esc(v.video_url)}" target="_blank" rel="noopener">▶ watch</a>`:''}
        ${daysLine}${stageDateLine}
        ${v.blocked?`<span class="why">⚑ ${esc(v.blocked_reason||'Waiting on practice')}</span>`:''}</div>`;
    }).join('');
    const addBtn = isTeam? `<button class="vadd" data-addstage="${key}">+ Add video</button>` : '';
    return `<div class="col ${isTeam?'dropcol':''}" data-stage="${key}"><div class="h">${label} · <span class="cnt">${items.length}</span></div><div class="coldrop">${cards}</div>${addBtn}</div>`;
  }).join('');
  wirePipeline(wrap, isTeam);
}

function wirePipeline(wrap, isTeam){
  // Click ANY card to open its detail panel (watch / history — plus editing for team).
  wrap.querySelectorAll('.vitem[data-vid]').forEach(card=>{
    card.addEventListener('click', e=>{
      if(_vDragged) return;                                              // ignore the click that ends a drag
      if(e.target.closest('.vdel') || e.target.closest('.vlink')) return; // those handle their own clicks
      openVideoDetail(card.dataset.vid);
    });
  });
  if(!isTeam) return;   // clients get click-to-view only; everything below is team editing

  wrap.querySelectorAll('.vitem[draggable]').forEach(card=>{
    card.addEventListener('dragstart', e=>{
      _vDragged = true;
      e.dataTransfer.setData('text/plain', card.dataset.vid);  // reliable: travels with the drag
      e.dataTransfer.effectAllowed='move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', ()=>{ card.classList.remove('dragging'); setTimeout(()=>{ _vDragged=false; }, 60); });
  });
  wrap.querySelectorAll('.vdel').forEach(b=>{
    b.addEventListener('click', e=>{ e.stopPropagation(); deleteRow('video_pipeline', b.dataset.del, 'Delete this video asset and its history?'); });
  });
  wrap.querySelectorAll('.vadd').forEach(b=>{
    b.addEventListener('click', e=>{ e.stopPropagation(); addVideoTo(b.dataset.addstage); });
  });
  // EVERY column is a drop target — including empty ones and Planned
  wrap.querySelectorAll('.col').forEach(col=>{
    col.addEventListener('dragover', e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; col.classList.add('over'); });
    col.addEventListener('dragleave', e=>{ if(!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', async e=>{
      e.preventDefault(); e.stopPropagation(); col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      if(!id) return;
      const newStage = e.currentTarget.dataset.stage;   // the column this handler is bound to
      const v = data.video.find(x=>x.id===id);
      if(v && v.stage!==newStage){
        await updateRow('video_pipeline', id, { stage:newStage });
      }
    });
  });
}

async function addVideoTo(stage){
  const item = prompt('Name of the new video asset:');
  if(item===null) return;            // cancelled
  if(!item.trim()){ flash('Enter a name.'); return; }
  try{
    const { error } = await sb.from('video_pipeline')
      // new assets default to 'planned' (backlog) unless added from a specific column
      .insert({ practice_id: practiceId, item: item.trim(), stage: stage || 'planned' })
      .select();
    if(error){ flash('Add failed: '+error.message); alert('Add failed: '+error.message); return; }
    flash('Video added.');
    await loadAll();
  }catch(e){
    flash('Add failed: '+e.message); alert('Add failed: '+e.message);
  }
}

/* ---- Video detail modal: history, rename, dates, post + email ---- */
function openVideoDetail(id){
  const v = data.video.find(x=>x.id===id); if(!v) return;
  const hist = data.vhist.filter(h=>h.video_id===id).sort((a,b)=>new Date(a.moved_at)-new Date(b.moved_at));
  const stageLabel = k => (STAGES.find(s=>s[0]===k)||[k,k])[1];

  // CLIENT (read-only): watch the finished video, see where the asset is and its stage history.
  if(!isTeamView()){
    const histRO = hist.length
      ? hist.map(h=>`<div class="histrow"><span class="hstage">${stageLabel(h.stage)}</span><span class="hdate">${fmtHistTime(h.moved_at)}</span></div>`).join('')
      : '<div class="note">No stage history yet.</div>';
    const mc = $('modal');
    mc.innerHTML = `<div class="modalcard">
      <div class="modalhead"><h3 style="margin:0">${esc(v.item)}</h3><button class="modalx" id="mClose">✕</button></div>
      <div class="modalbody">
        ${v.description? `<label class="mlabel">About this asset</label><div class="mfield">${esc(v.description)}</div>`:''}
        <label class="mlabel">Current stage</label>
        <div class="mstage">${stageLabel(v.stage)}${v.stage_since? ' · since '+fmtDate(v.stage_since):''}</div>
        ${v.blocked? `<label class="mlabel">Status</label><div class="mfield" style="color:var(--gold)">⚑ ${esc(v.blocked_reason||'Waiting on practice')}</div>`:''}
        <label class="mlabel">Stage history</label>
        <div class="histbox">${histRO}</div>
      </div>
      <div class="modalfoot">
        ${v.video_url
          ? `<a class="btn" href="${esc(v.video_url)}" target="_blank" rel="noopener">▶ Watch video</a>
             <a class="btn ghost" href="${esc(v.video_url)}" download target="_blank" rel="noopener">⤓ Download</a>`
          : '<span class="note">Video not posted yet.</span>'}
      </div></div>`;
    mc.classList.add('open');
    $('mClose').onclick = closeModal;
    mc.onclick = e=>{ if(e.target===mc) closeModal(); };
    return;
  }

  const histRows = hist.length? hist.map(h=>
    `<div class="histrow"><span class="hstage">${stageLabel(h.stage)}</span><span class="hdate">${fmtHistTime(h.moved_at)}</span><button class="histdel" data-hid="${h.id}" title="Delete">✕</button></div>`).join('')
    : '<div class="note">No history yet.</div>';

  const m = $('modal');
  m.innerHTML = `<div class="modalcard">
    <div class="modalhead"><h3 style="margin:0">${esc(v.item)}</h3><button class="modalx" id="mClose">✕</button></div>
    <div class="modalbody">
      <label class="mlabel">Asset name</label>
      <input class="cellinput mfield" id="mName" value="${esc(v.item)}">

      <label class="mlabel">Description (what this asset is — shown on hover)</label>
      <textarea class="cellinput mfield mtextarea" id="mDesc" rows="2" placeholder="e.g. 3-min educational video on facelift recovery timeline">${esc(v.description||'')}</textarea>

      <label class="mlabel">Current stage</label>
      <div class="mstage">${stageLabel(v.stage)} · ${daysIn(v.stage_since)} days in stage</div>

      <label class="mlabel">Date entered ${stageLabel(v.stage)} (auto-set on move — edit to schedule ahead or correct)</label>
      <input type="date" class="dateedit mfield" id="mStageDate" value="${(v.stage_since||'').slice(0,10)}">

      <label class="mlabel">Blocked reason (blank = not blocked)</label>
      <input class="cellinput mfield" id="mBlock" value="${esc(v.blocked_reason||'')}" placeholder="e.g. Awaiting surgeon approval">

      <label class="mlabel">Finished video link (shown to client when posted)</label>
      <input class="cellinput mfield" id="mUrl" value="${esc(v.video_url||'')}" placeholder="https://…">

      <label class="mlabel">Stage history</label>
      <div class="histbox">${histRows}</div>
    </div>
    <div class="modalfoot">
      <button class="btn" id="mSave">Save changes</button>
      <button class="btn" id="mPost">Post video &amp; email client</button>
      ${v.video_url? `<a class="btn ghost" href="${esc(v.video_url)}" download target="_blank" rel="noopener">⤓ Download</a>`:''}
      <span id="mMsg" class="note"></span>
    </div></div>`;
  m.classList.add('open');

  $('mClose').onclick = closeModal;
  m.onclick = e=>{ if(e.target===m) closeModal(); };

  // delete individual stage-history rows
  m.querySelectorAll('.histdel').forEach(b=>{
    b.onclick = async (e)=>{
      e.stopPropagation(); e.preventDefault();
      if(!confirm('Delete this history entry?')) return;
      const { data: del, error } = await sb.from('video_history').delete().eq('id', b.dataset.hid).select();
      if(error){ alert('Delete failed: '+error.message); return; }
      if(!del || !del.length){ alert('Delete failed: no permission (row-level security). Run the latest migration.'); return; }
      await loadAll();
      openVideoDetail(id);  // reopen so the history list refreshes
    };
  });

  $('mSave').onclick = async ()=>{
    const stageDate = $('mStageDate').value; // yyyy-mm-dd or ''
    const patch = {
      item: $('mName').value.trim()||v.item,
      description: $('mDesc').value.trim()||null,
      stage_since: stageDate ? new Date(stageDate+'T12:00:00').toISOString() : v.stage_since,
      blocked_reason: $('mBlock').value.trim()||null,
      blocked: !!$('mBlock').value.trim(),
      video_url: $('mUrl').value.trim()||null,
    };
    const { error } = await sb.from('video_pipeline').update(patch).eq('id', id);
    if(error){ $('mMsg').textContent = error.message; } else { $('mMsg').textContent='Saved.'; await loadAll(); closeModal(); }
  };

  $('mPost').onclick = async ()=>{
    const url = $('mUrl').value.trim();
    if(!url){ $('mMsg').textContent = 'Add the finished video link first.'; return; }
    $('mMsg').textContent = 'Posting & emailing…';
    // move to posted + save url; trigger stamps posted_date + history
    const { error: upErr } = await sb.from('video_pipeline').update({ stage:'posted', video_url:url }).eq('id', id);
    if(upErr){ $('mMsg').textContent = upErr.message; return; }
    // call the edge function to email the client
    try{
      const { data: sess } = await sb.auth.getSession();
      const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/notify-video-ready`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${sess.session.access_token}` },
        body: JSON.stringify({ video_id: id }),
      });
      const out = await res.json();
      if(!out.ok) throw new Error(out.error||'email failed');
      $('mMsg').textContent = `Posted & emailed ${out.emailed} client(s).`;
    }catch(e){
      $('mMsg').textContent = 'Posted to portal, but email failed: '+e.message;
    }
    const v = data.video.find(x=>x.id===id);
    // write a banner notification (the email is handled by notify-video-ready)
    await sb.from('notifications').insert({ practice_id: practiceId, kind:'video', message:`New video published: ${v? v.item : 'your video'}. Watch it in your portal.` });
    await loadAll();
    setTimeout(closeModal, 1400);
  };
}
function closeModal(){ const m=$('modal'); m.classList.remove('open'); m.innerHTML=''; }

/* ---- MILESTONES: original display; team edits date + status (status change notifies client) ---- */
function renderTimeline(isTeam){
  const wrap = $('timeline');
  if(!data.miles.length){ wrap.innerHTML = '<p class="note">Roadmap milestones will appear here at kickoff.</p>'; return; }
  wrap.innerHTML = data.miles.map(m=>{
    const tagLabel = m.status==='done'?'Complete':m.status==='current'?'You are here':'Up next';
    const dateBit = m.target_date? ' · '+m.target_date : '';
    // status is auto-advanced by deliverable %; team can still edit only the target date
    const teamCtl = isTeam
      ? `<div class="tldate"><input type="date" class="dateedit" data-id="${m.id}" value="${m.target_date||''}"></div>`
      : '';
    return `<div class="tl ${m.status}"><div class="dot"></div><div class="n">${esc(m.name)}</div>
       <div class="d">${esc(m.detail||'')}</div>
       <span class="tag">${tagLabel}${isTeam?'':dateBit}</span>${teamCtl}</div>`;
  }).join('');
  if(isTeam){
    wrap.querySelectorAll('.dateedit').forEach(inp=>{
      inp.onchange = ()=> updateRow('milestones', inp.dataset.id, { target_date: inp.value||null });
    });
  }
}
async function updateMilestoneStatus(id, status){
  const prev = data.miles.find(m=>m.id===id);
  await sb.from('milestones').update({ status }).eq('id', id);
  if(prev && prev.status!==status && (status==='current'||status==='done')){
    const verb = status==='done' ? 'completed' : 'now underway';
    await notifyClient('milestone', `Milestone ${verb}: ${prev.name}.`);
  }
  loadAll();
}

/* ---- shared write helpers ---- */
async function updateRow(table, id, patch){
  const { error } = await sb.from(table).update(patch).eq('id', id);
  if(error){ flash(error.message); } else { flash('Saved.'); loadAll(); }
}
async function deleteRow(table, id, confirmMsg){
  if(!confirm(confirmMsg)) return;
  const { error } = await sb.from(table).delete().eq('id', id);
  flash(error? error.message : 'Deleted.'); if(!error) loadAll();
}

/* ---- NOTIFICATIONS: write a banner row for the client + fire an email ---- */
async function notifyClient(kind, message){
  try{
    await sb.from('notifications').insert({ practice_id: practiceId, kind, message });
    // also drop it into the activity feed
    await sb.from('activity').insert({ practice_id: practiceId, message, author:'ROXIUM', source:'portal' });
    // fire the email (works once the Edge Function + Resend domain are live; silent if not)
    const { data: sess } = await sb.auth.getSession();
    fetch(`${CONFIG.SUPABASE_URL}/functions/v1/notify-client`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${sess.session.access_token}` },
      body: JSON.stringify({ practice_id: practiceId, message, kind }),
    }).catch(()=>{});
  }catch(e){ /* non-blocking */ }
}

/* client-facing dismissable banner showing the newest unseen notification */
function renderBanner(){
  const bar = $('notifyBar');
  if(!bar) return;
  // only show to the client view, and only if there's an unseen notification
  if(isTeamView()){ bar.classList.add('hidden'); return; }
  const unseen = (data.notif||[]).filter(n=>!n.seen);
  if(!unseen.length){ bar.classList.add('hidden'); return; }
  const n = unseen[0];
  // 'stats' notifications bake the month into the text at insert time, so a stale or
  // bad-period row (e.g. a future "Jan 2030") would show forever. Re-derive the month
  // from the actual latest reported period so the banner is always self-correcting.
  let text = n.message;
  if(n.kind==='stats' && data.kpi && data.kpi.length){
    const latestP = data.kpi.map(k=>k.period).sort().slice(-1)[0];
    if(latestP) text = `Your ${periodLabel(latestP)} performance update is ready.`;
  }
  bar.innerHTML = `<span class="noteicon">●</span><span class="notetext">${esc(text)}</span>
    <button class="noteclose" title="Dismiss">✕</button>`;
  bar.classList.remove('hidden');
  bar.querySelector('.noteclose').onclick = async ()=>{
    bar.classList.add('hidden');
    // mark all current unseen as seen
    const ids = unseen.map(x=>x.id);
    await sb.from('notifications').update({ seen:true }).in('id', ids);
    const fresh = await sb.from('notifications').select('*').eq('practice_id',practiceId).order('created_at',{ascending:false}).limit(10);
    data.notif = fresh.data||[];
  };
}

async function editFeedItem(id){
  const f = data.feed.find(x=>x.id===id); if(!f) return;
  const msg = prompt('Edit this update:', f.message);
  if(msg===null) return;
  if(!msg.trim()){ alert('Message cannot be empty.'); return; }
  const { error } = await sb.from('activity').update({ message: msg.trim(), edited_at: new Date().toISOString() }).eq('id', id);
  if(error) alert('Edit failed: '+error.message); else loadAll();
}

$('btnPost').onclick = async ()=>{
  const msg = $('updMsg').value.trim(); if(!msg) return;
  const { error } = await sb.from('activity').insert({ practice_id: practiceId, message: msg, author: me.full_name||'ROXIUM', source:'portal' });
  flash(error? error.message : 'Posted.'); $('updMsg').value=''; if(!error) loadAll();
};

/* ---- ONBOARDING (team): add a client/practice, invite surgeon/client users ---- */
const onbFlash = t=>{ const el=$('onbMsg'); if(el){ el.textContent=t; setTimeout(()=>{ if(el.textContent===t) el.textContent=''; }, 6000); } };

// Add a new client practice — reuses the seed_practice() RPC so it lands fully loaded
// with the standard deliverables / roadmap / pipeline. Then jump to it.
$('btnAddClient').onclick = async ()=>{
  if(!isTeamView()) return;
  const name = $('newClientName').value.trim();
  const kickoff = $('newClientKickoff').value || new Date().toISOString().slice(0,10);
  if(!name){ onbFlash('Enter a practice name.'); return; }
  // Guard against duplicates (e.g. a second empty "Balikian"): if a practice with
  // this name already exists, offer to switch to it instead of creating a clone.
  const dupe = practicesList.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
  if(dupe){
    if(confirm(`"${dupe.name}" already exists. Switch to it instead of creating a duplicate?`)){
      practiceId = dupe.id; $('newClientName').value=''; buildSwitcher(practicesList); loadAll();
    } else {
      onbFlash('No duplicate created. Rename if this is a different practice.');
    }
    return;
  }
  $('btnAddClient').disabled = true; onbFlash('Creating…');
  try{
    const { data, error } = await sb.rpc('seed_practice', { p_name: name, p_kickoff: kickoff });
    if(error) throw error;
    $('newClientName').value = '';
    await loadTeamPractices();
    if(data){ practiceId = data; }            // RPC returns the new practice id
    onbFlash(`Added "${name}". Now invite their users below.`);
    loadAll();
  }catch(e){ onbFlash('Could not add client: '+e.message); }
  finally{ $('btnAddClient').disabled = false; }
};

// Invite a surgeon/client user — calls the invite-user Edge Function (service role)
// which creates/links the auth user + profile + membership and emails the invite.
$('btnInvite').onclick = async ()=>{
  if(!isTeamView()) return;
  const email = $('inviteeEmail').value.trim();
  const practice_id = $('inviteePractice').value;
  const full_name = $('inviteeName').value.trim();
  const role = $('inviteeRole').value || 'member';
  if(!email || !practice_id){ onbFlash('Email and practice are required.'); return; }
  $('btnInvite').disabled = true; onbFlash('Sending invite…');
  try{
    const { data, error } = await sb.functions.invoke('invite-user', {
      body: { email, practice_id, full_name, role }
    });
    if(error) throw error;
    if(data && data.error) throw new Error(data.error);
    $('inviteeEmail').value=''; $('inviteeName').value='';
    onbFlash(data && data.invited===false
      ? `${email} already had an account — linked to this practice.`
      : `Invite sent to ${email}.`);
  }catch(e){
    onbFlash('Invite failed: '+(e.message||e)+' (is the invite-user function deployed?)');
  }finally{ $('btnInvite').disabled = false; }
};

/* ---- DANGER ZONE: reset all data for the currently-selected practice (team only) ---- */
const resetFlash = t=>{ const el=$('resetMsg'); if(el){ el.textContent=t; setTimeout(()=>{ if(el.textContent===t) el.textContent=''; }, 6000); } };
$('btnResetData').onclick = async ()=>{
  if(!isTeamView()){ return; }                 // safety: team-only, never in client preview
  if(!practiceId){ resetFlash('No practice selected.'); return; }
  const name = (data.practice && data.practice.name) || 'this practice';

  // Step 1 — "are you sure?"
  if(!confirm(`Reset ALL data for "${name}"?\n\nThis permanently deletes:\n  • every KPI month\n  • the activity / updates feed\n  • all notifications\n  • all video stage history\n\nand resets all deliverables, milestones and videos to their starting state.\n\nThis CANNOT be undone.`)) return;

  // Step 2 — type the practice name to confirm (guards against accidental wipes)
  const typed = prompt(`To confirm, type the practice name exactly:\n\n${name}`);
  if(typed === null) return;                    // cancelled
  if(typed.trim() !== name){ alert('Name did not match — reset cancelled. Nothing was changed.'); return; }

  const pid = practiceId;
  $('btnResetData').disabled = true;
  resetFlash('Resetting…');
  try {
    // 1) wipe the time-series / log data
    const wipes = await Promise.all([
      sb.from('kpi_monthly').delete().eq('practice_id', pid),
      sb.from('activity').delete().eq('practice_id', pid),
      sb.from('notifications').delete().eq('practice_id', pid),
    ]);
    const wipeErr = wipes.find(r=>r.error);
    if(wipeErr){ throw new Error(wipeErr.error.message); }

    // 2) reset deliverables back to "promised"
    const dRes = await sb.from('deliverables')
      .update({ status:'promised', delivered_at:null })
      .eq('practice_id', pid);
    if(dRes.error) throw new Error(dRes.error.message);

    // 3) reset the roadmap: first milestone "current", the rest "upcoming"
    const miles = [...data.miles].sort((a,b)=>(a.sort||0)-(b.sort||0));
    for(let i=0;i<miles.length;i++){
      const want = i===0 ? 'current' : 'upcoming';
      const mr = await sb.from('milestones').update({ status: want }).eq('id', miles[i].id);
      if(mr.error) throw new Error(mr.error.message);
    }

    // 4) reset the video pipeline back to "planned" / backlog and clear per-asset progress
    const vRes = await sb.from('video_pipeline')
      .update({ stage:'planned', blocked:false, blocked_reason:null, video_url:null,
                posted_date:null, shot_date:null, stage_since:new Date().toISOString() })
      .eq('practice_id', pid);
    if(vRes.error) throw new Error(vRes.error.message);

    // 5) clear stage history last (the video reset above may re-log entries via trigger)
    const hRes = await sb.from('video_history').delete().eq('practice_id', pid);
    if(hRes.error) throw new Error(hRes.error.message);

    resetFlash(`"${name}" was reset to a clean slate.`);
    await loadAll();
  } catch(e){
    resetFlash('Reset failed: '+e.message);
    alert('Reset failed: '+e.message);
  } finally {
    $('btnResetData').disabled = false;
  }
};

/* ---- Deliverables info-guide (explains promised vs delivered, the ⓘ layer, phases) ---- */
(function setupDelivGuide(){
  const guide = $('delivGuide'), btn = $('delivGuideBtn');
  if(!guide || !btn) return;
  guide.innerHTML = `
    <p>This is everything we committed to for your practice, grouped into <b>phases</b> of work. Each phase shows how many items are <b>delivered</b> out of the total, and you can collapse a phase with the ▾ caret to focus on what's active.</p>
    <ul class="guidelist">
      <li><span class="chip promised">promised</span> Committed and scheduled — not started yet.</li>
      <li><span class="chip in_progress">in progress</span> Actively being worked on right now.</li>
      <li><span class="chip delivered">delivered</span> Completed and handed off.</li>
    </ul>
    <p>Where you see an <b>ⓘ</b> next to a deliverable, click it for a plain-English explanation of what that item is and why it matters.</p>`;
  btn.onclick = ()=> guide.classList.toggle('hidden');
})();

init();
