/* ============================================================
   ROXIUM CLIENT PORTAL · app.js
   Front end: Netlify (static) · Backend: Supabase (auth + db + RLS)
   ============================================================ */

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// Team manual-entry fields = the real ad metrics the Coefficient sheet provides.
// (CTR / CPM / CPC are DERIVED from spend·impr·clicks — not entered or stored.)
const FIELDS = [
  {k:'spend', l:'Amount Spent ($)'}, {k:'reach', l:'Reach'}, {k:'impr', l:'Impressions'},
  {k:'clicks', l:'Link Clicks'}, {k:'lpv', l:'Landing Page Views'},
  {k:'page_likes', l:'Page Likes'}, {k:'foll', l:'Followers'},
];
const XL_MAP = {
  'Amount Spent':'spend','Amount spent':'spend','Reach':'reach','Impressions':'impr',
  'Link Clicks':'clicks','Clicks':'clicks','Landing Page Views':'lpv','Page Likes':'page_likes',
  'Followers':'foll',
};
// Default dashboard metric model — grounded in the actual ad source. Raw metrics
// come straight from the sheet; derived ones are computed and only shown when their
// inputs exist. Cards/rows render ONLY for metrics that have a real value (no
// broken "read doesn't exist" cards for data the source never provides).
const N = (m,k)=> (m && m[k]!=null && m[k]!=='') ? +m[k] : null;
const CORE_METRICS = [
  {k:'spend',  label:'Amount Spent', fmt:v=>fmt$(v)},
  {k:'reach',  label:'Reach',        fmt:v=>fmtNum(v)},
  {k:'impr',   label:'Impressions',  fmt:v=>fmtNum(v)},
  {k:'clicks', label:'Link Clicks',  fmt:v=>fmtNum(v)},
  {k:'ctr',    label:'CTR',          fmt:v=>fmtP(v),  derive:m=>{const i=N(m,'impr'),c=N(m,'clicks');return i?c/i:null;}},
  {k:'cpm',    label:'CPM',          fmt:v=>fmt$(v),  derive:m=>{const s=N(m,'spend'),i=N(m,'impr');return i?s/(i/1000):null;}, lowerBetter:true},
  {k:'cpc',    label:'CPC',          fmt:v=>fmt$(v),  derive:m=>{const s=N(m,'spend'),c=N(m,'clicks');return c?s/c:null;}, lowerBetter:true},
  {k:'page_engagement', label:'Page Engagement', fmt:v=>fmtNum(v)},   // only renders when the source provides it
];
const OPTIONAL_METRICS = [
  {k:'lpv',        label:'Landing Page Views', fmt:v=>fmtNum(v)},
  {k:'page_likes', label:'Page Likes',         fmt:v=>fmtNum(v)},
  {k:'foll',       label:'Followers',          fmt:v=>fmtNum(v)},
];
// value of a metric for a row: derived metrics compute (null if inputs absent),
// raw metrics read the column (null if missing). null => the card is not rendered.
const metricValue = (def, m)=> def.derive ? def.derive(m) : N(m, def.k);

// Client-facing metric explanations. Each: what it measures, why it matters, and how
// to read a higher / lower value. Surfaced via the ⓘ info button on each KPI card.
const METRIC_INFO = {
  reach:  {label:'Reach', what:'The number of unique people who saw your ads at least once.', why:'Tells you how wide your audience is — how many distinct individuals your campaign actually touched.', higher:'Higher reach means your message is spreading to more people.', lower:'Lower reach means a smaller, often more concentrated audience.'},
  impr:   {label:'Impressions', what:'The total number of times your ads were shown, including repeat views by the same person.', why:'Measures total exposure and how often your audience sees you. Impressions ÷ reach = average frequency per person.', higher:'Higher impressions mean more total exposure (and possibly more repeat views).', lower:'Lower impressions mean less total on-screen time for your ads.'},
  spend:  {label:'Amount Spent', what:'The total advertising budget actually spent in this period.', why:'It is the input every other efficiency metric (CPM, CPC) is measured against — your cost base.', higher:'Higher spend usually drives more reach and clicks, but watch efficiency.', lower:'Lower spend conserves budget; compare against the results it produced.'},
  ctr:    {label:'CTR (Click-Through Rate)', what:'The share of impressions that resulted in a link click — link clicks ÷ impressions.', why:'A core measure of creative and targeting relevance: are people who see the ad acting on it?', higher:'Higher CTR means the ad resonates and the audience is engaged. Good.', lower:'Lower CTR can signal weak creative, fatigue, or off-target audience.'},
  cpm:    {label:'CPM (Cost per 1,000 Impressions)', what:'How much you pay for every 1,000 times your ad is shown — spend ÷ (impressions ÷ 1,000).', why:'The standard way to compare how expensive it is to reach your audience across campaigns.', higher:'Higher CPM means each 1,000 views costs more — less efficient exposure.', lower:'Lower CPM is better: you are buying exposure more cheaply.'},
  clicks: {label:'Link Clicks', what:'The number of times people clicked a link in your ad to go to your site or landing page.', why:'A direct signal of intent — the step between seeing the ad and becoming a lead or customer.', higher:'Higher clicks mean more people are taking action on your ads.', lower:'Lower clicks mean fewer people are acting; check CTR and creative.'},
  cpc:    {label:'CPC (Cost per Link Click)', what:'The average cost of a single link click — spend ÷ link clicks.', why:'Shows how efficiently your budget converts into actual visits and intent.', higher:'Higher CPC means each click costs more — less efficient.', lower:'Lower CPC is better: you are paying less for each engaged visitor.'},
  page_engagement: {label:'Page Engagement', what:'Total interactions with your page and posts (reactions, comments, shares, saves, clicks) driven by the ads this period.', why:'Shows how much your content sparks action beyond a passive view — a signal of brand resonance.', higher:'Higher engagement means the audience is interacting more with your brand.', lower:'Lower engagement means fewer interactions; the creative may not be prompting action.'},
};
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
// human month name from a period key ('YYYY-MM-01' -> 'March')
function monthName(period){ if(!period) return ''; const mi=+String(period).slice(5,7)-1; return MONTH_NAMES[mi]||''; }
// Month-aware green sublabel for a stat/card. Live current month => 'this month';
// an archived snapshot => month-specific ('in March', or 'in March 2026' if not the
// current calendar year). NEVER generic 'not this month' phrasing.
function monthNote(period, isLive){
  if(period==null) return 'awaiting data';
  if(isLive) return 'this month';
  const mn = monthName(period), yr = String(period).slice(0,4);
  const curYr = String(new Date().getFullYear());
  return yr===curYr ? `in ${mn}` : `in ${mn} ${yr}`;
}
const STAGES = [['planned','Planned / Backlog'],['scheduled','Scheduled'],['pre_production','Pre-production'],['shot','Shot'],['editing','Editing'],['delivered','Delivered'],['posted','Posted']];
// Team-only SLA: an item >=3 days in its current stage warns (yellow), >=7 overdue (red). See slaState().

let me = null;            // profile row
let myMembership = null;    // current practice membership { role: owner|member }
let practiceId = null;    // active practice
let previewMode = false;  // team viewing the client-side version
// Selected reporting month is scoped PER PRACTICE so one client's choice can never
// leak into another's. Absent key = follow that practice's latest reported month.
let selByPractice = {};   // practiceId -> 'YYYY-MM-01'
const getSel = () => (practiceId && practiceId in selByPractice) ? selByPractice[practiceId] : null;
const setSel = p => { if(!practiceId) return; if(p==null) delete selByPractice[practiceId]; else selByPractice[practiceId]=p; };
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
const VIEWS = ['roadmap','deliverables','video','metrics','updates','access','team','admin'];
const TEAM_ONLY_VIEWS = ['team','admin'];
function isPracticeOwner(){ return !!(myMembership && myMembership.role === 'owner'); }
function canSeeAccessTab(){ return me && me.role === 'client' && isPracticeOwner() && !previewMode; }
function currentView(){
  const h = (location.hash||'').replace('#','');
  return VIEWS.includes(h) ? h : 'roadmap';
}
function showView(name){
  if(!VIEWS.includes(name)) name = 'roadmap';
  if(TEAM_ONLY_VIEWS.includes(name) && !isTeamView()) name = 'roadmap';
  if(name === 'access' && !canSeeAccessTab()) name = 'roadmap';
  document.querySelectorAll('.view').forEach(v=> v.classList.toggle('active', v.dataset.view===name));
  document.querySelectorAll('.tab').forEach(t=> t.classList.toggle('active', t.dataset.view===name));
  syncChrome();
  if(name==='admin'){
    renderAdminClients(); loadSheetSources(); loadPlatformAdmins();
    const pid = $('accessPractice')?.value;
    loadAccessRoster(pid);
    if(pid) refreshOnboardChecklist(pid);
  }
  if(name==='access') loadClientAccessRoster();
}
// Single source of truth for chrome visibility. Admin is a SEPARATE global screen,
// so when it's open we hide the whole practice context (hero, tabs, switcher,
// preview) — it must not look like a tab inside Balikian/Demo's portal.
function syncChrome(){
  const realTeam = !!(me && me.role==='team');
  const teamView = isTeamView();
  const adminMode = currentView()==='admin';
  $('btnAdmin').classList.toggle('hidden', !teamView);           // top-level entry, team only
  $('btnPreview').classList.toggle('hidden', !realTeam || adminMode);
  $('practiceSwitcher').classList.toggle('hidden', !realTeam || adminMode);
  document.querySelector('.hero')?.classList.toggle('hidden', adminMode);
  $('tabnav').classList.toggle('hidden', adminMode);
  document.querySelector('.tab[data-view="access"]')?.classList.toggle('hidden', !canSeeAccessTab());
  document.querySelector('section[data-view="access"]')?.classList.toggle('hidden', !canSeeAccessTab());
  TEAM_ONLY_VIEWS.forEach(v=>{
    const tab = document.querySelector(`.tab[data-view="${v}"]`);
    if(tab) tab.classList.toggle('hidden', !teamView);
    const panel = document.querySelector(`section[data-view="${v}"]`);
    if(panel) panel.classList.toggle('hidden', !teamView);
  });
  if(!teamView && TEAM_ONLY_VIEWS.includes(currentView())) location.hash = '#roadmap';
  if(!canSeeAccessTab() && currentView()==='access') location.hash = '#roadmap';
}
window.addEventListener('hashchange', ()=> showView(currentView()));
$('btnAdmin').onclick = ()=>{ location.hash = '#admin'; };
$('btnAdminBack')?.addEventListener('click', e=>{ e.preventDefault(); location.hash = '#roadmap'; });

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
      // each practice defaults to ITS OWN latest reported month (don't carry a
      // selected/edited month across practices — that's the "stuck on old month" bug)
      loadAll();   // month selection is per-practice (selByPractice), so nothing to reset
    });
  };
  input.addEventListener('focus', ()=>{ input.select(); draw(''); results.classList.remove('hidden'); });
  input.addEventListener('input', ()=>{ draw(input.value); results.classList.remove('hidden'); });
  input.addEventListener('keydown', e=>{ if(e.key==='Escape'){ results.classList.add('hidden'); input.blur(); } });
  document.addEventListener('click', e=>{ if(!$('practiceSwitcher').contains(e.target)) results.classList.add('hidden'); });
}

// Team: (re)load every practice and refresh the switcher + admin access dropdown.
async function loadTeamPractices(){
  const { data: prax } = await sb.from('practices').select('*').order('name');
  const list = prax || [];
  practicesList = list;
  buildSwitcher(list);
  const sel = $('accessPractice');
  if(sel){
    const keep = sel.value;
    sel.innerHTML = list.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if(list.some(p=>p.id===keep)) sel.value = keep;
    else if(practiceId && list.some(p=>p.id===practiceId)) sel.value = practiceId;
    else if(list[0]) sel.value = list[0].id;
    if(!sel.dataset.wired){
      sel.dataset.wired = '1';
      sel.onchange = ()=> loadAccessRoster(sel.value);
    }
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
  // Allowlisted emails (practice_invites) or existing auth users may sign in / sign up.
  const { data: allowed } = await sb.rpc('email_is_invited', { p_email: email });
  const { error } = await sb.auth.signInWithOtp({
    email, options:{ emailRedirectTo: location.origin, shouldCreateUser: !!allowed }
  });
  $('loginMsg').textContent = error
    ? (/not.*found|signups?.*disabled|user/i.test(error.message)
        ? "We couldn't find an invite for that email. Ask your ROXIUM lead to add you."
        : error.message)
    : allowed
      ? 'Check your email for the sign-in link.'
      : "If this email was invited, you'll receive a link shortly.";
};
$('btnLogout').onclick = async ()=>{ await sb.auth.signOut(); location.reload(); };

async function loadMyMembership(){
  if(!me || !practiceId) { myMembership = null; return; }
  const { data } = await sb.from('memberships').select('role')
    .eq('user_id', me.id).eq('practice_id', practiceId).maybeSingle();
  myMembership = data;
}

async function afterLogin(){
  const uid = (await sb.auth.getUser()).data.user?.id;

  // Claim any pending allowlist invites on every sign-in (first signup or added to another practice).
  const { data: claim } = await sb.rpc('claim_invites_for_user');

  let { data: prof, error } = await sb.from('profiles').select('*').eq('id', uid).single();
  if(error || !prof){
    if(!claim?.claimed){
      $('login').classList.remove('hidden');
      $('loginMsg').textContent = 'Signed in, but no invite was found for this email. Ask your ROXIUM lead to add you.';
      return;
    }
    ({ data: prof, error } = await sb.from('profiles').select('*').eq('id', uid).single());
    if(error || !prof){
      $('login').classList.remove('hidden');
      $('loginMsg').textContent = 'Account created, but setup failed. Contact ROXIUM support.';
      return;
    }
  } else if(claim?.claimed > 0){
    ({ data: prof } = await sb.from('profiles').select('*').eq('id', uid).single());
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
    await loadMyMembership();
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

/* ---------------- formatters ---------------- */
const fmt$ = v=> v==null? '—' : '$'+Math.round(v).toLocaleString();
const fmtP = v=> v==null? '—' : (v*100).toFixed(2)+'%';
const fmtNum = v=> v==null? '—' : Math.round(v).toLocaleString();

/* ---------------- render ---------------- */
function render(){
  renderBanner();
  $('heroTitle').innerHTML = (data.practice? data.practice.name : 'Your practice') + ': where you are, <em>exactly.</em>';
  // newest → oldest by period (immutable monthly snapshots; never overwrite the past)
  const reported = [...data.kpi].sort((a,b)=> (a.period<b.period?1:a.period>b.period?-1:0));
  const latestPeriod = reported.length? reported[0].period : null;
  const hasData = p => p!=null && data.kpi.some(x=>x.period===p);
  // Resolve the month to show (deterministic, per-practice):
  //  • no selection            → that practice's latest reported month
  //  • selection WITH data      → show it
  //  • selection with NO data:
  //      team  → sit on the empty month (so month switching always "moves", and you
  //              can enter that month's data); label says it's empty
  //      client → fall back to the latest archived snapshot (intended behaviour)
  const sel = getSel();
  let viewPeriod, emptySelected = false;
  if(sel==null) viewPeriod = latestPeriod;
  else if(hasData(sel)) viewPeriod = sel;
  else if(isTeamView()){ viewPeriod = sel; emptySelected = true; }
  else viewPeriod = latestPeriod;
  const latest = (!emptySelected && viewPeriod!=null) ? data.kpi.find(x=>x.period===viewPeriod) : null;
  // the snapshot immediately before the viewed one — used for trend comparison
  const prev = latest ? reported.find(x=> x.period < latest.period) : null;
  const isLive = !emptySelected && viewPeriod===latestPeriod;
  $('updated').textContent = emptySelected
    ? `No KPI data for ${periodLabel(viewPeriod)} yet — enter it in the Team tab and Save.`
    : latest
      ? `Showing ${periodLabel(latest.period)}${isLive?' (live)':' (archived snapshot)'} · KPI data live from Supabase`
      : 'KPI data will appear here after the first month is reported.';
  // build the month selector (latest + any reported months, + the empty month if team is on one)
  buildMetricsPicker(reported, viewPeriod, latestPeriod, emptySelected);
  $('kpiSub').textContent = emptySelected ? `${periodLabel(viewPeriod)} — no data yet.`
    : latest ? `${periodLabel(latest.period)} against target.` : 'Latest month against target.';

  // hero stats — real ad metrics (spend / reach / link clicks) + project progress
  const delivered = data.deliv.filter(x=>x.status==='delivered').length;
  const hv = (k)=> latest ? N(latest,k) : null;
  // month-aware sublabels: 'this month' when live, else month-specific ('in March').
  const mNote = latest ? monthNote(latest.period, isLive) : 'awaiting data';
  const heroes = [
    {v: fmt$(hv('spend')),   l:'Amount Spent',  cls: hv('spend')!=null?'g':'i', note: mNote},
    {v: fmtNum(hv('reach')), l:'Reach',         cls: hv('reach')!=null?'g':'i', note: latest? `people reached ${mNote}`:'awaiting data'},
    {v: fmtNum(hv('clicks')),l:'Link Clicks',   cls: hv('clicks')!=null?'g':'i', note: mNote},
    {v: data.deliv.length? `${delivered}/${data.deliv.length}`:'—', l:'Deliverables shipped', cls: delivered? 'g':'i', note:'project progress'},
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

  // KPI cards + status board — driven by the real ad metric model; only metrics
  // that actually have a value render (no broken cards for unavailable data).
  safe('performance metrics', ()=>{
    const subtitles = {spend:'total this month', reach:'unique people', impr:'times shown',
      clicks:'link clicks', ctr:'link clicks ÷ impressions', cpm:'spend per 1,000 impressions', cpc:'spend per link click'};
    // delta vs the previous month's snapshot; lowerBetter flips colour for cost metrics
    const trend = (cur, before, opts={})=>{
      if(before==null || cur==null || !isFinite(+before) || !isFinite(+cur) || +before===0) return '';
      const pct = (cur-before)/Math.abs(before)*100;
      if(Math.abs(pct)<0.5) return `<div class="trend flat">±0% vs ${periodLabel(prev.period)}</div>`;
      const up = pct>0, good = opts.lowerBetter ? !up : up;
      return `<div class="trend ${good?'up':'down'}">${up?'▲':'▼'} ${Math.abs(pct).toFixed(0)}% vs ${periodLabel(prev.period)}</div>`;
    };
    // month-aware green sublabel for each card: 'this month' (live) or 'in March' (snapshot)
    const cardNote = latest ? monthNote(latest.period, isLive) : '';
    const cards = CORE_METRICS.map(def=>{
      const v = latest ? metricValue(def, latest) : null;
      if(v==null) return null;                                   // omit metrics with no source data
      const bv = prev ? metricValue(def, prev) : null;
      const info = METRIC_INFO[def.k]
        ? `<button class="metricinfo" type="button" data-metric="${def.k}" title="What is ${def.label}?" aria-label="What is ${def.label}?">ⓘ</button>` : '';
      return `<div class="card"><div class="k">${def.label}${info}</div><div class="big">${def.fmt(v)}</div>`+
        `<div class="tgt">${subtitles[def.k]||''}</div><div class="mnote g">${cardNote}</div>${trend(v, bv, {lowerBetter:def.lowerBetter})}</div>`;
    }).filter(Boolean);
    $('kpiCards').innerHTML = cards.length ? cards.join('')
      : `<div class="note">No ad performance data for this month yet — it syncs automatically from the reporting sheet.</div>`;
    // wire the ⓘ info buttons (client-facing metric explanations, themed popover)
    $('kpiCards').querySelectorAll('.metricinfo').forEach(b=>
      b.onclick = (e)=>{ e.stopPropagation(); openMetricInfo(b.dataset.metric); });

    // secondary: optional ad metrics, shown only when present
    const rows = (latest ? OPTIONAL_METRICS : []).map(def=>{
      const v = metricValue(def, latest); if(v==null) return null;
      return `<div class="srow"><span class="n">${def.label}</span><span class="s g">${def.fmt(v)}</span></div>`;
    }).filter(Boolean);
    $('statusBoard').innerHTML = rows.join('');
    $('statusBoard').style.display = rows.length ? '' : 'none';
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
        if(!await uiConfirm('Delete this update?', 'This removes the posted update from the client feed.', {danger:true})) return;
        const { error } = await sb.from('activity').delete().eq('id', b.dataset.fid);
        if(error) uiAlert('Delete failed', esc(error.message)); else loadAll();
      });
    }
  });

  // team panel + controls only when team AND not previewing as client
  safe('team panel', ()=>{
    syncChrome();
    if(isTeamView()){
      renderTeam(viewPeriod, latestPeriod);
      const rt = $('resetTarget');
      if(rt) rt.textContent = (data.practice && data.practice.name) ? `"${data.practice.name}"` : 'this practice';
    }
  });
}

/* Month selector for performance metrics: 'Latest (live)' + each reported month snapshot.
   Drives the per-practice selection (setSel). emptySelected adds a transient option so
   the dropdown stays in sync when the team sits on a month that has no data yet. */
function buildMetricsPicker(reported, viewPeriod, latestPeriod, emptySelected){
  const sel = $('metricsPicker');
  if(!sel) return;
  if(!reported.length && !emptySelected){ sel.style.display='none'; return; }
  sel.style.display='';
  // oldest → newest in the dropdown
  let opts = ['<option value="">Latest month (live)</option>']
    .concat(reported.slice().sort((a,b)=> (a.period<b.period?-1:a.period>b.period?1:0)).map(r=>
      `<option value="${r.period}">${periodLabel(r.period)}${r.period===latestPeriod?' (latest)':''}</option>`));
  if(emptySelected) opts.push(`<option value="${viewPeriod}">${periodLabel(viewPeriod)} (no data yet)</option>`);
  sel.innerHTML = opts.join('');
  const cur = getSel();
  sel.value = (cur!=null) ? String(cur) : '';
  sel.onchange = ()=>{ setSel(sel.value===''? null : sel.value); render(); };
}

/* ---------------- team controls ---------------- */
// The team's reporting month is the SAME per-practice selection that drives the
// client view: the <input type="month"> below IS that selector, so the top label,
// the KPI cards and the entry form always move together.
function renderTeam(viewPeriod, latestPeriod){
  const inp = $('inMonth'); // an <input type="month"> — value is 'YYYY-MM'
  if(!inp.dataset.wired){
    inp.dataset.wired = '1';
    inp.onchange = ()=>{ setSel(monthInputToPeriod(inp.value)); render(); };
  }
  // reflect the resolved view month (or today's, for a brand-new client with no data)
  inp.value = periodToMonthInput(viewPeriod || latestPeriod || currentPeriod());
  const yr = $('inYear'); if(yr && !yr.value) yr.value = new Date().getFullYear();
  fillKpiForm();
}
function entryPeriod(){ return monthInputToPeriod($('inMonth').value); }   // the month the team form targets
function fillKpiForm(){
  const m = data.kpi.find(x=>x.period===entryPeriod()) || {};
  $('entryFields').innerHTML = FIELDS.map(f=>
    `<div class="f"><label>${f.l}</label><input data-k="${f.k}" type="number" step="any" value="${m[f.k]??''}" placeholder="0"></div>`).join('');
}
const flash = t=>{ $('saveMsg').textContent=t; setTimeout(()=>$('saveMsg').textContent='',3500); };

$('btnSaveKpi').onclick = async ()=>{
  const period = entryPeriod();
  if(!period){ flash('Pick a month first.'); return; }
  const row = { practice_id: practiceId, period, source: KPI_SOURCE };
  document.querySelectorAll('#entryFields input').forEach(i=>{ row[i.dataset.k] = i.value===''? null : +i.value; });
  const { error } = await sb.from('kpi_monthly').upsert(row, { onConflict:'practice_id,period,source' });
  if(!error) setSel(period);   // after saving a month, view it
  flash(error? error.message : `Saved ${periodLabel(period)}.`); if(!error) loadAll();
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

/* ---------------- themed dialogs (replace native confirm/alert/prompt) ---------------- */
// Promise-based, styled to match the portal. `body` may contain simple HTML.
function uiDialog({title='', body='', input=null, confirmLabel='Confirm', cancelLabel='Cancel', danger=false, requireText=null}){
  return new Promise(resolve=>{
    const ov = document.createElement('div');
    ov.className = 'dlg-overlay';
    ov.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">
      ${title?`<div class="dlg-head">${esc(title)}</div>`:''}
      ${body?`<div class="dlg-body">${body}</div>`:''}
      ${input!==null?`<input class="dlg-input" id="__dlgInput" placeholder="${esc(input.placeholder||'')}" value="${esc(input.value||'')}">`:''}
      ${requireText?`<input class="dlg-input" id="__dlgReq" autocomplete="off" placeholder="Type the name to confirm">`:''}
      <div class="dlg-actions">
        ${cancelLabel?`<button class="btn ghost sm" id="__dlgCancel">${esc(cancelLabel)}</button>`:''}
        <button class="btn sm ${danger?'danger':''}" id="__dlgOk">${esc(confirmLabel)}</button>
      </div></div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(()=> ov.classList.add('show'));
    const inputEl = ov.querySelector('#__dlgInput');
    const reqEl = ov.querySelector('#__dlgReq');
    const done = val => { ov.classList.remove('show'); setTimeout(()=>ov.remove(),160); document.removeEventListener('keydown', onKey); resolve(val); };
    const cancelVal = () => input!==null ? null : false;
    const ok = ()=>{
      if(requireText && (reqEl.value.trim()!==requireText)){ reqEl.classList.add('bad'); reqEl.focus(); return; }
      done(input!==null ? inputEl.value : true);
    };
    function onKey(e){
      if(e.key==='Escape') done(cancelVal());
      else if(e.key==='Enter' && document.activeElement?.tagName!=='TEXTAREA'){ e.preventDefault(); ok(); }
    }
    ov.querySelector('#__dlgOk').onclick = ok;
    const cancelBtn = ov.querySelector('#__dlgCancel'); if(cancelBtn) cancelBtn.onclick = ()=> done(cancelVal());
    ov.addEventListener('mousedown', e=>{ if(e.target===ov) done(cancelVal()); });
    document.addEventListener('keydown', onKey);
    setTimeout(()=> (inputEl||reqEl||ov.querySelector('#__dlgOk')).focus(), 30);
  });
}
const uiConfirm = (title, body='', opts={}) => uiDialog({title, body, danger:opts.danger, confirmLabel:opts.confirmLabel||'Confirm', requireText:opts.requireText});
const uiAlert   = (title, body='') => uiDialog({title, body, cancelLabel:'', confirmLabel:'OK'}).then(()=>{});
const uiPrompt  = (title, body='', value='', placeholder='') => uiDialog({title, body, input:{value,placeholder}, confirmLabel:'Save'});

// Client-facing metric explainer — opens the themed dialog (same look as the rest of
// the portal, no default browser UI) describing what a metric is, why it matters, and
// how to read higher vs lower values.
function openMetricInfo(key){
  const m = METRIC_INFO[key]; if(!m) return;
  const body = `<div class="metricdef">
    <div class="mdrow"><div class="mdlabel">What it is</div><div>${esc(m.what)}</div></div>
    <div class="mdrow"><div class="mdlabel">Why it matters</div><div>${esc(m.why)}</div></div>
    <div class="mdrow"><div class="mdlabel">Higher</div><div>${esc(m.higher)}</div></div>
    <div class="mdrow"><div class="mdlabel">Lower</div><div>${esc(m.lower)}</div></div>
  </div>`;
  uiDialog({title:m.label, body, cancelLabel:'', confirmLabel:'Got it'});
}

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
      if(!await uiConfirm(`Delete the "${phase}" phase?`, 'This removes the phase and <b>all</b> of its deliverables.', {danger:true})) return;
      const { error } = await sb.from('deliverables').delete().eq('practice_id',practiceId).eq('phase',phase);
      if(error){ uiAlert('Delete failed', esc(error.message)); return; }
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
  const name = await uiPrompt('New deliverable', `Adding to the "${esc(phase)}" phase.`, '', 'Deliverable name'); if(name===null) return;
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
  const v = await uiPrompt(`Client explanation`, `Shown to the client under an ⓘ icon for “${esc(d.name)}”. Leave blank to remove.`, d.description||'', 'What this deliverable means…');
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
  const item = await uiPrompt('New video asset', '', '', 'e.g. SEO video — facelift recovery');
  if(item===null) return;            // cancelled
  if(!item.trim()){ flash('Enter a name.'); return; }
  try{
    const { error } = await sb.from('video_pipeline')
      // new assets default to 'planned' (backlog) unless added from a specific column
      .insert({ practice_id: practiceId, item: item.trim(), stage: stage || 'planned' })
      .select();
    if(error){ flash('Add failed: '+error.message); uiAlert('Add failed', esc(error.message)); return; }
    flash('Video added.');
    await loadAll();
  }catch(e){
    flash('Add failed: '+e.message); uiAlert('Add failed', esc(e.message));
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
      if(!await uiConfirm('Delete this history entry?', 'Removes this stage-change record from the timeline.', {danger:true})) return;
      const { data: del, error } = await sb.from('video_history').delete().eq('id', b.dataset.hid).select();
      if(error){ uiAlert('Delete failed', esc(error.message)); return; }
      if(!del || !del.length){ uiAlert('Delete failed', 'No permission (row-level security). Run the latest migration.'); return; }
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
  if(!await uiConfirm('Delete', esc(confirmMsg), {danger:true})) return;
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
  const msg = await uiPrompt('Edit update', 'The client sees the latest version.', f.message, 'Update message');
  if(msg===null) return;
  if(!msg.trim()){ uiAlert('Message cannot be empty'); return; }
  const { error } = await sb.from('activity').update({ message: msg.trim(), edited_at: new Date().toISOString() }).eq('id', id);
  if(error) uiAlert('Edit failed', esc(error.message)); else loadAll();
}

$('btnPost').onclick = async ()=>{
  const msg = $('updMsg').value.trim(); if(!msg) return;
  const { error } = await sb.from('activity').insert({ practice_id: practiceId, message: msg, author: me.full_name||'ROXIUM', source:'portal' });
  flash(error? error.message : 'Posted.'); $('updMsg').value=''; if(!error) loadAll();
};

/* ---- ONBOARDING & ACCESS (admin + client owners) ---- */
const onbFlash = t=>{ const el=$('onbMsg'); if(el){ el.textContent=t; setTimeout(()=>{ if(el.textContent===t) el.textContent=''; }, 8000); } };
const accessFlash = t=>{ const el=$('clientAccessMsg'); if(el){ el.textContent=t; setTimeout(()=>{ if(el.textContent===t) el.textContent=''; }, 8000); } };

function showOnboardChecklist(pid, name){
  const el = $('onboardChecklist'); if(!el) return;
  el.classList.remove('hidden');
  el.dataset.practiceId = pid;
  el.innerHTML = `<div class="onboard-title">Onboarding · <b>${esc(name)}</b></div>
    <ol class="onboard-steps" id="onboardSteps">
      <li data-step="access" class="onboard-pending">Add doctor / team access (section 3)</li>
      <li data-step="sheet" class="onboard-pending">Configure reporting sheet (section 4)</li>
      <li data-step="coefficient" class="onboard-pending">Connect Coefficient to that sheet tab</li>
      <li data-step="sync" class="onboard-pending">Run first KPI sync</li>
    </ol>
    <p class="note onboard-hint">Complete each step — status updates automatically.</p>`;
  const ap = $('accessPractice'); if(ap) ap.value = pid;
  loadAccessRoster(pid);
  refreshOnboardChecklist(pid);
}

async function refreshOnboardChecklist(pid){
  const el = $('onboardChecklist'); if(!el || !pid) return;
  const steps = el.querySelector('#onboardSteps'); if(!steps) return;
  const { data, error } = await sb.rpc('get_practice_onboarding_status', { p_practice: pid });
  if(error) return; // migration not applied yet — static checklist still shows
  const mark = (step, done)=> {
    const li = steps.querySelector(`[data-step="${step}"]`);
    if(!li) return;
    li.classList.toggle('onboard-done', done);
    li.classList.toggle('onboard-pending', !done);
  };
  mark('access', !!data?.has_access);
  mark('sheet', !!data?.has_sheet);
  mark('coefficient', !!data?.has_sheet); // manual step — sheet config is the gate
  mark('sync', !!data?.has_sync);
}

async function sendPracticeInvite(practice_id, email, full_name, role, { sendEmail = true } = {}){
  if(sendEmail){
    const { data, error } = await sb.functions.invoke('invite-user', {
      body: { email, practice_id, full_name, role }
    });
    if(error) throw error;
    if(data && data.error) throw new Error(data.error);
    return data;
  }
  const { data, error } = await sb.rpc('add_practice_invite', {
    p_practice: practice_id,
    p_email: email,
    p_full_name: full_name || null,
    p_role: role,
  });
  if(error) throw error;
  return { ok: true, allowlisted: true, invite_id: data };
}

function renderRoster(wrap, roster, opts){
  if(!wrap) return;
  const members = roster?.members || [];
  const invites = roster?.invites || [];
  if(!members.length && !invites.length){
    wrap.innerHTML = '<div class="note">No team members yet — send an invite above.</div>';
    return;
  }
  const memRows = members.map(m=>{
    const plat = m.is_platform_admin ? ' <span class="badge-plat">ROXIUM</span>' : '';
    const self = m.is_self ? ' <span class="badge-self">you</span>' : '';
    const rmBtn = m.can_remove
      ? `<button class="btn ghost sm danger" data-rmuser="${m.user_id}">Remove</button>`
      : `<span class="note" title="${esc(m.is_self ? 'Cannot remove yourself' : 'Protected')}">—</span>`;
    return `<div class="rosterrow">
      <span class="rosteremail">${esc(m.email||'—')}${plat}${self}</span>
      <span class="rosterrole">${esc(m.role)}</span>
      <span class="rosterstatus ok">active</span>
      ${opts.canRemove ? rmBtn : ''}
    </div>`;
  }).join('');
  const invRows = invites.map(i=>{
    const revokeBtn = (opts.canRevoke && i.can_revoke !== false)
      ? `<button class="btn ghost sm" data-revoke="${i.id}">Revoke</button>`
      : `<span class="note" title="Cannot revoke the last owner invite">—</span>`;
    return `<div class="rosterrow pending">
      <span class="rosteremail">${esc(i.email)}</span>
      <span class="rosterrole">${esc(i.role)}</span>
      <span class="rosterstatus">${esc(i.status)}</span>
      ${revokeBtn}
    </div>`;
  }).join('');
  wrap.innerHTML = `<div class="rosterhead"><span>Email</span><span>Role</span><span>Status</span><span></span></div>`
    + memRows + invRows;
  if(opts.canRemove){
    wrap.querySelectorAll('[data-rmuser]').forEach(b=> b.onclick = async ()=>{
      if(!await uiConfirm('Remove member', 'Remove this person\'s access to the practice?', {danger:true})) return;
      const { error } = await sb.rpc('remove_practice_member', { p_practice: opts.practiceId, p_user: b.dataset.rmuser });
      if(error) uiAlert('Cannot remove', esc(error.message));
      else { opts.flash?.('Member removed.') || onbFlash('Member removed.'); opts.reload(); }
    });
  }
  if(opts.canRevoke){
    wrap.querySelectorAll('[data-revoke]').forEach(b=> b.onclick = async ()=>{
      const { error } = await sb.rpc('revoke_practice_invite', { p_invite: b.dataset.revoke });
      if(error) uiAlert('Cannot revoke', esc(error.message));
      else { opts.flash?.('Invite revoked.') || onbFlash('Invite revoked.'); opts.reload(); }
    });
  }
}

function renderPlatformAdmins(data){
  const wrap = $('platformAdminRoster'); if(!wrap) return;
  const admins = data?.admins || [];
  if(!admins.length){ wrap.innerHTML = '<div class="note">No platform administrators found.</div>'; return; }
  const cnt = data?.admin_count ?? admins.length;
  wrap.innerHTML = `<div class="rosterhead"><span>Email</span><span></span><span></span><span></span></div>`
    + admins.map(a=>{
      const self = a.is_self ? ' <span class="badge-self">you</span>' : '';
      const demote = a.can_demote
        ? `<button class="btn ghost sm danger" data-demote="${a.user_id}">Remove admin</button>`
        : `<span class="note" title="${a.is_self ? 'Cannot remove your own admin access' : 'Cannot remove the only administrator'}">—</span>`;
      return `<div class="rosterrow">
        <span class="rosteremail">${esc(a.email||'—')}${self}</span>
        <span class="rosterrole">platform</span>
        <span class="rosterstatus ok">active</span>
        ${demote}
      </div>`;
    }).join('')
    + (cnt <= 1 ? `<p class="note" style="padding:8px 12px">Only administrator — self-removal is blocked.</p>` : '');
  wrap.querySelectorAll('[data-demote]').forEach(b=> b.onclick = async ()=>{
    if(!await uiConfirm('Remove platform admin', 'This person will lose access to the Admin panel. Continue?', {danger:true})) return;
    const { error } = await sb.rpc('demote_platform_admin', { p_user: b.dataset.demote });
    if(error) uiAlert('Cannot remove admin', esc(error.message));
    else { onbFlash('Administrator access removed.'); loadPlatformAdmins(); }
  });
}

async function loadPlatformAdmins(){
  const wrap = $('platformAdminRoster'); if(!wrap || !isTeamView()) return;
  const { data, error } = await sb.rpc('get_platform_admins');
  if(error){
    wrap.innerHTML = '<div class="note">Run migration 2026-06-24_access_guardrails.sql to enable platform admin controls.</div>';
    return;
  }
  renderPlatformAdmins(data);
}

const promoteFlash = t=>{ const el=$('promoteMsg'); if(el){ el.textContent=t; setTimeout(()=>{ if(el.textContent===t) el.textContent=''; }, 7000); } };
$('btnPromoteAdmin').onclick = async ()=>{
  if(!isTeamView()) return;
  const email = $('promoteEmail').value.trim();
  if(!email){ promoteFlash('Enter an email to promote.'); return; }
  $('btnPromoteAdmin').disabled = true; promoteFlash('Granting admin access…');
  try{
    const { error } = await sb.rpc('promote_platform_admin', { p_email: email });
    if(error) throw error;
    $('promoteEmail').value = '';
    promoteFlash(`${email} is now a platform administrator.`);
    loadPlatformAdmins();
  }catch(e){ promoteFlash(e.message || String(e)); }
  finally{ $('btnPromoteAdmin').disabled = false; }
};

async function loadAccessRoster(pid){
  const wrap = $('accessRoster'); if(!wrap || !pid) return;
  const { data, error } = await sb.rpc('get_practice_roster', { p_practice: pid });
  if(error){ wrap.innerHTML = `<div class="note">Could not load roster — run migration 2026-06-24_practice_invites_and_access.sql</div>`; return; }
  renderRoster(wrap, data, {
    practiceId: pid, canRemove: true, canRevoke: true,
    reload: ()=> loadAccessRoster(pid),
    flash: onbFlash,
  });
}

async function loadClientAccessRoster(){
  const wrap = $('clientRoster'); if(!wrap || !practiceId) return;
  const { data, error } = await sb.rpc('get_practice_roster', { p_practice: practiceId });
  if(error){ wrap.innerHTML = '<div class="note">Could not load team list.</div>'; return; }
  renderRoster(wrap, data, {
    practiceId, canRemove: true, canRevoke: true,
    reload: ()=> loadClientAccessRoster(),
    flash: accessFlash,
  });
}

$('btnAddClient').onclick = async ()=>{
  if(!isTeamView()) return;
  const name = $('newClientName').value.trim();
  const kickoff = $('newClientKickoff').value || new Date().toISOString().slice(0,10);
  if(!name){ onbFlash('Enter a practice name.'); return; }
  const dupe = practicesList.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
  if(dupe){
    if(await uiConfirm('Practice already exists', `“${esc(dupe.name)}” already exists. Switch to it instead?`, {confirmLabel:'Switch to it'})){
      practiceId = dupe.id; $('newClientName').value=''; buildSwitcher(practicesList); loadAll();
      showOnboardChecklist(dupe.id, dupe.name);
    } else onbFlash('No duplicate created.');
    return;
  }
  $('btnAddClient').disabled = true; onbFlash('Creating…');
  try{
    const { data, error } = await sb.rpc('seed_practice', { p_name: name, p_kickoff: kickoff });
    if(error) throw error;
    $('newClientName').value = '';
    await loadTeamPractices();
    renderAdminClients();
    if(data){ practiceId = data; showOnboardChecklist(data, name); }
    onbFlash(`Created "${name}". Complete the checklist below.`);
    loadAll();
  }catch(e){ onbFlash('Could not add client: '+e.message); }
  finally{ $('btnAddClient').disabled = false; }
};

$('btnInvite').onclick = async ()=>{
  if(!isTeamView()) return;
  const practice_id = $('accessPractice').value;
  const email = $('accessEmail').value.trim();
  const full_name = $('accessName').value.trim();
  const role = $('accessRole').value || 'member';
  const sendEmail = $('accessSendEmail')?.checked !== false;
  if(!email || !practice_id){ onbFlash('Email and practice are required.'); return; }
  $('btnInvite').disabled = true; onbFlash(sendEmail ? 'Sending invite…' : 'Adding to allowlist…');
  try{
    const data = await sendPracticeInvite(practice_id, email, full_name, role, { sendEmail });
    $('accessEmail').value=''; $('accessName').value='';
    onbFlash(sendEmail
      ? (data?.invited===false
          ? `${email} already had an account — linked and allowlisted.`
          : `Invite sent to ${email} (allowlisted).`)
      : `${email} allowlisted — they can sign up with that email anytime.`);
    loadAccessRoster(practice_id);
    refreshOnboardChecklist(practice_id);
  }catch(e){
    onbFlash('Invite failed: '+(e.message||e)+(sendEmail ? ' (is invite-user deployed?)' : ''));
  }finally{ $('btnInvite').disabled = false; }
};

$('btnClientInvite').onclick = async ()=>{
  if(!canSeeAccessTab() || !practiceId) return;
  const email = $('clientInviteEmail').value.trim();
  const full_name = $('clientInviteName').value.trim();
  if(!email){ accessFlash('Enter an email.'); return; }
  $('btnClientInvite').disabled = true; accessFlash('Sending invite…');
  try{
    const data = await sendPracticeInvite(practiceId, email, full_name, 'member');
    $('clientInviteEmail').value=''; $('clientInviteName').value='';
    accessFlash(data?.invited===false ? `${email} linked and allowlisted.` : `Invite sent to ${email}.`);
    loadClientAccessRoster();
  }catch(e){ uiAlert('Invite failed', esc(e.message||String(e))); }
  finally{ $('btnClientInvite').disabled = false; }
};

// ---- Admin: per-client sheet config + delete ----
const adminDelFlash = t=>{ const el=$('adminDelMsg'); if(el){ el.textContent=t; setTimeout(()=>{ if(el.textContent===t) el.textContent=''; }, 6000); } };
// per-client reporting-sheet sources (practice_id -> sheet_sources row)
let sheetSources = {};
let syncRuns = [];   // recent rows from the sync_runs audit table (newest first)

// compact relative time ('3m ago', '2h ago', 'just now', 'yesterday') for sync recency
function ago(ts){
  if(!ts) return 'never';
  const then = new Date(ts).getTime(); if(!isFinite(then)) return 'never';
  const s = Math.max(0, Math.round((Date.now()-then)/1000));
  if(s<45) return 'just now';
  const m = Math.round(s/60); if(m<60) return `${m}m ago`;
  const h = Math.round(m/60); if(h<24) return `${h}h ago`;
  const d = Math.round(h/24); return d===1 ? 'yesterday' : `${d}d ago`;
}
// 'YYYY-MM-01'/'YYYY-MM' month keys -> 'Mar, Apr, May' for the synced-months chip
function monthsList(arr){
  if(!arr || !arr.length) return '';
  return arr.slice().sort().map(p=> monthName(p+(String(p).length<=7?'-01':'')).slice(0,3)).filter(Boolean).join(', ');
}
async function loadSheetSources(){
  if(!isTeamView()) return;
  const { data } = await sb.from('sheet_sources').select('*');
  sheetSources = {}; (data||[]).forEach(s=> sheetSources[s.practice_id]=s);
  // pull the recent sync-run audit log (may not exist until the observability
  // migration is applied — fail soft so the admin panel still renders)
  try{
    const { data: runs } = await sb.from('sync_runs')
      .select('*').order('ran_at',{ascending:false}).limit(10);
    syncRuns = runs || [];
  }catch(_){ syncRuns = []; }
  renderSyncStatus();
  renderAdminClients();
}

// Sync observability banner: did the 2-hour automation run, when, how many rows,
// and did anything fail? Reads the most recent sync_runs audit row.
function renderSyncStatus(){
  const el = $('syncStatus'); if(!el) return;
  if(!isTeamView()){ el.innerHTML=''; return; }
  const last = syncRuns[0];
  const srcVals = Object.values(sheetSources);
  const anyError = srcVals.some(s=> s.last_status==='error');
  if(!last){
    // no audit rows yet — fall back to the sheet_sources last_synced_at
    const lastSheet = srcVals.map(s=>s.last_synced_at).filter(Boolean).sort().pop();
    const cls = anyError ? 'err' : (lastSheet ? 'ok' : 'warn');
    const txt = lastSheet
      ? `Last sync ${ago(lastSheet)} (${new Date(lastSheet).toLocaleString()}).${anyError?' Some clients reported errors — see below.':''}`
      : 'No sync has been recorded yet. The automation runs every 2 hours; use “Sync now” to test it.';
    el.innerHTML = `<div class="syncbanner ${cls}">
      <div class="sbtitle">Auto-sync ${lastSheet?'is configured':'not yet observed'}</div>
      <div class="sbtext">${esc(txt)}</div></div>`;
    return;
  }
  const cls = last.ok===false ? 'err' : (last.skipped_count? 'warn':'ok');
  const when = `${ago(last.ran_at)} · ${new Date(last.ran_at).toLocaleString()}`;
  const trig = last.trigger==='manual' ? 'manual (Sync now)' : (last.trigger || 'scheduled');
  const months = monthsList(last.months_seen);
  const rows = syncRuns.slice(0,5).map(r=>`<tr>
      <td>${esc(ago(r.ran_at))}</td>
      <td>${r.ok===false?'<span class="ssbad">failed</span>':'<span class="ssok">ok</span>'}</td>
      <td>${esc(String(r.trigger||'scheduled'))}</td>
      <td>${r.upserted ?? 0}</td>
      <td>${r.skipped_count ?? 0}</td>
      <td>${esc(monthsList(r.months_seen)||'—')}</td>
    </tr>`).join('');
  el.innerHTML = `<div class="syncbanner ${cls}">
      <div class="sbtitle">${last.ok===false?'Last auto-sync FAILED':'Auto-sync is running'}</div>
      <div class="sbtext">Last run <b>${esc(when)}</b> · trigger: ${esc(trig)} · wrote <b>${last.upserted ?? 0}</b> KPI row(s)${last.skipped_count?` · skipped ${last.skipped_count}`:''}${months?` · months: ${esc(months)}`:''}.${last.error?` Error: ${esc(last.error)}`:''}</div>
    </div>
    <table class="synctable"><thead><tr><th>When</th><th>Status</th><th>Trigger</th><th>Rows</th><th>Skipped</th><th>Months</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Admin · pull every active sheet_sources CSV into kpi_monthly (team JWT auth).
$('btnSyncNow').onclick = async ()=>{
  if(!isTeamView()) return;
  const row = document.querySelector('.syncnowrow');
  const msg = $('syncNowMsg');
  const btn = $('btnSyncNow');
  row?.classList.remove('ok','err');
  row?.classList.add('syncing');
  btn.disabled = true;
  msg.textContent = 'Syncing…';
  try{
    const { data, error } = await sb.functions.invoke('sync-coefficient', { body:{ trigger:'manual' } });
    if(error) throw error;
    if(!data?.ok) throw new Error(data?.error || 'Sync failed');
    const skip = data.skipped_count || 0;
    const parts = [`Synced ${data.upserted ?? 0} row(s)`];
    if(skip) parts.push(`skipped ${skip}`);
    const months = monthsList(data.months_seen);
    if(months) parts.push(`months: ${months}`);
    if(data.rows_seen === 0) parts.push('no rows parsed — check sheet sources and headers');
    msg.textContent = parts.join(' · ');
    row?.classList.add('ok');
    await loadSheetSources();
    const pid = $('onboardChecklist')?.dataset?.practiceId || $('accessPractice')?.value;
    if(pid) refreshOnboardChecklist(pid);
    if(practiceId) loadAll();
  }catch(e){
    const m = e?.message || String(e);
    msg.textContent = m.includes('401') || /unauthorized/i.test(m)
      ? 'Sync unauthorized — redeploy sync-coefficient with team-login support, or check SYNC_SECRET for cron.'
      : 'Sync failed: '+m;
    row?.classList.add('err');
  }finally{
    row?.classList.remove('syncing');
    btn.disabled = false;
  }
};
function renderAdminClients(){
  const wrap = $('adminClientList'); if(!wrap) return;
  if(!isTeamView()){ wrap.innerHTML=''; return; }
  const list = practicesList || [];
  wrap.innerHTML = list.length ? list.map(p=>{
    const s = sheetSources[p.id]||{};
    // per-client sync detail: when, success/fail, rows written and months seen
    const detail = [];
    if(s.last_rows!=null) detail.push(`${s.last_rows} row(s)`);
    const sm = monthsList(s.last_months); if(sm) detail.push(sm);
    const dtxt = detail.length ? ` (${detail.join(' · ')})` : '';
    const status = s.last_status==='error'
        ? `<span class="ssbad" title="${esc(s.last_error||'')}">⚠ sync error · ${esc(ago(s.last_synced_at))}</span>`
      : s.last_synced_at
        ? `<span class="ssok" title="${esc(new Date(s.last_synced_at).toLocaleString())}">✓ synced ${esc(ago(s.last_synced_at))}${dtxt}</span>`
      : (s.csv_url? `<span class="note">awaiting first sync</span>`:'');
    // Preferred (secure) config is a private Sheet ID + tab — the sheet is shared only
    // with the backend service account, so no public CSV link is needed or exposed.
    // The legacy CSV field stays available but secondary.
    return `<div class="clientrow2">
      <div class="ccol"><span class="cname">${esc(p.name)}</span> ${status}</div>
      <div class="sheetcfg">
        <input class="cellinput sheetid" data-pid="${p.id}" value="${esc(s.sheet_id||'')}" placeholder="Private Google Sheet ID (preferred — share with the backend service account)">
        <input class="cellinput sheettab" data-pid="${p.id}" value="${esc(s.tab_name||'')}" placeholder="Tab name (optional)">
        <input class="cellinput sheeturl" data-pid="${p.id}" value="${esc(s.csv_url||'')}" placeholder="Legacy published-CSV URL (being phased out)">
      </div>
      <button class="btn ghost sm" data-savesheet="${p.id}">Save sheet</button>
      <button class="btn ghost sm danger" data-delpractice="${p.id}" data-name="${esc(p.name)}">Delete</button>
    </div>`;
  }).join('') : '<div class="note">No practices yet — add one above.</div>';
  wrap.querySelectorAll('[data-delpractice]').forEach(b=>
    b.onclick = ()=> deletePractice(b.dataset.delpractice, b.dataset.name));
  wrap.querySelectorAll('[data-savesheet]').forEach(b=>
    b.onclick = ()=> saveSheetSource(b.dataset.savesheet));
}
async function saveSheetSource(pid){
  if(!isTeamView()) return;
  const sheet_id = (document.querySelector(`.sheetid[data-pid="${pid}"]`)?.value||'').trim();
  const tab_name = (document.querySelector(`.sheettab[data-pid="${pid}"]`)?.value||'').trim();
  const csv_url  = (document.querySelector(`.sheeturl[data-pid="${pid}"]`)?.value||'').trim();
  // a private Sheet ID is the secure source type; CSV remains for the legacy mode
  const source_type = sheet_id ? 'google_sheet_private' : 'google_sheet_csv';
  const { error } = await sb.from('sheet_sources')
    .upsert({ practice_id: pid, sheet_id: sheet_id||null, tab_name: tab_name||null, csv_url: csv_url||null,
              is_active:true, source_type }, { onConflict:'practice_id' });
  adminDelFlash(error? 'Sheet save failed: '+error.message : 'Reporting sheet saved — it will sync on the next run.');
  if(!error){ loadSheetSources(); refreshOnboardChecklist(pid); }
}
async function deletePractice(id, name){
  if(!isTeamView()) return;
  // single themed dialog: confirmation message + type-the-name-to-confirm guard
  const ok = await uiConfirm(`Delete “${name}”?`,
    `This permanently removes the practice and <b>all</b> of its data — KPIs, deliverables, roadmap, video pipeline, history, updates and its client logins. This cannot be undone.`,
    { danger:true, confirmLabel:'Delete practice', requireText:name });
  if(!ok) return;
  adminDelFlash('Deleting…');
  try{
    const { error } = await sb.rpc('delete_practice', { p_id: id });
    if(error) throw error;
    delete selByPractice[id];
    if(practiceId===id){ practiceId = null; }  // we deleted the open one
    await loadTeamPractices();
    if(!practiceId && practicesList[0]) practiceId = practicesList[0].id;  // fall back to another practice
    renderAdminClients();
    adminDelFlash(`"${name}" was deleted.`);
    if(practiceId) loadAll();
  }catch(e){ adminDelFlash('Delete failed: '+(e.message||e)); }
}

/* ---- DANGER ZONE: reset all data for the currently-selected practice (team only) ---- */
const resetFlash = t=>{ const el=$('resetMsg'); if(el){ el.textContent=t; setTimeout(()=>{ if(el.textContent===t) el.textContent=''; }, 6000); } };
$('btnResetData').onclick = async ()=>{
  if(!isTeamView()){ return; }                 // safety: team-only, never in client preview
  if(!practiceId){ resetFlash('No practice selected.'); return; }
  const name = (data.practice && data.practice.name) || 'this practice';

  // single themed dialog with a type-the-name guard against accidental wipes
  const ok = await uiConfirm(`Reset all data for “${name}”?`,
    `This permanently deletes every KPI month, the activity / updates feed, all notifications and video stage history, and resets all deliverables, milestones and videos to their starting state. This cannot be undone.`,
    { danger:true, confirmLabel:'Reset everything', requireText:name });
  if(!ok) return;

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
    uiAlert('Reset failed', esc(e.message));
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
