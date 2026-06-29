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
// pretty calendar date from 'YYYY-MM-DD'. style 'month' -> 'Mar 2026'; default -> 'Mar 15, 2026'.
function prettyDate(d, style){
  if(!d) return '';
  const [y,m,day] = String(d).slice(0,10).split('-').map(Number);
  if(!y||!m) return '';
  const mn = (MONTH_NAMES[m-1]||'').slice(0,3);
  return style==='month' ? `${mn} ${y}` : `${mn} ${day}, ${y}`;
}
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
let authEmail = '';       // signed-in user's email (display-name fallback)
let myMembership = null;    // current practice membership { role: owner|member }
let practiceId = null;    // active practice
let previewMode = false;  // team viewing the client-side version
// Selected reporting month is scoped PER PRACTICE so one client's choice can never
// leak into another's. Absent key = follow that practice's latest reported month.
let selByPractice = {};   // practiceId -> 'YYYY-MM-01'
let monthSelApi = null;   // themed "Reporting month" dropdown instance (team)
let metricsSelApi = null; // themed month dropdown instance (client dashboard)
const getSel = () => (practiceId && practiceId in selByPractice) ? selByPractice[practiceId] : null;
const setSel = p => { if(!practiceId) return; if(p==null) delete selByPractice[practiceId]; else selByPractice[practiceId]=p; };
// Ad channel (kpi source) selection, also scoped per-practice. 'all' = every channel
// summed together. Absent = 'all'.
let chanByPractice = {};   // practiceId -> 'all' | 'marketing' | 'google_ads' | …
const getChan = () => (practiceId && practiceId in chanByPractice) ? chanByPractice[practiceId] : 'all';
const setChan = c => { if(!practiceId) return; if(c==null||c==='all') delete chanByPractice[practiceId]; else chanByPractice[practiceId]=c; };
// canonical channel/source key — fold Meta's aliases into 'marketing' so a source is
// attributed to exactly one channel (no split/duplicate channels, consistent math).
const sourceKey = s => (!s || s==='meta' || s==='coefficient') ? 'marketing' : String(s).trim();

// One row per (period, canonical source) — keeps marketing/meta/coefficient from
// double-counting in aggregate, and uses the most recently updated row per key.
function normalizeKpiRows(rows){
  const byKey = new Map();
  const ordered = [...rows].sort((a,b)=> new Date(a.updated_at||0) - new Date(b.updated_at||0));
  for(const r of ordered){
    const canon = sourceKey(r.source);
    byKey.set(`${r.period}|${canon}`, { ...r, source: canon });
  }
  return [...byKey.values()];
}

// Channels that currently have KPI data for this practice (after normalization).
function kpiSourcesPresent(){
  return [...new Set(normalizeKpiRows(data.kpiRaw||[]).map(r=> r.source))];
}
// Known source presets (Meta = the legacy 'marketing' source). Each is one TAB in a
// client's master workbook; the list seeds the admin "add source" picker and channel
// labels. Sources are open-ended — a custom key works too, this is just the menu.
const CHANNELS = [
  { source:'marketing',           label:'Meta Ads' },
  { source:'instagram_insights',  label:'Instagram Insights' },
  { source:'google_ads',          label:'Google Ads' },
  { source:'facebook_insights',   label:'Facebook Insights' },
  { source:'youtube_analytics',   label:'YouTube Analytics' },
  { source:'microsoft_ads',       label:'Microsoft Ads' },
  { source:'page_engagement',     label:'Page Engagement' },
];
const channelLabel = src => (!src || ['marketing','meta','coefficient'].includes(src))
  ? 'Meta Ads'
  : (CHANNELS.find(c=>c.source===src)?.label || src.replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase()));
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
// remember the last client-side view and the last admin sub-tab for smooth two-way nav
let lastClientView = 'roadmap';
let lastAdminTab = localStorage.getItem('lastAdminTab') || 'clients';
function activateAdminTab(name){
  name = name || 'clients';
  if(!document.querySelector(`#adminTabs .atab[data-atab="${name}"]`)) name = 'clients';
  document.querySelectorAll('#adminTabs .atab').forEach(t=> t.classList.toggle('active', t.dataset.atab===name));
  document.querySelectorAll('.admin-tab').forEach(p=> p.classList.toggle('hidden', p.dataset.atab!==name));
  lastAdminTab = name; localStorage.setItem('lastAdminTab', name);
}
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
  if(name !== 'admin') lastClientView = name;          // remember where to return on "Back to client portal"
  document.querySelectorAll('.view').forEach(v=> v.classList.toggle('active', v.dataset.view===name));
  document.querySelectorAll('.tab').forEach(t=> t.classList.toggle('active', t.dataset.view===name));
  syncChrome();
  if(name==='admin'){
    activateAdminTab(lastAdminTab);                     // land on the last admin sub-tab I used
    renderAdminClients(); loadSheetSources(); loadPlatformAdmins(); loadAppSettings();
    enhanceSelectsIn($('adminPanel'));                  // theme practice/role selects
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
  // team-only entry; hidden while in admin so the only back affordance is the top
  // "← Back to client portal" link (no duplicate back control).
  $('btnAdmin').classList.toggle('hidden', !teamView || adminMode);
  $('btnAdmin').textContent = '⚙ Admin';
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
// Toggle: in admin → back to the client portal (last client view); else → admin.
$('btnAdmin').onclick = ()=>{
  location.hash = (currentView()==='admin') ? '#'+(lastClientView||'roadmap') : '#admin';
};
$('btnAdminBack')?.addEventListener('click', e=>{ e.preventDefault(); location.hash = '#'+(lastClientView||'roadmap'); });

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
    enhanceNativeSelect(sel);   // wrap + re-sync the themed overlay to new options/value
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

// Display name = the real profile name, else the email prefix — never blank or a
// random id. (The name is user-editable via the whoami chip → set_my_name RPC.)
function displayName(){
  const n = (me && me.full_name || '').trim();
  if(n) return n;
  return authEmail ? authEmail.split('@')[0] : 'Account';
}
function renderWhoami(){
  if(!me) return;
  $('whoami').textContent = displayName() + ' · ' + (previewMode ? 'client preview' : me.role);
}
async function editMyName(){
  if(!me) return;
  const v = await uiPrompt('Your display name', 'How your name appears across the portal.',
    (me.full_name||'').trim(), 'e.g. Marek Kornelius Ciszewski');
  if(v===null) return;
  const name = v.trim();
  const { error } = await sb.rpc('set_my_name', { p_name: name });
  if(error){ await uiConfirm('Could not save name', esc(error.message||'Please try again.'), { confirmLabel:'OK' }); return; }
  me.full_name = name || null; renderWhoami();
}

async function afterLogin(){
  const _user = (await sb.auth.getUser()).data.user;
  const uid = _user?.id;
  authEmail = _user?.email || '';

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
  renderWhoami();
  $('whoami').classList.add('editable');
  $('whoami').title = 'Click to edit your name';
  $('whoami').onclick = editMyName;

  if(me.role === 'team'){
    const prax = await loadTeamPractices();
    practiceId = prax && prax.length ? prax[0].id : null;
    $('btnPreview').onclick = ()=>{
      previewMode = !previewMode;
      $('btnPreview').textContent = previewMode ? 'Exit client preview' : 'Preview as client';
      $('btnPreview').classList.toggle('previewing', previewMode);
      renderWhoami();
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
  data = { practice:p.data, kpiRaw:(k.data||[]), kpi:[], deliv:d.data||[], miles:m.data||[], video:v.data||[], feed:f.data||[], vhist:vh.data||[], notif:nt.data||[] };
  data.kpi = computeKpi();   // fold the raw source rows down per the selected channel
  render();
}

// Additive ad metrics — SUMmed when combining channels (Meta + Google) for one month.
// Everything else (cumulative followers, page likes, rates) takes the latest value.
const KPI_ADDITIVE = new Set(['spend','impr','clicks','lpv','reach','page_engagement','leads','cons','proc','sent','opens','eclk','sms','vid','posts']);

// Build the per-period rows the dashboard renders, honoring the selected channel.
// 'all' sums every channel together; a specific channel filters to just its rows.
function computeKpi(){
  const rows = normalizeKpiRows(data.kpiRaw || []);
  const present = new Set(rows.map(r => r.source));
  let chan = getChan();
  if(chan!=='all' && !present.has(chan)){ chan = 'all'; setChan('all'); }
  const scoped = chan==='all' ? rows : rows.filter(r => r.source === chan);
  return mergeKpiByPeriod(scoped);
}

// Distinct channels present in the raw data, in CHANNELS order then any extras.
function channelsPresent(){
  const present = new Set(kpiSourcesPresent());
  const ordered = CHANNELS.map(c=>c.source).filter(s=> present.has(s));
  for(const s of present) if(!ordered.includes(s)) ordered.push(s);
  return ordered;
}

// Collapse source rows for the same month into one effective snapshot. Additive
// metrics SUM across channels; the rest take the most-recently-updated value.
// Keeps the period model intact (one row per period downstream).
function mergeKpiByPeriod(rows){
  const byPeriod = new Map();
  const ordered = [...rows].sort((a,b)=> new Date(a.updated_at||0) - new Date(b.updated_at||0));
  for(const r of ordered){
    const cur = byPeriod.get(r.period) || { practice_id:r.practice_id, period:r.period };
    for(const key of Object.keys(r)){
      if(key==='id' || key==='source') continue;
      const val = r[key];
      if(val===null || val===undefined || val==='') continue;
      if(KPI_ADDITIVE.has(key) && typeof val==='number'){
        cur[key] = (typeof cur[key]==='number' ? cur[key] : 0) + val;
      } else {
        cur[key] = val;
      }
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
  // build the channel selector (only when this practice has more than one ad channel)
  buildChannelPicker();
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
  // theme every native select (deliverable status, milestone, video stage, …)
  safe('themed selects', ()=> enhanceSelectsIn(document));
}

/* Month selector for performance metrics: 'Latest (live)' + each reported month snapshot.
   Drives the per-practice selection (setSel). emptySelected adds a transient option so
   the dropdown stays in sync when the team sits on a month that has no data yet. */
function buildMetricsPicker(reported, viewPeriod, latestPeriod, emptySelected){
  const mount = $('metricsPicker');
  if(!mount) return;
  if(!reported.length && !emptySelected){ mount.style.display='none'; return; }
  mount.style.display='';
  // 'Latest (live)' + each reported month, newest → oldest
  const opts = [{ value:'', label:'Latest month (live)' }]
    .concat(reported.slice().sort((a,b)=> a.period<b.period?1:a.period>b.period?-1:0).map(r=>
      ({ value:r.period, label:`${periodLabel(r.period)}${r.period===latestPeriod?' (latest)':''}` })));
  if(emptySelected) opts.push({ value:viewPeriod, label:`${periodLabel(viewPeriod)} (no data yet)` });
  const cur = getSel(); const val = (cur!=null) ? String(cur) : '';
  if(!metricsSelApi || metricsSelApi._mount !== mount){
    metricsSelApi = themedSelect(mount, { options:opts, value:val, placeholder:'Latest month (live)',
      onChange:(v)=>{ setSel(v===''? null : v); render(); } });
    metricsSelApi._mount = mount;
  } else {
    metricsSelApi.setOptions(opts); metricsSelApi.setValue(val);
  }
}

// Channel selector: shown only when a practice reports under more than one ad
// channel. 'All channels' sums Meta + Google; each option filters to one channel.
function buildChannelPicker(){
  const sel = $('channelPicker'); if(!sel) return;
  const chans = channelsPresent();
  enhanceNativeSelect(sel);
  const field = sel.closest('.mp-field') || sel._tsel?.wrap || sel;
  if(chans.length < 2){ field.classList.add('hidden'); setChan('all'); return; }
  sel.innerHTML = ['<option value="all">All channels</option>']
    .concat(chans.map(s=> `<option value="${esc(s)}">${esc(channelLabel(s))}</option>`)).join('');
  sel.value = getChan();
  sel.onchange = ()=>{ setChan(sel.value); data.kpi = computeKpi(); render(); };
  field.classList.remove('hidden');
  themeSync(sel);
}

/* ---------------- team controls ---------------- */
// The team's reporting month is the SAME per-practice selection that drives the
// client view: the <input type="month"> below IS that selector, so the top label,
// the KPI cards and the entry form always move together.
// Months offered in the themed "Reporting month" dropdown: every reported month
// (same source the dashboard uses) unioned with a recent range, so any month is
// pickable WITHOUT typing. Newest first, labelled "March 2026".
// Data-driven: one option per DISTINCT reporting month present in THIS client's KPI
// data — the list self-updates as new months arrive (June metrics → June appears),
// no static range. Current + viewed month are always included so you can enter the
// present month. Newest first.
function monthOptions(period){
  const set = new Set((data.kpiRaw||[]).filter(r=> r.practice_id===practiceId).map(r=> String(r.period).slice(0,10)));
  set.add(currentPeriod());          // always allow entering the current month
  if(period) set.add(period);        // keep the month currently in view
  return [...set].sort((a,b)=> a<b?1:a>b?-1:0).map(p=> ({ value:p, label: periodLabel(p) }));
}
function renderTeam(viewPeriod, latestPeriod){
  const period = viewPeriod || latestPeriod || currentPeriod();
  const mount = $('inMonth');
  const opts = monthOptions(period);
  if(!monthSelApi || monthSelApi._mount !== mount){
    monthSelApi = themedSelect(mount, { options:opts, value:period, placeholder:'Pick a month',
      onChange:(p)=>{ setSel(p); render(); } });
    monthSelApi._mount = mount;
  } else {
    monthSelApi.setOptions(opts); monthSelApi.setValue(period);
  }
  fillKpiForm();
}
function entryPeriod(){ return monthSelApi ? monthSelApi.value : currentPeriod(); }   // the month the team form targets
function fillKpiForm(){
  // the manual entry form edits the primary (Meta / 'marketing') channel directly,
  // independent of the dashboard's channel selector / summed view
  const m = (data.kpiRaw||[]).find(x=> x.period===entryPeriod() && (x.source||'marketing')===KPI_SOURCE) || {};
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

// Manual KPI export — download the open practice's saved KPI months as CSV.
// (The manual layer is entry/edit + download only; workbook import was removed.)
$('btnExportKpi')?.addEventListener('click', ()=>{
  const rows = (data.kpiRaw||[]).filter(r=> r.practice_id===practiceId);
  if(!rows.length){ flash('No KPI data to export yet.'); return; }
  const keys = ['period','source', ...FIELDS.map(f=> f.k)];
  const header = ['Period','Source', ...FIELDS.map(f=> f.l)];
  const cell = v => v==null ? '' : (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : String(v));
  const body = rows.slice().sort((a,b)=> (a.period<b.period?-1:a.period>b.period?1:0) || String(a.source||'').localeCompare(String(b.source||'')))
    .map(r=> keys.map(k=> cell(r[k])).join(',')).join('\n');
  const csv = header.join(',') + '\n' + body;
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const pname = ((practicesList||[]).find(p=> p.id===practiceId)?.name || 'practice').replace(/[^a-z0-9]+/gi,'_');
  a.href = URL.createObjectURL(blob); a.download = `${pname}_kpis.csv`; a.click();
  URL.revokeObjectURL(a.href);
  flash(`Downloaded ${rows.length} KPI row(s).`);
});

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

// Reusable THEMED dropdown (replaces native <select> so the whole control + popup
// match the portal). API: mount a container, pass {options:[{value,label}], value,
// placeholder, onChange}. Fully keyboard-accessible (Enter/Space/Arrows/Esc).
function themedSelect(mount, { options=[], value=null, placeholder='Select…', onChange }={}){
  let open=false, val=value, opts=options;
  const labelFor = v => { const o=opts.find(x=> String(x.value)===String(v)); return o? o.label : placeholder; };
  mount.classList.add('tsel');
  mount.innerHTML = `<button type="button" class="tsel-btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="tsel-val"></span><span class="tsel-caret" aria-hidden="true">▾</span></button>
    <div class="tsel-pop" role="listbox" hidden></div>`;
  const btn = mount.querySelector('.tsel-btn');
  const valEl = mount.querySelector('.tsel-val');
  const pop = mount.querySelector('.tsel-pop');
  const renderVal = ()=>{ const has=opts.some(o=> String(o.value)===String(val)); valEl.textContent = has?labelFor(val):placeholder; valEl.classList.toggle('placeholder', !has); };
  const renderOpts = ()=>{ pop.innerHTML = opts.length
      ? opts.map(o=> `<div class="tsel-opt${String(o.value)===String(val)?' sel':''}" role="option" tabindex="-1" data-v="${esc(String(o.value))}">${esc(o.label)}</div>`).join('')
      : '<div class="tsel-empty">No options</div>'; };
  const setOpen = o=>{ open=o; pop.hidden=!o; btn.setAttribute('aria-expanded', o?'true':'false'); mount.classList.toggle('open', o);
    if(o){ (pop.querySelector('.tsel-opt.sel')||pop.querySelector('.tsel-opt'))?.focus(); } };
  const choose = v=>{ val=v; renderVal(); renderOpts(); setOpen(false); btn.focus(); onChange&&onChange(v); };
  btn.onclick = ()=> setOpen(!open);
  btn.onkeydown = e=>{ if(['ArrowDown','Enter',' '].includes(e.key)){ e.preventDefault(); setOpen(true); } };
  pop.onclick = e=>{ const o=e.target.closest('.tsel-opt'); if(o) choose(o.dataset.v); };
  pop.onkeydown = e=>{ const items=[...pop.querySelectorAll('.tsel-opt')]; const i=items.indexOf(document.activeElement);
    if(e.key==='Escape'){ setOpen(false); btn.focus(); }
    else if(e.key==='ArrowDown'){ e.preventDefault(); (items[i+1]||items[0])?.focus(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); (items[i-1]||items[items.length-1])?.focus(); }
    else if((e.key==='Enter'||e.key===' ') && document.activeElement.classList.contains('tsel-opt')){ e.preventDefault(); choose(document.activeElement.dataset.v); } };
  document.addEventListener('click', e=>{ if(open && !mount.contains(e.target)) setOpen(false); });
  renderVal(); renderOpts();
  return { setValue(v){ val=v; renderVal(); renderOpts(); }, setOptions(o){ opts=o; renderVal(); renderOpts(); }, get value(){ return val; } };
}

// Same themed UI applied to an EXISTING native <select>: the select is kept as the
// value source (so all current .value reads + change handlers keep working) and
// visually replaced by a themed button + popup. Idempotent + re-syncable. Open
// state lives in the DOM class so one global handler can close any open dropdown
// (no per-instance listeners → safe across admin re-renders).
function themeSync(sel){
  const t = sel && sel._tsel; if(!t) return;
  const chosen = sel.options[sel.selectedIndex];
  t.btn.querySelector('.tsel-val').textContent = chosen ? chosen.textContent : '';
  t.pop.innerHTML = [...sel.options].map(o=>
    `<div class="tsel-opt${o.selected?' sel':''}${o.disabled?' disabled':''}" role="option" tabindex="-1" data-v="${esc(o.value)}">${esc(o.textContent)}</div>`).join('');
}
function enhanceNativeSelect(sel){
  if(!sel) return;
  if(sel._tsel){ themeSync(sel); return; }
  const wrap = document.createElement('div'); wrap.className = 'tsel tsel-wrap';
  sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel); sel.classList.add('tsel-native');
  const btn = document.createElement('button');
  btn.type='button'; btn.className='tsel-btn'; btn.setAttribute('aria-haspopup','listbox'); btn.setAttribute('aria-expanded','false');
  btn.innerHTML = `<span class="tsel-val"></span><span class="tsel-caret" aria-hidden="true">▾</span>`;
  const pop = document.createElement('div'); pop.className='tsel-pop'; pop.setAttribute('role','listbox'); pop.hidden=true;
  wrap.appendChild(btn); wrap.appendChild(pop); sel._tsel = { wrap, btn, pop };
  const isOpen = ()=> wrap.classList.contains('open');
  const setOpen = o=>{ wrap.classList.toggle('open',o); pop.hidden=!o; btn.setAttribute('aria-expanded',o?'true':'false');
    if(o) (pop.querySelector('.tsel-opt.sel')||pop.querySelector('.tsel-opt'))?.focus(); };
  const choose = v=>{ const changed = sel.value!==v; sel.value=v; themeSync(sel); setOpen(false); btn.focus(); if(changed) sel.dispatchEvent(new Event('change',{bubbles:true})); };
  btn.onclick = ()=> setOpen(!isOpen());
  btn.onkeydown = e=>{ if(['ArrowDown','Enter',' '].includes(e.key)){ e.preventDefault(); setOpen(true); } };
  pop.onclick = e=>{ const o=e.target.closest('.tsel-opt'); if(o && !o.classList.contains('disabled')) choose(o.dataset.v); };
  pop.onkeydown = e=>{ const items=[...pop.querySelectorAll('.tsel-opt:not(.disabled)')]; const i=items.indexOf(document.activeElement);
    if(e.key==='Escape'){ setOpen(false); btn.focus(); }
    else if(e.key==='ArrowDown'){ e.preventDefault(); (items[i+1]||items[0])?.focus(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); (items[i-1]||items[items.length-1])?.focus(); }
    else if((e.key==='Enter'||e.key===' ') && document.activeElement.classList.contains('tsel-opt')){ e.preventDefault(); choose(document.activeElement.dataset.v); } };
  themeSync(sel);
}
function enhanceSelectsIn(root){
  (root||document).querySelectorAll('select.cellinput, select.picker, select#accessPractice, select#accessRole, select.statussel, select.stagesel, select.milesel').forEach(enhanceNativeSelect);
}
// one global outside-click closer for all enhanced (native-wrapped) dropdowns
document.addEventListener('click', e=>{
  document.querySelectorAll('.tsel-wrap.open').forEach(w=>{ if(!w.contains(e.target)){
    w.classList.remove('open'); const p=w.querySelector('.tsel-pop'); if(p)p.hidden=true; w.querySelector('.tsel-btn')?.setAttribute('aria-expanded','false'); } });
});

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
  // truncated names/titles expand to full text on click, collapse on click again
  wrap.querySelectorAll('.dnameC, .phasenameC').forEach(el=> el.addEventListener('click', e=>{
    if(e.target.closest('.infobtn')) return;          // don't hijack the ⓘ button
    el.classList.toggle('expanded');
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
    // Done → show the real completion date prominently. Not-done → show the planned
    // month, de-emphasized (it's a projection, not a commitment).
    let dateEl = '';
    if(m.status==='done'){
      const dd = m.completed_on || m.target_date;
      if(dd) dateEl = `<span class="tldate-done">✓ Completed ${esc(prettyDate(dd))}</span>`;
    } else if(m.target_date){
      dateEl = `<span class="tldate-plan">Planned · ${esc(prettyDate(m.target_date,'month'))}</span>`;
    }
    // status is auto-advanced by deliverable %; team can still edit only the planned date
    const doneBadge = (m.status==='done' && m.completed_on)
      ? `<span class="tldate-done sm">✓ ${esc(prettyDate(m.completed_on))}</span>` : '';
    const teamCtl = isTeam
      ? `<div class="tldate"><label class="tldate-lbl">Planned date</label><input type="date" class="dateedit" data-id="${m.id}" value="${m.target_date||''}">${doneBadge}</div>`
      : '';
    return `<div class="tl ${m.status}"><div class="dot"></div><div class="n">${esc(m.name)}</div>
       <div class="d">${esc(m.detail||'')}</div>
       <span class="tag">${tagLabel}</span>${isTeam?'':dateEl}${teamCtl}</div>`;
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
      <li data-step="access" class="onboard-pending">Invite the doctor / owner (Access &amp; Invites tab)</li>
      <li data-step="sheet" class="onboard-pending">Link workbook &amp; map source tabs (Reporting &amp; KPI tab)</li>
      <li data-step="coefficient" class="onboard-pending">Connect Coefficient to those tabs</li>
      <li data-step="sync" class="onboard-pending">Run first KPI sync</li>
    </ol>
    <p class="note onboard-hint">Status updates automatically. This panel hides itself after a minute.</p>`;
  const ap = $('accessPractice'); if(ap){ ap.value = pid; enhanceNativeSelect(ap); }
  loadAccessRoster(pid);
  refreshOnboardChecklist(pid);
  // transient helper — auto-dismiss after ~1 min so the admin page stays uncluttered
  clearTimeout(el._dismissTimer);
  el._dismissTimer = setTimeout(()=>{ el.classList.add('hidden'); }, 60000);
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
    onbFlash(`Created "${name}". Looking for its workbook in the master folder…`);
    loadAll();
    if(data) autoDiscoverWorkbook(data, name);   // best-effort onboarding; safe if it can't
  }catch(e){ onbFlash('Could not add client: '+e.message); }
  finally{ $('btnAddClient').disabled = false; }
};
// Best-effort onboarding: find the new client's workbook in the global folder, link it,
// detect its tabs, and map the confidently-recognized ones. Anything ambiguous is left
// for manual confirmation under Reporting & KPI (never a silent wrong guess).
async function autoDiscoverWorkbook(pid, name){
  if(!isTeamView()) return;
  const folder = (appSettings.master_reporting_drive_folder||'').trim();
  if(!folder) return;
  try{
    const r = await invokeSyncFn({ action:'find_workbook', folder_id: folder, name });
    if(!r.match){                                  // none or multiple candidates → don't guess
      onbFlash(r.candidates && r.candidates.length
        ? `Created "${name}". Found ${r.candidates.length} possible workbooks — confirm under Reporting & KPI.`
        : `Created "${name}". No workbook matched yet — link it under Reporting & KPI.`);
      return;
    }
    await sb.from('practices').update({ workbook_sheet_id: r.match.id }).eq('id', pid);
    const p=(practicesList||[]).find(x=>x.id===pid); if(p) p.workbook_sheet_id=r.match.id;
    const d = await invokeSyncFn({ action:'detect', practice_id: pid });
    let mapped=0;
    for(const t of (d.tabs||[])){
      if(t.suggested_source && (t.parsed_rows||0)>0){   // only map tabs that actually parsed
        const { error } = await sb.from('sheet_sources').upsert({ practice_id:pid, source:t.suggested_source,
          label:channelLabel(t.suggested_source), tab_name:t.title, is_active:true, source_type:'google_sheet_private' },
          { onConflict:'practice_id,source' });
        if(!error) mapped++;
      }
    }
    await loadSheetSources(); refreshOnboardChecklist(pid);
    onbFlash(`Created "${name}" — linked workbook “${r.match.name}”${mapped?` and mapped ${mapped} source tab(s)`:''}. Review under Reporting & KPI.`);
  }catch(_){ /* best-effort; the manual Find/Detect flow remains available */ }
}

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
// per-client reporting-sheet sources, keyed 'practiceId::source' (one per ad channel)
let sheetSources = {};
const ssKey = (pid, source)=> `${pid}::${source||'marketing'}`;
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
  // keyed per practice+channel now that a practice can have several sheets
  sheetSources = {}; (data||[]).forEach(s=> sheetSources[ssKey(s.practice_id, s.source||'marketing')]=s);
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
    // invoke() throws on any non-2xx but the function still returns a JSON body with the
    // REAL reason (400 "no syncable source tabs", 401, a 500 message, …). Pull it out of
    // error.context (the raw Response) so we surface the actual error, not a generic wrapper.
    let body = data;
    if(error){
      try{ body = await error.context.json(); }catch(_){ /* body wasn't json */ }
      if(!body) throw error;
    }
    if(!body?.ok) throw new Error(body?.error || (error && error.message) || 'Sync failed');
    const data2 = body;
    const skip = data2.skipped_count || 0;
    const parts = [`Synced ${data2.upserted ?? 0} row(s)`];
    if(skip) parts.push(`skipped ${skip}`);
    const months = monthsList(data2.months_seen);
    if(months) parts.push(`months: ${months}`);
    if(data2.rows_seen === 0){
      // surface the first concrete skip reason (e.g. "no tab configured") so the
      // admin knows exactly what to fix instead of a generic "check headers".
      const why = (data2.skipped||[]).map(s=> s && s.reason).find(Boolean);
      parts.push(why ? `no rows parsed — ${why}` : 'no rows parsed — check the source tab names and headers');
    }
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
// The client's ONE master workbook (shared once with the service account); every
// source below is a TAB inside this sheet.
function clientWorkbookBlock(p){
  const has = !!(p.workbook_sheet_id && p.workbook_sheet_id.trim());
  const status = has
    ? `<span class="ssok">workbook linked</span>`
    : `<span class="note">no workbook yet — use “Find in master folder”</span>`;
  return `<div class="workbookcfg">
    <span class="chanlabel">Reporting workbook ${status}</span>
    <div class="wbbtns">
      <button class="btn ghost sm" data-findwb="${p.id}" data-name="${esc(p.name)}">Find in master folder</button>
      <button class="btn ghost sm" data-detecttabs="${p.id}">Detect tabs</button>
    </div>
    <details class="wboverride">
      <summary>Manual workbook override</summary>
      <input class="cellinput workbookid" data-pid="${p.id}" value="${esc(p.workbook_sheet_id||'')}"
        placeholder="Paste a Google Sheet link or ID to override auto-discovery">
      <button class="btn ghost sm" data-saveworkbook="${p.id}">Save override</button>
    </details>
    <div class="detectout" id="detect-${p.id}"></div>
  </div>`;
}
// Tabs discovered by "Detect tabs", kept in memory so source dropdowns can offer them
// (pid -> [tab titles]). Survives admin re-renders; refreshed each detect.
let detectedTabs = {};
function tabOptions(pid, current){
  const tabs = detectedTabs[pid] || [];
  const cur = (current||'').trim();
  const seen = new Set();
  const opts = ['<option value="">— select tab —</option>'];
  tabs.forEach(t=>{ seen.add(t); opts.push(`<option value="${esc(t)}"${t===cur?' selected':''}>${esc(t)}</option>`); });
  if(cur && !seen.has(cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(cur)} (saved)</option>`);
  if(!tabs.length) opts.push('<option value="" disabled>↻ run “Detect tabs” to list tabs</option>');
  return opts.join('');
}
// Compact one-line source row: channel · tab dropdown · status · remove.
function sourceTabRow(pid, s){
  const source = s.source || 'marketing';
  const detail = [];
  if(s.last_rows!=null) detail.push(`${s.last_rows} row(s)`);
  const sm = monthsList(s.last_months); if(sm) detail.push(sm);
  const dtxt = detail.length ? ` ${detail.join(' · ')}` : '';
  const status = s.last_status==='error'
      ? `<span class="ssbad" title="${esc(s.last_error||'')}">⚠ error</span>`
    : s.last_synced_at
      ? `<span class="ssok" title="${esc(new Date(s.last_synced_at).toLocaleString())}">✓${esc(dtxt)}</span>`
    : `<span class="note">not synced</span>`;
  return `<div class="srcrow">
    <span class="chanlabel srcname">${esc(channelLabel(source))}</span>
    <select class="cellinput sheettab" data-pid="${pid}" data-source="${esc(source)}" title="Pick this source's tab">${tabOptions(pid, s.tab_name)}</select>
    <span class="srcstatus">${status}</span>
    <button class="btn ghost xs danger" data-delsource="${pid}" data-source="${esc(source)}" title="Remove source">×</button>
  </div>`;
}
// "Add a source" row — source dropdown + detected-tab dropdown (+ custom key).
function addSourceRow(pid){
  const taken = new Set(Object.values(sheetSources).filter(s=> s.practice_id===pid).map(s=> s.source||'marketing'));
  const srcOpts = '<option value="" disabled selected>— Select source —</option>'
    + CHANNELS.filter(c=> !taken.has(c.source)).map(c=> `<option value="${esc(c.source)}">${esc(c.label)}</option>`).join('')
    + '<option value="__custom">Custom source…</option>';
  return `<div class="addsource">
    <span class="addsrc-label">Add another reporting source</span>
    <div class="addsource-row">
      <select class="cellinput addsourcesel" data-pid="${pid}" title="Pick a channel / insight to add">${srcOpts}</select>
      <select class="cellinput addsourcetab" data-pid="${pid}" title="Pick its tab inside the workbook">${tabOptions(pid, '')}</select>
      <button class="btn ghost sm" data-addsource="${pid}">+ Add source</button>
    </div>
    <input class="cellinput addsourcekey" data-pid="${pid}" placeholder="custom source key (e.g. tiktok_ads)" style="display:none">
  </div>`;
}
// Per-client sources block (its own node so Detect tabs can refresh the dropdowns
// in place without wiping the detect summary above it).
function clientSourcesHTML(pid){
  const order = CHANNELS.map(c=> c.source);
  const present = Object.values(sheetSources).filter(s=> s.practice_id===pid)
    .sort((a,b)=> ((order.indexOf(a.source)+1)||99) - ((order.indexOf(b.source)+1)||99));
  const rows = present.length ? present.map(s=> sourceTabRow(pid, s)).join('')
                              : '<div class="note">No sources yet — add one below, or use “Detect tabs”.</div>';
  return `<div class="sheetchans" id="sources-${pid}">
    <div class="srclist">${rows}</div>
    ${addSourceRow(pid)}
    <div class="deployrow">
      <button class="btn sm" data-deploy="${pid}">Deploy setup</button>
      <span class="note">Saves the tab mappings &amp; runs a sync to confirm.</span>
    </div>
  </div>`;
}
function renderAdminClients(){
  const wrap = $('adminClientList'); if(!wrap) return;
  if(!isTeamView()){ wrap.innerHTML=''; return; }
  const list = practicesList || [];
  wrap.innerHTML = (list.length ? list.map(p=> `<div class="clientrow2">
      <div class="ccol"><span class="cname">${esc(p.name)}</span>
        <button class="btn ghost sm danger" data-delpractice="${p.id}" data-name="${esc(p.name)}">Delete client</button></div>
      ${clientWorkbookBlock(p)}
      ${clientSourcesHTML(p.id)}
    </div>`).join('') : '<div class="note">No practices yet — add one above.</div>');
  wireAdminClients();
}
// (Re)bind all client-card handlers — called after a full render or a sources refresh.
function wireAdminClients(){
  const wrap = $('adminClientList'); if(!wrap) return;
  wrap.querySelectorAll('[data-delpractice]').forEach(b=> b.onclick = ()=> deletePractice(b.dataset.delpractice, b.dataset.name));
  wrap.querySelectorAll('[data-saveworkbook]').forEach(b=> b.onclick = ()=> saveWorkbook(b.dataset.saveworkbook));
  wrap.querySelectorAll('[data-detecttabs]').forEach(b=> b.onclick = ()=> detectTabs(b.dataset.detecttabs));
  wrap.querySelectorAll('[data-findwb]').forEach(b=> b.onclick = ()=> findWorkbook(b.dataset.findwb, b.dataset.name));
  wrap.querySelectorAll('[data-delsource]').forEach(b=> b.onclick = ()=> removeSource(b.dataset.delsource, b.dataset.source));
  wrap.querySelectorAll('[data-addsource]').forEach(b=> b.onclick = ()=> addSource(b.dataset.addsource));
  wrap.querySelectorAll('[data-deploy]').forEach(b=> b.onclick = ()=> deployClient(b.dataset.deploy));
  // picking a tab from the dropdown saves that source mapping immediately
  wrap.querySelectorAll('select.sheettab').forEach(sel=> sel.onchange = ()=> saveSheetSource(sel.dataset.pid, sel.dataset.source));
  wrap.querySelectorAll('.addsourcesel').forEach(sel=> sel.onchange = ()=>{
    const k = sel.closest('.addsource')?.querySelector('.addsourcekey'); if(k) k.style.display = sel.value==='__custom' ? '' : 'none';
  });
  enhanceSelectsIn(wrap);   // theme every source / tab / add-source select
}
// Repopulate one client's source dropdowns after Detect tabs, leaving the summary intact.
function refreshClientSources(pid){
  const c = document.getElementById('sources-'+pid);
  if(!c){ renderAdminClients(); return; }
  c.outerHTML = clientSourcesHTML(pid);
  wireAdminClients();
}
// Deploy: mappings are already saved on dropdown change — this confirms and runs a sync.
async function deployClient(pid){
  if(!isTeamView()) return;
  adminDelFlash('Deploying — running sync…');
  try{
    const r = await invokeSyncFn({ action:'sync', trigger:'manual' });
    await loadSheetSources();
    adminDelFlash(`Deployed · synced ${r.upserted ?? 0} row(s)${r.months_seen && r.months_seen.length ? ` · ${r.months_seen.join(', ')}` : ''}.`);
    refreshOnboardChecklist(pid);
    if(practiceId===pid) loadAll();
  }catch(e){ adminDelFlash('Deploy failed: '+(e.message||String(e))); }
}
// Save the client's master workbook id (the one sheet every source tab reads from).
async function saveWorkbook(pid){
  if(!isTeamView()) return;
  const inp = document.querySelector(`.workbookid[data-pid="${pid}"]`);
  const raw = (inp?.value||'').trim();
  // accept a pasted full Google Sheets URL or a bare ID — store just the ID
  const m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const v = m ? m[1] : raw;
  if(inp && v!==raw) inp.value = v;   // reflect the cleaned id back to the field
  const { error } = await sb.from('practices').update({ workbook_sheet_id: v||null }).eq('id', pid);
  adminDelFlash(error ? 'Workbook save failed: '+error.message
    : (v ? 'Master workbook saved — its source tabs will sync on the next run.' : 'Master workbook cleared.'));
  if(!error){ const p = (practicesList||[]).find(x=> x.id===pid); if(p) p.workbook_sheet_id = v||null; }
}
// Call sync-coefficient and return the parsed JSON body even on non-2xx (invoke()
// throws but the real reason is in error.context). Shared by detect/find/sync calls.
async function invokeSyncFn(body){
  const { data, error } = await sb.functions.invoke('sync-coefficient', { body: { ...body, _ts: Date.now() } });
  let out = data;
  if(error){ try{ out = await error.context.json(); }catch(_){ /* not json */ } if(!out) throw error; }
  if(!out?.ok) throw new Error(out?.error || (error && error.message) || 'Request failed');
  return out;
}
// Inspect the client's master workbook: list its tabs and dry-run parse each so the
// admin can map tab → source with eyes open. No writes until they click "Map".
async function detectTabs(pid){
  if(!isTeamView()) return;
  const out = document.getElementById('detect-'+pid); if(!out) return;
  out.innerHTML = '<div class="note">Inspecting workbook…</div>';
  try{
    const r = await invokeSyncFn({ action:'detect', practice_id: pid });
    if(!r.tabs || !r.tabs.length){ out.innerHTML = '<div class="note">No tabs found — is the workbook saved and shared with the service account?</div>'; return; }
    // cache the tab titles so every source dropdown for this client can offer them
    detectedTabs[pid] = r.tabs.map(t=> t.title).filter(Boolean);
    refreshClientSources(pid);
    out.innerHTML = `<div class="note">Found ${r.tab_count} tab(s) — now pick each source's tab from the dropdowns, or quick-map below:</div>` + r.tabs.map(t=>{
      const ok = (t.parsed_rows||0) > 0;
      const shape = t.shape && t.shape!=='unknown' ? `${t.shape} · ` : '';
      const meta = ok ? `✓ ${shape}${t.parsed_rows} row(s)${t.months&&t.months.length?` · ${t.months.join(', ')}`:''}`
                      : '⚠ 0 parsed';
      const why = !ok ? esc(t.reason||'') : '';            // server gives a specific reason now
      const src = t.suggested_source;
      const apply = src
        ? `<button class="btn ghost xs" data-applytab="${pid}" data-tab="${esc(t.title)}" data-src="${esc(src)}">Map → ${esc(channelLabel(src))}</button>`
        : `<span class="note">no source guess — add it manually below</span>`;
      return `<div class="dtab">
        <b>${esc(t.title)}</b> <span class="${ok?'ssok':'ssbad'}" ${why?`title="${why}"`:''}>${meta}</span> ${apply}
        ${why?`<div class="note dtabwhy">${why}</div>`:''}</div>`;
    }).join('');
    out.querySelectorAll('[data-applytab]').forEach(b=>
      b.onclick = ()=> applyDetectedTab(b.dataset.applytab, b.dataset.src, b.dataset.tab));
  }catch(e){ out.innerHTML = `<div class="ssbad">Detect failed: ${esc(e.message||String(e))}</div>`; }
}
// Create/update a source-tab mapping from a detected tab.
async function applyDetectedTab(pid, source, tab){
  if(!isTeamView()) return;
  const { error } = await sb.from('sheet_sources')
    .upsert({ practice_id: pid, source, label: channelLabel(source), tab_name: tab,
              is_active:true, source_type:'google_sheet_private' }, { onConflict:'practice_id,source' });
  adminDelFlash(error? 'Map failed: '+error.message : `${channelLabel(source)} mapped to tab “${tab}” — syncs next run.`);
  if(!error){ await loadSheetSources(); refreshOnboardChecklist(pid); }
}
// ---- global admin settings (shared across the team via the app_settings table) ----
let appSettings = {};
async function loadAppSettings(){
  if(!isTeamView()) return;
  try{
    const { data } = await sb.from('app_settings').select('key,value');
    appSettings = Object.fromEntries((data||[]).map(r=> [r.key, r.value]));
  }catch(_){ appSettings = {}; }
  const inp = $('masterFolder'); if(inp) inp.value = appSettings.master_reporting_drive_folder || '';
}
async function saveMasterFolder(){
  if(!isTeamView()) return;
  const inp = $('masterFolder'); const raw = (inp?.value||'').trim();
  // accept a full Drive folder link or a bare id — store just the id
  const m = raw.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  const val = m ? m[1] : raw;
  if(inp && val!==raw) inp.value = val;
  const { error } = await sb.from('app_settings')
    .upsert({ key:'master_reporting_drive_folder', value: val||null, updated_at:new Date().toISOString() }, { onConflict:'key' });
  const msg = $('masterFolderMsg');
  if(msg) msg.textContent = error ? 'Save failed: '+error.message
    : (val ? 'Master folder saved — “Find in master folder” on each client now searches it.' : 'Master folder cleared.');
  if(!error) appSettings.master_reporting_drive_folder = val||null;
}
$('btnSaveMasterFolder')?.addEventListener('click', saveMasterFolder);

// Admin sub-tab switcher: Clients / Access & Invites / Reporting & KPI / System.
// Remembers the choice so the Admin button returns here next time.
$('adminTabs')?.addEventListener('click', e=>{
  const b = e.target.closest('.atab'); if(!b) return;
  activateAdminTab(b.dataset.atab);
});

// System tab · "Test & list workbooks" — proves the folder is reachable + shared.
$('btnListWorkbooks')?.addEventListener('click', async ()=>{
  if(!isTeamView()) return;
  const out = $('folderWorkbooks'); if(out) out.innerHTML = '<div class="note">Refreshing folder contents…</div>';
  try{
    const folder = (appSettings.master_reporting_drive_folder||'').trim();
    const r = await invokeSyncFn({ action:'list_workbooks', folder_id: folder||undefined, refresh: true });
    if(!r.files || !r.files.length){ if(out) out.innerHTML = '<div class="note">No spreadsheets found — is the folder shared with the service account?</div>'; return; }
    if(out) out.innerHTML = `<div class="note">${r.file_count} workbook(s) in the master folder:</div>` +
      r.files.map(f=> `<div class="dtab"><b>${esc(f.name)}</b></div>`).join('');
  }catch(e){ if(out) out.innerHTML = `<div class="ssbad">List failed: ${esc(e.message||String(e))}</div>`; }
});

// Find this client's workbook inside the master Drive folder by name (no silent
// guessing — shows the match or candidates for the admin to confirm).
async function findWorkbook(pid, name){
  if(!isTeamView()) return;
  const out = document.getElementById('detect-'+pid); if(!out) return;
  const folder = (appSettings.master_reporting_drive_folder||'').trim();
  if(!folder){ out.innerHTML = '<div class="note">Set the global <b>Master Reporting Drive Folder</b> under Admin → System first.</div>'; return; }
  out.innerHTML = '<div class="note">Refreshing folder contents…</div>';
  try{
    const r = await invokeSyncFn({ action:'find_workbook', folder_id: folder, name, refresh: true });
    if(!r.files && !(r.candidates||[]).length && !r.match){
      out.innerHTML = '<div class="ssbad">Discovery response missing folder list — redeploy <code>sync-coefficient</code> from latest main.</div>';
      return;
    }
    const files = (r.files && r.files.length) ? r.files : (r.match ? [r.match] : (r.candidates||[]));
    if(!files.length){ out.innerHTML = `<div class="note">No Google Sheets found in the master folder. Make sure the new workbook is a Google Sheet (not an uploaded .xlsx) and the folder is shared with the service account.</div>`; return; }
    const matchId = r.match?.id;
    const ordered = [...files].sort((a,b)=> (b.id===matchId?1:0) - (a.id===matchId?1:0));
    out.innerHTML = `<div class="note">${files.length} workbook(s) in the master folder${matchId?' — best name match first':''}:</div>` + ordered.map(c=>
      `<div class="dtab"><b>${esc(c.name)}</b>${c.id===matchId?' <span class="ssok">best match</span>':''} <button class="btn ghost xs" data-usewb="${pid}" data-id="${esc(c.id)}">Use this workbook</button></div>`).join('');
    out.querySelectorAll('[data-usewb]').forEach(b=>
      b.onclick = ()=> useWorkbook(b.dataset.usewb, b.dataset.id, out));
  }catch(e){ out.innerHTML = `<div class="ssbad">Find failed: ${esc(e.message||String(e))}</div>`; }
}
// Set the client's master workbook from a found candidate, then auto-detect its tabs.
async function useWorkbook(pid, sheetId, out){
  if(!isTeamView()) return;
  const { error } = await sb.from('practices').update({ workbook_sheet_id: sheetId }).eq('id', pid);
  if(error){ if(out) out.innerHTML = `<div class="ssbad">Save failed: ${esc(error.message)}</div>`; return; }
  const p = (practicesList||[]).find(x=> x.id===pid); if(p) p.workbook_sheet_id = sheetId;
  const inp = document.querySelector(`.workbookid[data-pid="${pid}"]`); if(inp) inp.value = sheetId;
  adminDelFlash('Workbook linked — detecting its tabs…');
  detectTabs(pid);
}
// Save a source's tab mapping (picked from the detected-tabs dropdown). The sheet id
// comes from the client master workbook; we only store which tab feeds this source.
async function saveSheetSource(pid, source='marketing'){
  if(!isTeamView()) return;
  const sel = document.querySelector(`select.sheettab[data-pid="${pid}"][data-source="${source}"]`);
  const tab_name = (sel?.value||'').trim();
  const { error } = await sb.from('sheet_sources')
    .upsert({ practice_id: pid, source, label: channelLabel(source),
              tab_name: tab_name||null, is_active:true, source_type:'google_sheet_private' },
            { onConflict:'practice_id,source' });
  adminDelFlash(error? 'Save failed: '+error.message : `${channelLabel(source)} → ${tab_name||'(no tab)'} saved.`);
  // update in place (avoid a full re-render that would reset other open dropdowns)
  if(!error){ const k = ssKey(pid, source); if(sheetSources[k]) sheetSources[k].tab_name = tab_name||null; refreshOnboardChecklist(pid); }
}
// Add a new source tab to a client (preset or custom key).
async function addSource(pid){
  if(!isTeamView()) return;
  let source = (document.querySelector(`.addsourcesel[data-pid="${pid}"]`)?.value||'').trim();
  if(source==='__custom'){
    source = (document.querySelector(`.addsourcekey[data-pid="${pid}"]`)?.value||'').trim()
      .toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
    if(!source){ adminDelFlash('Enter a custom source key (letters/numbers).'); return; }
  }
  if(!source){ adminDelFlash('Pick a source to add.'); return; }
  const tab_name = (document.querySelector(`select.addsourcetab[data-pid="${pid}"]`)?.value||'').trim();
  const { error } = await sb.from('sheet_sources')
    .upsert({ practice_id: pid, source, label: channelLabel(source),
              tab_name: tab_name||null, is_active:true, source_type:'google_sheet_private' },
            { onConflict:'practice_id,source' });
  adminDelFlash(error? 'Add source failed: '+error.message : `${channelLabel(source)} added.`);
  if(!error){ await loadSheetSources(); refreshClientSources(pid); refreshOnboardChecklist(pid); }
}
// Remove a source tab mapping (already-imported KPI history is kept).
async function removeSource(pid, source){
  if(!isTeamView()) return;
  const ok = await uiConfirm(`Remove ${channelLabel(source)} source?`,
    `This removes the ${channelLabel(source)} source mapping <b>and its imported KPI months</b> for this client, so it stops showing in the client's channel view. Re-add the source and sync to bring it back.`,
    { danger:true, confirmLabel:'Remove source' });
  if(!ok) return;
  const { error } = await sb.from('sheet_sources').delete().eq('practice_id', pid).eq('source', source);
  if(error){ adminDelFlash('Remove failed: '+error.message); return; }
  // also clear this channel's KPI rows — the client-side channel list is derived from
  // kpi data, so leaving them would keep showing a source that no longer exists.
  const { error: kerr } = await sb.from('kpi_monthly').delete().eq('practice_id', pid).eq('source', source);
  adminDelFlash(kerr ? `Source removed, but clearing its KPI rows failed: ${kerr.message}` : `${channelLabel(source)} source removed.`);
  loadSheetSources(); refreshOnboardChecklist(pid);
  if(practiceId===pid) loadAll();   // refresh the open dashboard so the channel disappears now
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
