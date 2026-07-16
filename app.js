/* ============================================================
   ROXIUM CLIENT PORTAL · app.js
   Front end: Cloudflare Pages (static) · Backend: Supabase (auth + db + RLS)
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
  {k:'freq',   label:'Frequency',    fmt:v=>(Math.round(v*10)/10).toFixed(1)+'×', derive:m=>{const r=N(m,'reach'),i=N(m,'impr');return r?i/r:null;}},
  {k:'page_engagement', label:'Page Engagement', fmt:v=>fmtNum(v), hideIfZero:true},   // only renders when the source provides it
];
// hideIfZero: these engagement/social metrics are shown ONLY when the source
// actually reports them (>0). A zero/absent value means "not provided" — hide the
// card rather than render an empty "0", and the grid reflows automatically.
const OPTIONAL_METRICS = [
  {k:'leads',      label:'Leads',              fmt:v=>fmtNum(v), hideIfZero:true},
  {k:'cpl',        label:'Cost per Lead',      fmt:v=>fmt$(v),  derive:m=>{const s=N(m,'spend'),l=N(m,'leads');return l?s/l:null;}, lowerBetter:true, hideIfZero:true},
  {k:'lpv',        label:'Landing Page Views', fmt:v=>fmtNum(v), hideIfZero:true},
  {k:'page_likes', label:'Page Likes',         fmt:v=>fmtNum(v), hideIfZero:true},
  {k:'foll',       label:'Followers',          fmt:v=>fmtNum(v), hideIfZero:true},
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
  freq:   {label:'Frequency', what:'How many times, on average, each person saw your ads — impressions ÷ reach.', why:'Balances exposure against fatigue: enough repetition to be remembered, not so much that people tune out.', higher:'Higher frequency means more repeat exposure per person — good for recall, but watch for ad fatigue above ~4×.', lower:'Lower frequency means most people saw the ad only once or twice — fresher, but possibly under-exposed.'},
  lpv:    {label:'Landing Page Views', what:'How many times people reached your landing page after clicking an ad.', why:'Closer to intent than a raw click — it confirms the visitor actually arrived and the page loaded.', higher:'Higher landing page views mean more real visits from your ads.', lower:'Lower views vs clicks can signal slow pages or accidental taps.'},
  page_likes: {label:'Page Likes', what:'New likes on your page generated during this period.', why:'A signal of audience growth and brand affinity beyond a single campaign.', higher:'Higher likes mean your content is winning new followers.', lower:'Lower likes mean less audience growth this period.'},
  foll:   {label:'Followers', what:'New followers gained across your profiles this period.', why:'Your owned audience — people you can reach again without paying for ads.', higher:'Higher follower growth compounds future organic reach.', lower:'Lower growth means fewer new people opting in to hear from you.'},
};

/* ---------------- editable KPI dashboard (registry + per-user prefs) ---------
   The KPI card row is fully customizable: add / remove / reorder / rename.
   METRIC_REGISTRY is the single catalog — a new metric added here is instantly
   available in the "Customize" picker with zero further UI changes. Prefs are
   stored per user + practice in kpi_dashboard_prefs (localStorage fallback
   pre-migration), as an ordered array of {k, label?}. */
const METRIC_REGISTRY = [...CORE_METRICS, ...OPTIONAL_METRICS];
const metricDef = k => METRIC_REGISTRY.find(d=> d.k===k) || null;
// Default card set. Spend / Link Clicks / CPC / Reach already headline the hero
// stats, so the default row complements rather than repeats them (the old row
// duplicated Reach top-and-bottom — Frequency now covers that slot with new
// information instead). Users can still ADD any hero metric back deliberately.
// Headline set for the Overview + Metrics KPI cards. Fully editable per practice
// via the Customize modal (kpi_dashboard_prefs); this is only the default.
const DEFAULT_KPI_CARDS = [
  {k:'spend'}, {k:'reach'}, {k:'clicks'}, {k:'cpl'},
];
let kpiPrefs = null;          // null = defaults; else ordered [{k, label?}]
let kpiPrefsLoadedFor = '';   // `${uid}:${practiceId}` guard
const kpiPrefsLsKey = ()=> `roxium_kpi_cards_${practiceId||'none'}`;
function activeKpiCards(){
  const list = (Array.isArray(kpiPrefs) && kpiPrefs.length) ? kpiPrefs : DEFAULT_KPI_CARDS;
  return list.filter(c=> c && metricDef(c.k));
}
async function loadKpiPrefs(){
  const uid = me?.id; if(!uid || !practiceId) return;
  const guard = `${uid}:${practiceId}`;
  if(kpiPrefsLoadedFor === guard) return;
  kpiPrefsLoadedFor = guard;
  try{ const ls = localStorage.getItem(kpiPrefsLsKey()); if(ls) kpiPrefs = JSON.parse(ls); }catch(_){}
  try{
    const { data: row, error } = await sb.from('kpi_dashboard_prefs')
      .select('cards').eq('user_id', uid).eq('practice_id', practiceId).maybeSingle();
    if(!error && row && Array.isArray(row.cards) && row.cards.length) kpiPrefs = row.cards;
  }catch(_){ /* pre-migration DB — localStorage carries the prefs */ }
}
async function saveKpiPrefs(cards){
  kpiPrefs = (cards && cards.length) ? cards : null;
  try{
    if(kpiPrefs) localStorage.setItem(kpiPrefsLsKey(), JSON.stringify(kpiPrefs));
    else localStorage.removeItem(kpiPrefsLsKey());
  }catch(_){}
  try{
    if(me?.id && practiceId){
      await sb.from('kpi_dashboard_prefs').upsert({
        user_id: me.id, practice_id: practiceId,
        cards: kpiPrefs || [], updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,practice_id' });
    }
  }catch(_){ /* pre-migration DB — localStorage saved above */ }
}
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
const STAGES = [['planned','Planned'],['scheduled','Scheduled'],['pre_production','Pre-production'],['shot','Shot'],['editing','Editing'],['delivered','Delivered'],['posted','Posted']];
// Team-only SLA: an item >=3 days in its current stage warns (yellow), >=7 overdue (red). See slaState().

let me = null;            // profile row
let authEmail = '';       // signed-in user's email (display-name fallback)
let myMembership = null;    // current practice membership { role: owner|member }
let pendingLoginEmail = ''; // email awaiting a typed 6-digit code (Outlook fallback)
let practiceId = null;    // active practice
let previewMode = false;  // team viewing the client-side version
// Selected reporting month is scoped PER PRACTICE so one client's choice can never
// leak into another's. Absent key = follow that practice's latest reported month.
let selByPractice = {};   // practiceId -> 'YYYY-MM-01'
let monthSelApi = null;   // themed "Reporting month" dropdown instance (team)
let metricsSelApi = null; // themed month dropdown instance (client dashboard)
function resetPracticeUiState(){
  metricsSelApi = null;
  monthSelApi = null;
  destroyKpiCharts();
}
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
// Marketing-connection access states (see migrations/2026-07-08_marketing_connections.sql):
// requested = we asked the client for platform access · granted = access arrived,
// Coefficient/tab still to wire · connected = data flowing (auto-set on sync ok).
const ACCESS_STATES = [['requested','Requested'],['granted','Granted'],['connected','Connected']];
const accessLabel = k => (ACCESS_STATES.find(([v])=>v===k)?.[1]) || 'Connected';
// Whole days since the access request went out (null when unknown / not requested).
function accessAgeDays(s){
  if(!s || !s.access_requested_at) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(String(s.access_requested_at).slice(0,10)+'T12:00:00'))/86400000));
}
// Escalation bands for an aging access request — the onboarding SOP says escalate
// after 5 business days (~7 calendar): quiet <3d · amber 3–6d · red ≥7d.
function accessAgeCls(days){ return days==null ? 'note' : days>=7 ? 'ssbad' : days>=3 ? 'sswarn' : 'note'; }
// Human, correctly-capitalized role labels for access/account messaging.
const roleLabel = r => ({ owner:'Owner', member:'Member', team:'ROXIUM Team', client:'Client', admin:'Admin' }[String(r||'').toLowerCase()]
  || (r ? String(r).replace(/\b\w/g, c=>c.toUpperCase()) : '—'));
let data = { kpi: [], deliv: [], miles: [], video: [], feed: [], vhist: [], notif: [], practice: null };

/* ---- KPI period helpers (period = first-of-month 'YYYY-MM-01' snapshot key) ---- */
const monthInputToPeriod = v => v ? v + '-01' : null;           // 'YYYY-MM' -> 'YYYY-MM-01'
const periodToMonthInput = p => p ? String(p).slice(0,7) : '';  // 'YYYY-MM-01' -> 'YYYY-MM'
const periodLabel = p => p
  ? new Date(p.length<=10 ? p+'T00:00:00' : p).toLocaleDateString(undefined,{month:'short',year:'numeric'})
  : '';
const currentPeriod = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const KPI_SOURCE = 'marketing'; // the source the team form reads/writes; other sources land via imports
const ALL_MONTHS = '__all__';   // reporting picker sentinel — month-over-month trend view
const isAllMonthsSel = sel => sel === ALL_MONTHS;

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
const VIEWS = ['overview','operations','roadmap','deliverables','video','metrics','updates','connections','access','team','controls'];
const TEAM_ONLY_VIEWS = ['operations','team','controls'];
const CLIENT_PORTAL_VIEWS = ['overview','roadmap','deliverables','video','metrics','updates','connections','access','team'];
// Default client landing (sidebar shell): the answer-first Overview.
const CLIENT_HOME = 'overview';
const GLOBAL_TEAM_VIEWS = ['operations','controls'];
// remember the last client-side view and the last Team Controls sub-tab for smooth nav
let lastClientView = CLIENT_HOME;
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
// Connections manager: practice owners manage their own data sources; the team
// sees it via Preview-as-client (a real client-eye view of the same page).
function canSeeConnectionsTab(){ return canSeeAccessTab() || (me && me.role === 'team' && previewMode); }
// Hash may carry deep-link params: #deliverables&pid=…&deliv=…&video=…&phase=…
function hashParts(){
  const raw = (location.hash||'').replace(/^#/,'');
  const amp = raw.indexOf('&');
  const view = ((amp >= 0 ? raw.slice(0, amp) : raw) || '').split('?')[0];
  const params = {};
  const paramStr = amp >= 0 ? raw.slice(amp + 1) : (raw.includes('?') ? raw.split('?').slice(1).join('?') : '');
  if(paramStr){
    paramStr.split('&').forEach(pair=>{
      const eq = pair.indexOf('=');
      if(eq > 0) params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    });
  }
  return { view, params };
}
function currentView(){
  let h = hashParts().view;
  if(h === 'admin') h = 'controls';   // legacy hash alias
  if(VIEWS.includes(h)) return h;
  return (me && me.role === 'team' && isTeamView()) ? 'operations' : CLIENT_HOME;
}
let pendingDeepLink = null;   // { view, delivId, videoId, phase, milestoneId }
function captureDeepLinkFromHash(){
  const { params } = hashParts();
  if(params.deliv || params.video || params.phase || params.ms){
    pendingDeepLink = {
      delivId: params.deliv || null,
      videoId: params.video || null,
      phase: params.phase || null,
      milestoneId: params.ms || null,
      view: currentView(),
    };
  }
}
function applyDeepLinkFocus(){
  if(!pendingDeepLink) return;
  const { delivId, videoId, phase, milestoneId, view } = pendingDeepLink;
  pendingDeepLink = null;
  if(phase) delivCollapsed.delete(phase);
  let el = null;
  if(delivId){
    if(phase) document.querySelector(`.phasecard[data-phase="${CSS.escape(phase)}"]`)?.classList.remove('collapsed');
    el = document.querySelector(`.taskrow[data-id="${delivId}"], .drow[data-deliv="${delivId}"]`);
  } else if(videoId){
    el = document.querySelector(`.vitem[data-vid="${videoId}"]`);
  } else if(milestoneId){
    el = document.querySelector(`[data-milestone="${milestoneId}"]`);
  }
  if(el){
    el.classList.add('deeplink-flash');
    el.scrollIntoView({ behavior:'smooth', block:'center' });
    setTimeout(()=> el.classList.remove('deeplink-flash'), 2400);
  } else if(view && VIEWS.includes(view)){
    showView(view);
  }
}
function teamWorkspace(){
  const v = currentView();
  if(v === 'operations') return 'operations';
  if(v === 'controls') return 'controls';
  return 'clients';
}
// Top-bar title + subtitle per view (replaces the big hero heading as the
// primary "where am I" cue in the sidebar shell).
const PAGE_META = {
  overview:{t:'Overview', s:'What changed, what needs you, and what\'s next'},
  roadmap:{t:'Roadmap', s:'Every milestone, where you stand, and what happens next'},
  deliverables:{t:'Project Progress', s:'Where you are, what\'s done, and what\'s next'},
  video:{t:'Video', s:'Your production pipeline, stage by stage'},
  metrics:{t:'Performance', s:'Live marketing KPIs against target'},
  updates:{t:'Updates', s:'The latest from your ROXIUM team'},
  connections:{t:'Connections', s:'Every data source powering your dashboards'},
  access:{t:'Invite team', s:'Add colleagues to this practice'},
  operations:{t:'Operations', s:'Client health, delivery and attention at a glance'},
  controls:{t:'Team Controls', s:'Clients, access, approvals and reporting'},
  team:{t:'Client Controls', s:'Controls for the practice you have open'},
};
function updatePageHeader(name){
  const meta = PAGE_META[name] || { t:'ROXIUM', s:'' };
  const titleEl = $('pageTitle'), subEl = $('pageSub');
  if(titleEl) titleEl.textContent = meta.t;
  if(subEl){
    // client views carry the open practice name so a team member always knows
    // whose portal they're looking at.
    const isClientView = CLIENT_PORTAL_VIEWS.includes(name) && name!=='team';
    const pname = (isClientView && data.practice) ? data.practice.name : '';
    subEl.textContent = pname ? `${pname} · ${meta.s}` : meta.s;
  }
}
function closeSidebarDrawer(){
  document.getElementById('app')?.classList.remove('sb-open');
  const scrim = $('sbScrim'); if(scrim){ scrim.classList.remove('show'); scrim.classList.add('hidden'); }
  $('sbToggle')?.setAttribute('aria-expanded','false');
}
function toggleSidebarDrawer(){
  const app = document.getElementById('app'); if(!app) return;
  const open = app.classList.toggle('sb-open');
  const scrim = $('sbScrim');
  if(scrim){ scrim.classList.toggle('hidden', !open); requestAnimationFrame(()=> scrim.classList.toggle('show', open)); }
  $('sbToggle')?.setAttribute('aria-expanded', open? 'true':'false');
}
// Desktop: slide the sidebar open/closed and remember the choice. Mobile: drawer.
function toggleSidebar(){
  if(window.matchMedia('(max-width:900px)').matches){ toggleSidebarDrawer(); return; }
  const app = document.getElementById('app'); if(!app) return;
  const collapsed = app.classList.toggle('sb-collapsed');
  try{ localStorage.setItem('roxium_sb_collapsed', collapsed ? '1' : '0'); }catch(_){}
  $('sbToggle')?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}
function applySidebarPref(){
  try{ if(localStorage.getItem('roxium_sb_collapsed')==='1') document.getElementById('app')?.classList.add('sb-collapsed'); }catch(_){}
}
function showView(name){
  if(name === 'admin') name = 'controls';
  // Roadmap is folded into the unified "Project Progress" view for both roles — any
  // stray #roadmap link (older bookmarks, "You are here" CTAs) lands there.
  if(name === 'roadmap') name = 'deliverables';
  if(!VIEWS.includes(name)) name = (me && me.role === 'team' && isTeamView()) ? 'operations' : CLIENT_HOME;
  if(TEAM_ONLY_VIEWS.includes(name) && !isTeamView()) name = CLIENT_HOME;
  if(name === 'access' && !canSeeAccessTab()) name = CLIENT_HOME;
  if(name === 'connections' && !canSeeConnectionsTab()) name = CLIENT_HOME;
  // Team hasn't picked a client yet → a client-portal view has no practice to show,
  // so keep them on Operations instead of a blank dashboard.
  if(me && me.role==='team' && !practiceId &&
     ['overview','deliverables','video','metrics','updates','connections','access'].includes(name)) name = 'operations';
  if(CLIENT_PORTAL_VIEWS.includes(name)) lastClientView = name;
  document.querySelectorAll('.view').forEach(v=> v.classList.toggle('active', v.dataset.view===name));
  document.querySelectorAll('.tab').forEach(t=> t.classList.toggle('active', t.dataset.view===name));
  document.querySelectorAll('.sb-link').forEach(l=> l.classList.toggle('active', l.dataset.view===name));
  updatePageHeader(name);
  closeSidebarDrawer();            // navigating closes the mobile drawer
  syncChrome();
  // Charts built while their tab was hidden have a zero-size canvas — resize once the
  // Metrics tab is actually visible so the live graph shows without a manual month switch.
  if(name==='metrics') requestAnimationFrame(()=> render());
  if(name==='operations') loadOperationsData();
  if(name==='controls'){
    activateAdminTab(lastAdminTab);
    renderAdminClients(); loadSheetSources(); loadPlatformAdmins(); loadAppSettings(); loadAccountApprovals();
    enhanceSelectsIn($('adminPanel'));
    const pid = $('accessPractice')?.value;
    loadAccessRoster(pid);
    if(pid) refreshOnboardChecklist(pid);
  }
  if(name==='access') loadClientAccessRoster();
  if(name==='connections') renderConnectionsPage();
  if(name==='updates') markUpdatesSeen();   // opening Updates clears its "new" badge
}
// Chrome visibility: Operations + Team Controls are global team screens; Clients = per-practice portal.
function syncChrome(){
  const realTeam = !!(me && me.role==='team');
  const teamView = isTeamView();
  const ws = teamWorkspace();
  const globalTeam = GLOBAL_TEAM_VIEWS.includes(currentView());
  $('teamTopNav')?.classList.toggle('hidden', !teamView);
  document.querySelectorAll('.teamtop').forEach(t=>{
    const nav = t.dataset.teamnav;
    const active = (nav==='operations' && ws==='operations') || (nav==='controls' && ws==='controls') || (nav==='clients' && ws==='clients');
    t.classList.toggle('active', active);
  });
  $('btnPreview').classList.toggle('hidden', !realTeam || globalTeam);
  // Client picker lives permanently in the top bar for team members — it's how
  // they enter a client's portal from anywhere (the old "Clients" top-nav tab is
  // gone; the sidebar Client Portal group appears once a practice is selected).
  $('practiceSwitcher').classList.toggle('hidden', !realTeam);
  $('tabnav')?.classList.toggle('hidden', globalTeam);
  // toggle a view's tab AND its sidebar link together
  const navToggle = (view, hide)=>{
    document.querySelector(`.tab[data-view="${view}"]`)?.classList.toggle('hidden', hide);
    document.querySelector(`.sb-link[data-view="${view}"]`)?.classList.toggle('hidden', hide);
    document.querySelector(`section[data-view="${view}"]`)?.classList.toggle('hidden', hide);
  };
  // Overview is a client view (router-managed); show it whenever a practice is open.
  navToggle('overview', !(practiceId || (me && me.role==='client')));
  // Roadmap is no longer its own tab for anyone — it lives inside Project Progress.
  navToggle('roadmap', true);
  navToggle('access', !canSeeAccessTab());
  navToggle('connections', !canSeeConnectionsTab());
  TEAM_ONLY_VIEWS.forEach(v=> navToggle(v, !teamView));
  // sidebar groups: Operations for real team members; Client Portal whenever a
  // practice is open (client, or team viewing/previewing a client).
  $('sbOpsGroup')?.classList.toggle('hidden', !realTeam);
  $('sbClientGroup')?.classList.toggle('hidden', !(practiceId || (me && me.role==='client')));
  // The "Live sync" footer reflects the OPEN client's reporting sync — hide it when
  // no client is selected (team on the Operations dashboard), where it's meaningless.
  $('sbFoot')?.classList.toggle('hidden', !practiceId);
  if(!teamView && TEAM_ONLY_VIEWS.includes(currentView())) location.hash = '#'+CLIENT_HOME;
  if(!canSeeAccessTab() && currentView()==='access') location.hash = '#'+CLIENT_HOME;
}
window.addEventListener('hashchange', ()=>{
  captureDeepLinkFromHash();
  showView(currentView());
  if(pendingDeepLink && practiceId) requestAnimationFrame(()=> applyDeepLinkFocus());
});
$('btnAdminBack')?.addEventListener('click', e=>{ e.preventDefault(); location.hash = '#operations'; });
// Sidebar toggle: desktop collapse (remembered) / mobile drawer; scrim closes drawer.
// The topbar #sbToggle re-opens a collapsed sidebar (desktop) or opens the drawer
// (mobile); #sbCollapse lives ON the sidebar and closes it, so the control isn't
// stranded next to the page content on wide screens.
$('sbToggle')?.addEventListener('click', toggleSidebar);
$('sbCollapse')?.addEventListener('click', toggleSidebar);
$('sbScrim')?.addEventListener('click', closeSidebarDrawer);
applySidebarPref();

/* ---------------- searchable client switcher (team) ---------------- */
let practicesList = [];
let switcherWired = false;
function updateSwitcherLabel(){
  const el = $('practiceCurrentName');
  const p = (practicesList||[]).find(x=> x.id===practiceId);
  if(el) el.textContent = p ? p.name : 'Select client…';
}
function buildSwitcher(list){
  practicesList = list || [];
  updateSwitcherLabel();
  if(switcherWired) return;
  switcherWired = true;
  const root = $('practiceSwitcher');
  const btn = $('practiceSwitcherBtn');
  const pop = $('practiceSwitcherPop');
  const input = $('practiceSearch');
  const results = $('practiceResults');
  const setOpen = o=>{
    if(!pop) return;
    pop.classList.toggle('hidden', !o);
    btn?.setAttribute('aria-expanded', o?'true':'false');
    root?.classList.toggle('open', o);
    if(o){ input.value=''; draw(''); setTimeout(()=> input?.focus(), 0); }
  };
  const draw = q=>{
    const ql = (q||'').trim().toLowerCase();
    const matches = practicesList.filter(p=> p.name.toLowerCase().includes(ql));
    // When a client is open, offer a way back to the team dashboard (deselect).
    const backItem = practiceId
      ? `<button type="button" class="switcher-item switcher-back" data-back="1">← Back to Operations (no client)</button>`
      : '';
    results.innerHTML = backItem + (matches.length
      ? matches.map(p=>`<button type="button" class="switcher-item${p.id===practiceId?' current':''}" data-id="${p.id}">${esc(p.name)}</button>`).join('')
      : '<div class="switcher-empty">No matches — try another name</div>');
    const backBtn = results.querySelector('[data-back]');
    if(backBtn) backBtn.onclick = ()=>{ setOpen(false); btn?.focus(); exitClientPortal(); };
    results.querySelectorAll('.switcher-item[data-id]').forEach(b=> b.onclick = ()=>{
      practiceId = b.dataset.id;
      updateSwitcherLabel();
      setOpen(false);
      btn?.focus();
      resetPracticeUiState();
      syncChrome();                 // reveal the Client Portal group now a client is chosen
      if(location.hash.replace('#','') !== 'overview') location.hash = '#overview';
      else showView('overview');    // same hash → force the view to (re)render
      loadAll();
    });
  };
  btn?.addEventListener('click', e=>{ e.stopPropagation(); setOpen(pop?.classList.contains('hidden')); });
  input?.addEventListener('input', ()=> draw(input.value));
  input?.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ setOpen(false); btn?.focus(); }
    else if(e.key==='Enter'){
      const first = results.querySelector('.switcher-item');
      if(first){ first.click(); e.preventDefault(); }
    }
  });
  document.addEventListener('click', e=>{ if(root && !root.contains(e.target)) setOpen(false); });
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
    sel.innerHTML = `<option value="">— Select client —</option>`
      + list.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if(keep && list.some(p=>p.id===keep)) sel.value = keep;
    else sel.value = '';
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
  showBuildVersion();
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ $('login').classList.remove('hidden'); return; }
  await boot();
}
// Never await Supabase calls directly inside the auth callback — that can stall
// the client. Defer to a fresh task and let boot() dedupe.
sb.auth.onAuthStateChange((_e, session)=>{ if(session && !me) setTimeout(boot, 0); });

async function showBuildVersion(){
  const el = $('portalBuild');
  if(!el) return;
  try{
    const r = await fetch(`/version.json?t=${Date.now()}`, {cache:'no-store'});
    if(!r.ok) return;
    const v = await r.json();
    if(!v.sha) return;
    el.textContent = `build ${v.sha}`;
    const app = document.querySelector('script[src*="app.js"]');
    const src = app?.getAttribute('src')||'';
    if(src.includes(v.sha)) return;
    const k = 'roxium_cache_bust'+v.sha;
    if(sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k,'1');
    const u = new URL(location.href);
    u.searchParams.set('_v', v.sha);
    location.replace(u.toString());
  }catch(_){}
}

// Capture a practice invite link (?join=CODE) so it survives the magic-link round trip.
try{ const _jc = new URL(location.href).searchParams.get('join'); if(_jc) localStorage.setItem('roxium_join', _jc.trim()); }catch(_){}

$('btnLogin').onclick = async ()=>{
  const email = $('loginEmail').value.trim();
  if(!email) return;
  // Self-service accounts, invite-only ACCESS: anyone may create a ROXIUM
  // account here, but nobody reaches client data until they're approved.
  // Invited emails auto-approve the moment they sign in (the invitation IS the
  // approval); everyone else lands in a Pending state with zero data access
  // until the team approves them in Team Controls → Account approvals.
  const joinCode = (localStorage.getItem('roxium_join') || '').trim();
  // The app lives at /portal/ (the root is the public marketing page, which
  // forwards stray auth callbacks here). Send magic links straight to the portal.
  const redirectTo = location.origin + '/portal/' + (joinCode ? '?join=' + encodeURIComponent(joinCode) : '');
  // Invite-only: never auto-create an account for an unknown email. Supabase then
  // returns an error for addresses with no existing auth user, which we surface as
  // "no account — contact ROXIUM" instead of silently mailing a stranger a link.
  const { error } = await sb.auth.signInWithOtp({
    email, options:{ emailRedirectTo: redirectTo, shouldCreateUser: false }
  });
  if(!error){
    // Reveal the typed-code path: Outlook's link scanner can consume or delay the
    // one-time magic link, so a code the user types is the reliable fallback.
    pendingLoginEmail = email;
    $('loginCodeRow')?.classList.remove('hidden');
    $('loginMsg').textContent = 'Check your email for the sign-in link — or type the code from that email below.';
  } else {
    const m = String(error.message||'');
    $('loginMsg').textContent = /signups? not allowed|disabled|not found|no user|invalid/i.test(m)
      ? 'No account is set up for that email yet — please contact ROXIUM staff to get access.'
      : m;
  }
};

$('btnVerifyCode')?.addEventListener('click', async ()=>{
  const token = ($('loginCode').value || '').replace(/\D/g, '').trim();
  const email = pendingLoginEmail || $('loginEmail').value.trim();
  if(!email || token.length < 6){ $('loginMsg').textContent = 'Enter the code from your email.'; return; }
  $('btnVerifyCode').disabled = true; $('loginMsg').textContent = 'Verifying…';
  // Magic-link codes are type 'email'; invite emails are type 'invite' — try both.
  let { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if(error){ const r = await sb.auth.verifyOtp({ email, token, type: 'invite' }); if(!r.error) error = null; }
  $('btnVerifyCode').disabled = false;
  if(error){ $('loginMsg').textContent = 'That code did not work (it may have expired — send a new link): ' + error.message; return; }
  // Success: onAuthStateChange fires boot(); nothing else to do here.
});
$('btnLogout').onclick = async ()=>{ await sb.auth.signOut(); location.reload(); };
// Brand icon is "home": clients / client-preview → Overview; real team → Operations
// with the client DESELECTED, so they fully leave the client portal.
$('sbBrand')?.addEventListener('click', e=>{
  if(me && me.role==='team' && !previewMode){ e.preventDefault(); exitClientPortal(); }
});
// Team: drop the selected client and return to the Operations dashboard.
function exitClientPortal(){
  practiceId = null;
  updateSwitcherLabel();
  resetPracticeUiState();
  syncChrome();
  if(location.hash.replace('#','') !== 'operations') location.hash = '#operations';
  else showView('operations');
}

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
function initialsOf(name){
  const p = String(name||'').trim().split(/\s+/).filter(Boolean);
  if(!p.length) return 'R';
  return (p[0][0] + (p.length>1 ? p[p.length-1][0] : '')).toUpperCase();
}
function renderWhoami(){
  if(!me) return;
  const name = displayName();
  $('whoami').textContent = name;
  const sub = previewMode ? 'Client preview' : (me.role==='team' ? 'ROXIUM team' : (data.practice?.name || 'Client'));
  $('tbUserSub') && ($('tbUserSub').textContent = sub);
  $('tbUserAvatar') && ($('tbUserAvatar').textContent = initialsOf(name));
  $('tbPopName') && ($('tbPopName').textContent = name);
  $('tbPopEmail') && ($('tbPopEmail').textContent = authEmail || '');
}
// Top-bar interactions: search (opens the command palette), export (print),
// notifications dropdown, and the user menu. Idempotent — safe to call once.
let _topbarWired = false;
function wireTopbar(){
  if(_topbarWired) return; _topbarWired = true;
  const closeAllPops = (except)=>{
    [['tbNotifPop','tbNotif'],['tbUserPop','tbUser']].forEach(([pop,btn])=>{
      if(pop===except) return;
      $(pop)?.classList.add('hidden'); $(btn)?.setAttribute('aria-expanded','false');
    });
  };
  const togglePop = (pop,btn)=>{
    const el = $(pop); if(!el) return;
    const willOpen = el.classList.contains('hidden');
    closeAllPops(willOpen ? pop : null);
    el.classList.toggle('hidden', !willOpen);
    $(btn)?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    return willOpen;
  };
  $('tbSearch')?.addEventListener('click', ()=> window.roxOpenPalette && window.roxOpenPalette());
  $('tbExport')?.addEventListener('click', ()=>{ try{ window.print(); }catch(_){} });
  $('tbNotif')?.addEventListener('click', e=>{ e.stopPropagation(); if(togglePop('tbNotifPop','tbNotif')) renderNotifPop(); });
  $('tbUser')?.addEventListener('click', e=>{ e.stopPropagation(); togglePop('tbUserPop','tbUser'); });
  $('tbEditName')?.addEventListener('click', ()=>{ closeAllPops(); editMyName(); });
  document.addEventListener('click', ()=> closeAllPops());
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeAllPops(); });
}
function updateNotifDot(){
  const unseen = (data.notif||[]).filter(n=> !n.seen).length;
  $('tbNotifDot')?.classList.toggle('hidden', unseen<=0);
}
function renderNotifPop(){
  const el = $('tbNotifPop'); if(!el) return;
  const items = (data.notif||[]).filter(n=> !n.seen).slice(0,20);
  el.innerHTML = `<div class="tb-pop-head"><span>Notifications${items.length?` <span class="tb-pop-count">${items.length}</span>`:''}</span>${items.length?`<button class="tb-pop-clear" id="tbNotifClear" type="button">Clear all</button>`:''}</div>
    ${items.length ? items.map(nItem=>{
      const txt = nItem.title || nItem.message || nItem.body || 'Update';
      return `<div class="tb-notif-item" data-nid="${nItem.id}"><span class="tb-notif-tdot"></span><div class="tb-notif-main"><div class="tb-notif-t">${esc(String(txt))}</div><div class="tb-notif-w">${esc(connAgo(nItem.created_at)||'')}</div></div><button class="tb-notif-x" type="button" data-nid="${nItem.id}" title="Dismiss">✕</button></div>`;
    }).join('') : `<div class="tb-notif-empty note">You're all caught up.</div>`}`;
  el.querySelectorAll('.tb-notif-x').forEach(b=> b.onclick = e=>{ e.stopPropagation(); dismissNotif(b.dataset.nid); });
  const clr = el.querySelector('#tbNotifClear'); if(clr) clr.onclick = e=>{ e.stopPropagation(); clearAllNotifs(); };
}
async function dismissNotif(id){
  const n = (data.notif||[]).find(x=> x.id===id); if(n) n.seen = true;   // optimistic
  renderNotifPop(); updateNotifDot();
  try{ await sb.from('notifications').update({ seen:true }).eq('id', id); }catch(_){ }
}
async function clearAllNotifs(){
  const ids = (data.notif||[]).filter(n=> !n.seen).map(n=> n.id);
  if(!ids.length) return;
  (data.notif||[]).forEach(n=> n.seen = true);   // optimistic
  renderNotifPop(); updateNotifDot();
  try{ await sb.from('notifications').update({ seen:true }).in('id', ids); }catch(_){ }
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

// Waiting room for self-service signups that haven't been approved yet (and
// for rejected accounts). No practice data is reachable in this state — RLS
// denies everything without a membership; this pane is the honest UX for it.
function showPendingPane(status, email){
  $('login').classList.add('hidden');
  $('app').classList.add('hidden');
  const pane = $('pendingPane'); if(!pane) return;
  const rejected = status === 'rejected';
  $('pendingTitle').textContent = rejected ? 'Access not approved' : 'Almost there';
  $('pendingBody').innerHTML = rejected
    ? `This account (<b>${esc(email||'')}</b>) hasn't been approved for portal access. If you believe this is a mistake, contact your ROXIUM lead.`
    : `Your account (<b>${esc(email||'')}</b>) is created and <b>awaiting approval</b> by the ROXIUM team — we verify every practice before granting access. You'll be able to sign straight in once you're approved.<br><br>
       <span class="note">Were you invited by your practice? Sign out and use the <b>same email address</b> your invitation was sent to — invited emails are approved automatically.</span>`;
  pane.classList.remove('hidden');
  $('btnPendingSignout').onclick = async ()=>{ await sb.auth.signOut(); location.reload(); };
}

async function afterLogin(){
  const _user = (await sb.auth.getUser()).data.user;
  const uid = _user?.id;
  authEmail = _user?.email || '';

  // Claim any pending allowlist invites on every sign-in (first signup or added to another practice).
  let { data: claim } = await sb.rpc('claim_invites_for_user');
  // Redeem a practice invite link (?join=CODE) if no explicit invite/domain matched.
  const joinCode = (localStorage.getItem('roxium_join') || '').trim();
  if((!claim || !claim.claimed) && joinCode){
    const { data: joinedPid } = await sb.rpc('join_practice_by_code', { p_code: joinCode });
    if(joinedPid){ localStorage.removeItem('roxium_join'); claim = { ok:true, claimed:1, practice_id:joinedPid }; }
  }

  let { data: prof, error } = await sb.from('profiles').select('*').eq('id', uid).single();
  if(error || !prof){
    // Self-service signup: no invite matched, so bootstrap a PENDING profile.
    // The account exists but can see nothing until the team approves it —
    // RLS denies every practice table without a membership regardless.
    try{ await sb.rpc('ensure_my_profile'); }catch(_){ /* pre-migration DB */ }
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
  // Access gate for non-team users:
  //   • rejected            → hard deny.
  //   • no practice at all   → waiting room ("awaiting team verification").
  // The second case is the key one: a REMOVED member's profile lingers with a
  // stale approval_status='approved' but practice_id=null (and no memberships).
  // Without this they'd fall straight through into an EMPTY client shell instead
  // of the "your access needs review" screen. No practice = nothing to show =
  // waiting room, whatever the approval flag says. (approval_status is absent on
  // pre-migration DBs — those clients always have a practice_id, so they pass.)
  if(me.role !== 'team'){
    if(('approval_status' in me) && me.approval_status === 'rejected'){ showPendingPane('rejected', authEmail); return; }
    if(!me.practice_id){ showPendingPane('pending', authEmail); return; }
  }
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  renderWhoami();
  wireTopbar();
  if(me.role === 'team') await initOpsAttentionState();

  if(me.role === 'team'){
    const prax = await loadTeamPractices();
    const { view, params } = hashParts();
    // Do NOT auto-open the first client — the team lands on Operations with no
    // client selected. The Client Portal only appears once a client is picked
    // (or a deep link supplies ?pid), so we never silently show one practice's
    // data under a blank name.
    practiceId = (params.pid && prax.some(p=> p.id===params.pid)) ? params.pid : null;
    captureDeepLinkFromHash();
    if(!view || view === 'admin') location.hash = '#operations';
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
    captureDeepLinkFromHash();
    await loadMyMembership();
  }
  syncChrome();
  showView(currentView());
  if(practiceId) loadAll();
}

/* ---------------- data ---------------- */
async function loadAll(){
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setMonth(monthStart.getMonth()-24);
  const dayCutoff = monthStart.toISOString().slice(0,10);
  const dailyQ = sb.from('kpi_daily').select('*').eq('practice_id', practiceId).gte('day', dayCutoff).order('day');
  const [p,k,kd,d,m,v,f,vh,nt] = await Promise.all([
    sb.from('practices').select('*').eq('id', practiceId).single(),
    sb.from('kpi_monthly').select('*').eq('practice_id', practiceId).order('period'),
    dailyQ,
    sb.from('deliverables').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('milestones').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('video_pipeline').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('activity').select('*').eq('practice_id', practiceId).order('created_at',{ascending:false}).limit(12),
    sb.from('video_history').select('*').eq('practice_id', practiceId).order('moved_at'),
    sb.from('notifications').select('*').eq('practice_id', practiceId).order('created_at',{ascending:false}).limit(10),
  ]);
  data = { practice:p.data, kpiRaw:(k.data||[]), kpiDailyRaw: kd.error ? [] : (kd.data||[]), kpi:[], deliv:d.data||[], miles:m.data||[], video:v.data||[], feed:f.data||[], vhist:vh.data||[], notif:nt.data||[] };
  data.kpi = computeKpi();   // fold the raw source rows down per the selected channel
  // Marketing Setup Wizard state: this practice's OAuth connections (members may
  // read their own connection METADATA — tokens live in a service-role-only
  // table). Fails soft on databases without the platform-connections migration.
  data.connections = [];
  try{
    const { data: pc, error: pcErr } = await sb.from('platform_connections')
      .select('provider,status,external_account_name,connected_at,last_synced_at,last_error,connected_by')
      .eq('practice_id', practiceId);
    if(!pcErr && Array.isArray(pc)) data.connections = pc;
  }catch(_){ /* pre-migration DB */ }
  // Internal video comment threads (team-only; RLS returns nothing to clients).
  // Fetched separately so a pre-migration DB can't reject the main load.
  data.vcomments = [];
  if(isTeamView()){
    try{
      const { data: vc, error: vcErr } = await sb.from('video_comments')
        .select('*').eq('practice_id', practiceId).order('created_at');
      if(!vcErr && Array.isArray(vc)) data.vcomments = vc;
    }catch(_){ /* pre-migration DB */ }
  }
  try{ await loadKpiPrefs(); }catch(_){ /* defaults render fine */ }
  render();
  if(isTeamView() && currentView()==='operations') loadOperationsData(true);
  maybeOpenWizardFromOAuthReturn();
  requestAnimationFrame(()=> applyDeepLinkFocus());
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

/* ---------------- KPI trend charts (Chart.js) — shared client + ops ---------------- */
let kpiChartInstances = [];
const investChartRefs = new Map();
const DEFAULT_INVEST_METRICS = { spend:true, reach:true, impr:true, clicks:false };
const INVEST_SERIES = [
  { key:'spend',  label:'Spend',       color:'#C9A84C', field:'spend',  axis:'y',  kind:'dollar' },
  { key:'reach',  label:'Reach',       color:'#7BA4D4', field:'reach',  axis:'y1', kind:'num' },
  { key:'impr',   label:'Impressions', color:'#6B8F71', field:'impr',   axis:'y1', kind:'num' },
  { key:'clicks', label:'Link Clicks', color:'#9A7FB8', field:'clicks', axis:'y1', kind:'num' },
];
const INVEST_METRICS_KEY = 'roxium_invest_metrics';
let investMetricEnabled = (()=>{
  try{
    const raw = sessionStorage.getItem(INVEST_METRICS_KEY);
    if(raw){ const p = JSON.parse(raw); return { ...DEFAULT_INVEST_METRICS, ...p }; }
  }catch(_){}
  return { ...DEFAULT_INVEST_METRICS };
})();
function saveInvestMetricPrefs(){ try{ sessionStorage.setItem(INVEST_METRICS_KEY, JSON.stringify(investMetricEnabled)); }catch(_){} }
const axisFmt = kind => kind==='dollar' ? (v=> '$'+Number(v).toLocaleString()) : (v=> Number(v).toLocaleString());
function leftAxisEnabled(en){ return !!en.spend; }
function rightAxisEnabled(en){ return INVEST_SERIES.some(s=> s.axis==='y1' && en[s.key]); }
function destroyKpiCharts(){
  kpiChartInstances.forEach(c=>{ try{ c.destroy(); }catch(_){} });
  kpiChartInstances = []; investChartRefs.clear();
}
function mergeKpiByDay(rows){
  const byDay = new Map();
  const ordered = [...rows].sort((a,b)=> new Date(a.updated_at||0) - new Date(b.updated_at||0));
  for(const r of ordered){
    const day = String(r.day).slice(0,10);
    const cur = byDay.get(day) || { day, practice_id:r.practice_id };
    for(const key of Object.keys(r)){
      if(key==='id' || key==='source' || key==='day') continue;
      const val = r[key];
      if(val===null || val===undefined || val==='') continue;
      if(KPI_ADDITIVE.has(key) && typeof val==='number'){
        cur[key] = (typeof cur[key]==='number' ? cur[key] : 0) + val;
      } else {
        cur[key] = val;
      }
    }
    byDay.set(day, cur);
  }
  return [...byDay.values()];
}
function monthDayCalendar(period){
  const y = +String(period).slice(0,4), m = +String(period).slice(5,7);
  const daysInMonth = new Date(y, m, 0).getDate();
  const days = [];
  for(let d = 1; d <= daysInMonth; d++){
    const day = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    days.push({ day, label:String(d) });
  }
  return days;
}
function buildDailyChartSeries(dailyRows, viewPeriod, isLive){
  if(!viewPeriod) return [];
  const cal = monthDayCalendar(viewPeriod);
  const merged = mergeKpiByDay(dailyRows);
  const byDay = new Map(merged.map(r=> [String(r.day).slice(0,10), r]));
  const today = new Date();
  const y = +String(viewPeriod).slice(0,4), mo = +String(viewPeriod).slice(5,7);
  const isCurrentMonth = y===today.getFullYear() && mo===today.getMonth()+1;
  return cal.map(({ day, label })=>{
    const row = byDay.get(day);
    const dayNum = +day.slice(8,10);
    const inLiveRange = !isLive || !isCurrentMonth || dayNum <= today.getDate();
    const pick = k=> inLiveRange && row ? N(row,k) : null;
    return { day, label, spend:pick('spend'), reach:pick('reach'), impr:pick('impr'), clicks:pick('clicks') };
  });
}
function clientDailyRows(){
  const chan = getChan();
  const rows = (data.kpiDailyRaw||[]).filter(r=> r.practice_id===practiceId);
  return chan==='all' ? rows : rows.filter(r=> r.source===chan);
}
function opsDailyRows(){
  return (opsData?.kpiDailyRaw||[]);   // all channels — summed per day downstream
}
function buildMonthlyChartSeries(rows){
  return [...rows].sort((a,b)=> String(a.period).localeCompare(String(b.period)))
    .map(r=> ({
      label: periodLabel(r.period),
      period: r.period,
      spend: N(r,'spend'), reach: N(r,'reach'), impr: N(r,'impr'), clicks: N(r,'clicks'),
    }));
}
function summarizeKpiRange(rows){
  const sorted = [...rows].sort((a,b)=> String(a.period).localeCompare(String(b.period)));
  const latest = sorted[sorted.length-1] || null;
  const prev = sorted.length > 1 ? sorted[sorted.length-2] : null;
  const totals = { spend:0, reach:0, impr:0, clicks:0, leads:0, cons:0, proc:0, lpv:0, page_engagement:0, page_likes:0, foll:0 };
  sorted.forEach(r=>{
    for(const k of Object.keys(totals)) totals[k] = (totals[k]||0) + (N(r,k)||0);
  });
  return { totals, latest, prev, monthCount: sorted.length };
}
function aggregateOpsDailyByDay(rows, viewPeriod, isLive){
  const cal = monthDayCalendar(viewPeriod);
  const byDay = new Map();
  cal.forEach(({ day, label })=> byDay.set(day, { day, label, spend:0, reach:0, impr:0, clicks:0, has:false }));
  rows.forEach(r=>{
    const day = String(r.day).slice(0,10);
    const slot = byDay.get(day);
    if(!slot) return;
    slot.has = true;
    slot.spend += N(r,'spend')||0;
    slot.reach += N(r,'reach')||0;
    slot.impr += N(r,'impr')||0;
    slot.clicks += N(r,'clicks')||0;
  });
  const today = new Date();
  const y = +String(viewPeriod).slice(0,4), mo = +String(viewPeriod).slice(5,7);
  const isCurrentMonth = y===today.getFullYear() && mo===today.getMonth()+1;
  return cal.map(({ day, label })=>{
    const slot = byDay.get(day);
    const dayNum = +day.slice(8,10);
    const inLiveRange = !isLive || !isCurrentMonth || dayNum <= today.getDate();
    if(!inLiveRange || !slot?.has) return { day, label, spend:null, reach:null, impr:null, clicks:null };
    return { day, label, spend:slot.spend, reach:slot.reach, impr:slot.impr, clicks:slot.clicks };
  });
}
const prefersReducedMotion = ()=> { try{ return matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(_){ return false; } };

/* ---------------- motion engine (Phase A) ----------------------------------
   Small, GPU-friendly helpers shared across the app. All are reduced-motion
   safe: when the user opts out they set the final state instantly. Presentation
   only — nothing here changes data or control flow. */

// Count a numeric tile from its previous painted value to the new one. Keyed so
// re-renders with an UNCHANGED value don't re-animate (no flicker on refresh).
const _countState = {};
function dsCountUp(el, to, fmt, key){
  if(!el) return;
  const prev = _countState[key];
  _countState[key] = to;
  if(prefersReducedMotion() || to==null || prev===to || typeof to!=='number' || !isFinite(to)){
    el.textContent = fmt(to); return;
  }
  const from = (typeof prev==='number' && isFinite(prev)) ? prev : 0;
  const dur = 620, t0 = performance.now();
  (function tick(now){
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);           // easeOutCubic
    el.textContent = fmt(from + (to - from) * eased);
    if(p < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(to);
  })(performance.now());
}

// Section entrance is handled in CSS by the `viewin` keyframe on `.view.active`
// (replays on each navigation) — no JS needed. A shared IntersectionObserver for
// scroll-reveal lands in the landing-page pass, where content is static and won't
// re-render (the portal re-renders too often for scroll-reveal without flicker).
function buildInvestChartOptions(highlightIdx, en){
  const cream='#F2EDE3', muted='#9A948A', line='rgba(201,168,76,.12)';
  const clicksOnly = en.clicks && !en.spend && !en.reach && !en.impr;
  return {
    responsive:true, maintainAspectRatio:false, animation: prefersReducedMotion() ? false : { duration:420 },
    interaction:{ mode:'index', intersect:false },
    plugins:{
      legend:{ display:false },
      tooltip:{
        backgroundColor:'rgba(13,12,16,.94)', borderColor:'rgba(201,168,76,.35)', borderWidth:1,
        titleColor:'#C9A84C', bodyColor:cream, padding:10,
        callbacks:{ label(ctx){
          const s = INVEST_SERIES[ctx.datasetIndex];
          const raw = ctx.dataset.rawValues?.[ctx.dataIndex];
          return `${s.label}: ${raw==null ? '—' : axisFmt(s.kind)(raw)}`;
        } },
      },
    },
    scales:{
      x:{ ticks:{ color:muted, font:{ family:'Jost', size:10 }, maxRotation:0, autoSkipPadding:8, maxTicksLimit: 16 }, grid:{ color:line } },
      // Both axes use the SAME fixed tick count so every left gridline lines up with a
      // right-axis label — each value sits exactly on its horizontal grid line.
      y:{  type:'linear', position:'left',  beginAtZero:true, alignToPixels:true, display: clicksOnly ? false : leftAxisEnabled(en),
           ticks:{ color:INVEST_SERIES[0].color, font:{ family:'Jost', size:10 }, count:6, callback:axisFmt('dollar') },
           grid:{ color:line } },
      y1:{ type:'linear', position: clicksOnly ? 'left' : 'right', beginAtZero:true, alignToPixels:true, display: clicksOnly ? true : rightAxisEnabled(en),
           ticks:{ color: clicksOnly ? INVEST_SERIES[3].color : muted, font:{ family:'Jost', size:10 }, count:6, callback:axisFmt('num') },
           grid:{ drawOnChartArea: clicksOnly } },
    },
    elements:{
      point:{ radius:ctx=> ctx.dataIndex===highlightIdx ? 5 : 2, hoverRadius:6, borderWidth:2,
        backgroundColor:ctx=> ctx.dataIndex===highlightIdx ? '#F2EDE3' : 'transparent' },
      line:{ tension:0.32, borderWidth:2 },
    },
  };
}
function syncInvestFilterButtons(scope){
  (scope||document).querySelectorAll('.chart-filter[data-metric]').forEach(btn=>{
    const on = !!investMetricEnabled[btn.dataset.metric];
    btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function updateInvestChartVisibility(canvasId){
  const chart = investChartRefs.get(canvasId);
  if(!chart) return;
  INVEST_SERIES.forEach((s,i)=> chart.setDatasetVisibility(i, !!investMetricEnabled[s.key]));
  const clicksOnly = investMetricEnabled.clicks && !investMetricEnabled.spend && !investMetricEnabled.reach && !investMetricEnabled.impr;
  if(chart.options.scales.y){
    chart.options.scales.y.display = clicksOnly ? false : leftAxisEnabled(investMetricEnabled);
  }
  if(chart.options.scales.y1){
    chart.options.scales.y1.display = clicksOnly ? true : rightAxisEnabled(investMetricEnabled);
    chart.options.scales.y1.position = clicksOnly ? 'left' : 'right';
    chart.options.scales.y1.grid.drawOnChartArea = clicksOnly;
    chart.options.scales.y1.ticks.color = clicksOnly ? INVEST_SERIES[3].color : '#9A948A';
  }
  chart.update();
  syncInvestFilterButtons(chart.canvas?.closest('.chartpanel'));
}
function toggleInvestMetric(key){
  if(key==='clicks'){
    if(!investMetricEnabled.clicks){
      investMetricEnabled.spend = false;
      investMetricEnabled.reach = false;
      investMetricEnabled.impr = false;
      investMetricEnabled.clicks = true;
    } else {
      Object.assign(investMetricEnabled, { ...DEFAULT_INVEST_METRICS });
    }
  } else {
    if(investMetricEnabled.clicks){
      investMetricEnabled.clicks = false;
      Object.assign(investMetricEnabled, { ...DEFAULT_INVEST_METRICS, [key]: true });
    } else {
      const mainOn = INVEST_SERIES.filter(s=> s.key!=='clicks' && investMetricEnabled[s.key]).length;
      if(investMetricEnabled[key] && mainOn <= 1) return;
      investMetricEnabled[key] = !investMetricEnabled[key];
    }
  }
  saveInvestMetricPrefs();
  investChartRefs.forEach((_c, id)=> updateInvestChartVisibility(id));
}
function bindInvestFilters(scope, canvasId){
  const panel = scope || document;
  panel.querySelectorAll('.chart-filter[data-metric]').forEach(btn=>{
    btn.onclick = ()=> toggleInvestMetric(btn.dataset.metric);
  });
  syncInvestFilterButtons(panel);
}
function renderInvestChartPanel({ wrap, canvasId, series, viewPeriod, isLive, headTitle, headNote, chartTitle, chartSub, mode='daily' }){
  if(!wrap || typeof Chart==='undefined'){ if(wrap) wrap.classList.add('hidden'); return; }
  if(!series.length){
    wrap.classList.add('hidden'); wrap.innerHTML=''; return;
  }
  const hasData = series.some(d=> INVEST_SERIES.some(s=> d[s.field]!=null));
  wrap.classList.remove('hidden');
  const labels = series.map(d=> d.label);
  const hiIdx = mode==='monthly'
    ? series.length - 1
    : (isLive ? Math.max(0, series.findIndex(d=> d.spend!=null || d.reach!=null || d.impr!=null || d.clicks!=null)) : series.length-1);
  const modeNote = mode==='monthly'
    ? ' · month-over-month trend'
    : (isLive ? ' · live daily sync' : ' · archived month-end snapshot');
  const noDataNote = mode==='monthly'
    ? ' · No monthly KPI data yet.'
    : ' · No daily rows yet — run Sync after applying the kpi_daily migration.';
  wrap.innerHTML = `
    <div class="kpi-charts-head">
      ${headTitle ? `<span class="chanlabel">${esc(headTitle)}</span>` : ''}
      <span class="note">${esc(headNote)}${modeNote}</span>
    </div>
    <div class="chartpanel chartpanel-invest">
      <div class="charttitle">${esc(chartTitle)}</div>
      <div class="chartsub">${esc(chartSub)}${hasData ? '' : noDataNote}</div>
      <div class="chart-filters" role="group" aria-label="Chart metrics">${INVEST_SERIES.map(s=>`
        <button type="button" class="chart-filter${investMetricEnabled[s.key]?' on':''}" data-metric="${s.key}" aria-pressed="${investMetricEnabled[s.key]?'true':'false'}">
          <span class="cf-box" style="--cf:${s.color}"></span><span class="cf-label">${esc(s.label)}</span>
        </button>`).join('')}</div>
      <div class="chartbox chartbox-lg"><canvas id="${canvasId}"></canvas></div>
    </div>`;
  const chart = new Chart($(canvasId), {
    type:'line',
    data:{ labels, datasets: INVEST_SERIES.map(s=>{
      const rawValues = series.map(d=> d[s.field]);
      return { label:s.label, data:rawValues, rawValues, yAxisID:s.axis,
        borderColor:s.color, backgroundColor: s.key==='spend' ? 'rgba(201,168,76,.08)' : (s.key==='clicks' ? 'rgba(154,127,184,.12)' : 'transparent'),
        fill: s.key==='spend' || s.key==='clicks', spanGaps:true, hidden: !investMetricEnabled[s.key] };
    }) },
    options: buildInvestChartOptions(hiIdx, investMetricEnabled),
  });
  investChartRefs.set(canvasId, chart);
  kpiChartInstances.push(chart);
  bindInvestFilters(wrap, canvasId);
}
function renderKpiCharts(viewPeriod, isLive, { allMonths=false }={}){
  destroyKpiCharts();
  const wrap = $('kpiCharts');
  if(!wrap) return;
  const chanLbl = getChan()==='all' ? 'All channels' : channelLabel(getChan());
  if(allMonths){
    const series = buildMonthlyChartSeries(data.kpi||[]);
    renderInvestChartPanel({
      wrap, canvasId:'chartInvest', series, viewPeriod:ALL_MONTHS, isLive:false, mode:'monthly',
      headTitle:'',
      headNote:`${chanLbl} · ${series.length} month${series.length===1?'':'s'}`,
      chartTitle:'Investment & performance',
      chartSub:'Monthly trend across all reported months — select a month to drill into daily detail.',
    });
    return;
  }
  const series = buildDailyChartSeries(clientDailyRows(), viewPeriod, isLive);
  renderInvestChartPanel({
    wrap, canvasId:'chartInvest', series, viewPeriod, isLive, mode:'daily',
    headTitle:'',
    headNote:`${chanLbl} · ${periodLabel(viewPeriod)} · days 1–${series.length}`,
    chartTitle:'Investment & performance',
    chartSub:'Daily trend for the selected reporting month. Spend ($, left) and reach / impressions (#, right). Link clicks uses its own scale.',
  });
}

/* ---------------- formatters ---------------- */
const fmt$ = v=> v==null? '—' : '$'+Math.round(v).toLocaleString();
const fmtP = v=> v==null? '—' : (v*100).toFixed(2)+'%';
const fmtNum = v=> v==null? '—' : Math.round(v).toLocaleString();

/* ---------------- answer-first client Overview (Phase 5) --------------------
   The portal used to open on raw numbers; this layer leads with the answer —
   "what changed / what needs you / what's next" — the executive summary a
   practice owner wants before any chart. It's derived, not stored: every line
   is computed live from the same KPI / deliverable / video / connection data
   the tabs already render, so it stays truthful with zero extra plumbing. */

// Metrics worth narrating in plain English, in priority order. lowerBetter flips
// the good/bad reading (a falling CPC is good). value() reuses the registry so a
// derived metric (CTR, CPC) computes identically to the cards.
const INSIGHT_METRICS = [
  { k:'reach',  noun:'reach',        verb:'reached',  lowerBetter:false, fmt:fmtNum },
  { k:'clicks', noun:'link clicks',  verb:'clicked',  lowerBetter:false, fmt:fmtNum },
  { k:'leads',  noun:'leads',        verb:'came in',  lowerBetter:false, fmt:fmtNum },
  { k:'ctr',    noun:'click-through rate', verb:'',   lowerBetter:false, fmt:fmtP },
  { k:'cpc',    noun:'cost per click',     verb:'',   lowerBetter:true,  fmt:fmt$ },
  { k:'cpm',    noun:'cost per 1,000 views', verb:'', lowerBetter:true,  fmt:fmt$ },
  { k:'spend',  noun:'spend',        verb:'invested', lowerBetter:false, fmt:fmt$, neutral:true },
];
// Compare the viewed month against the prior reported month and surface the most
// material movements as ranked, plain-language insights. Returns [] when there is
// no prior month to compare (the caller shows a first-month message instead).
function buildKpiInsights(cur, prev){
  if(!cur || !prev) return [];
  const out = [];
  for(const m of INSIGHT_METRICS){
    const def = metricDef(m.k);
    const c = def ? metricValue(def, cur) : N(cur, m.k);
    const p = def ? metricValue(def, prev) : N(prev, m.k);
    if(c==null || p==null || !isFinite(p) || p===0) continue;
    const pct = (c - p) / Math.abs(p) * 100;
    if(Math.abs(pct) < 5) continue;                 // ignore noise under 5%
    const up = pct > 0;
    const tone = m.neutral ? 'neutral' : ((m.lowerBetter ? !up : up) ? 'good' : 'bad');
    const mag = Math.abs(pct);
    const dirWord = up ? 'up' : 'down';
    const text = m.verb
      ? `${m.fmt(c)} people ${m.verb} — ${m.noun} ${dirWord} ${mag.toFixed(0)}% vs last month.`
      : `Your ${m.noun} is ${dirWord} ${mag.toFixed(0)}% — now ${m.fmt(c)}.`;
    out.push({ k:m.k, tone, pct, mag, text });
  }
  // Most material movement first; a real regression outranks a tie-magnitude win.
  out.sort((a,b)=> (b.mag - a.mag) || (a.tone==='bad'? -1: 1));
  return out;
}

// The three answer columns. Each entry: { text, tone?, view?, verb? } — view/verb
// make a line actionable (jumps to the tab, optional button label).
function buildClientOverview(cur, prev){
  const changed = [];
  const insights = buildKpiInsights(cur, prev);
  if(insights.length){
    changed.push(...insights.slice(0,3).map(i=> ({ text:i.text, tone:i.tone })));
  } else if(cur){
    changed.push({ text:'Your first month of performance data is in — next month unlocks trends and comparisons.', tone:'neutral' });
  } else if(hasMarketingConnected()){
    changed.push({ text:'Your marketing is connected — the first numbers appear here within a couple of hours.', tone:'neutral' });
  } else {
    changed.push({ text:'No marketing data yet. Connect your ad platforms to start tracking performance.', tone:'neutral', view:'connections', verb:'Connect' });
  }

  const needs = [];
  // Broken / unfinished marketing connections are the client's to fix.
  (data.connections||[]).forEach(c=>{
    if(c.status==='error' || c.status==='revoked')
      needs.push({ text:`${platformInfo(c.provider).title} stopped syncing — reconnect to resume reporting.`, tone:'bad', view:'connections', verb:'Reconnect' });
    else if(c.status==='pending')
      needs.push({ text:`${platformInfo(c.provider).title} sign-in wasn't finished — connect again to complete it.`, tone:'warn', view:'connections', verb:'Finish' });
  });
  // Video waiting on the practice's approval (v.blocked + v.blocked_reason).
  (data.video||[]).filter(v=> v.blocked).forEach(v=>{
    const days = daysIn(v.stage_since);
    const why = (v.blocked_reason||'').trim();
    needs.push({ text:`“${v.item}” is waiting on you${why?` — ${why}`:' for approval'}${days?` · ${days} day${days===1?'':'s'}`:''}.`, tone: days>=7?'bad':'warn', view:'video', verb:'Review' });
  });
  // Un-onboarded marketing (only when nothing is connected and they haven't opted out).
  if(shouldPromptMarketingConnect() && !(data.connections||[]).length)
    needs.push({ text:'Connect your marketing data to unlock live KPI reporting.', tone:'warn', view:'connections', verb:'Connect' });

  const next = [];
  const ds = milestoneDisplayStatusMap();
  const miles = sortedMilestones();
  const current = miles.find(m=> ds.get(m.id)==='current');
  const upcoming = miles.find(m=> ds.get(m.id)==='upcoming');
  if(current) next.push({ text:`You're in “${current.name}”${current.target_date? ` · planned ${prettyDate(current.target_date,'month')}`:''}.`, tone:'neutral', view:'roadmap' });
  if(upcoming) next.push({ text:`Next milestone: ${upcoming.name}${upcoming.target_date? ` · ${prettyDate(upcoming.target_date,'month')}`:''}.`, tone:'neutral', view:'roadmap' });
  // Nearest deliverable still in flight.
  const openDeliv = (data.deliv||[]).filter(d=> d.status!=='delivered');
  if(openDeliv.length){
    const d = openDeliv[0];
    next.push({ text:`${openDeliv.length} deliverable${openDeliv.length===1?'':'s'} in progress — next up: ${d.name}.`, tone:'neutral', view:'deliverables' });
  } else if((data.deliv||[]).length){
    next.push({ text:'Every deliverable is shipped — you\'re fully caught up.', tone:'good', view:'deliverables' });
  }
  if(!next.length) next.push({ text:'Your roadmap will appear here at kickoff.', tone:'neutral' });

  return { changed, needs, next };
}

function overviewCol(title, items){
  const rows = items.length ? items.map(it=>{
    const dot = `<span class="ov-dot ${it.tone||'neutral'}"></span>`;
    const cta = it.view ? `<button class="ov-cta" data-ovview="${it.view}">${esc(it.verb||'View')}</button>` : '';
    return `<li class="ov-item">${dot}<span class="ov-text">${esc(it.text)}</span>${cta}</li>`;
  }).join('') : `<li class="ov-item ov-empty"><span class="ov-dot neutral"></span><span class="ov-text note">Nothing right now.</span></li>`;
  return `<div class="ov-col"><div class="ov-col-title">${esc(title)}</div><ul class="ov-list">${rows}</ul></div>`;
}

function renderClientOverview(cur, prev){
  const el = $('clientOverview'); if(!el) return;
  if(isTeamView() || !data.practice){ el.classList.add('hidden'); el.innerHTML=''; return; }
  const ov = buildClientOverview(cur, prev);
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="ov-grid">
      ${overviewCol('What changed', ov.changed)}
      ${overviewCol('What needs you', ov.needs)}
      ${overviewCol('What\'s next', ov.next)}
    </div>`;
  el.querySelectorAll('.ov-cta').forEach(b=> b.onclick = ()=>{ location.hash = '#' + b.dataset.ovview; });
}

/* ================= OVERVIEW dashboard (default client landing) =================
   A real "everything in one view" dashboard composed live from the same data the
   detail tabs use: editable KPI cards (kpi_dashboard_prefs), a spend/reach chart,
   current phase, live sync, video pipeline and latest updates. The comprehensive
   analysis lives in the dedicated tabs; this is the at-a-glance layer.
   Month selection is the SAME state the Metrics tab uses (getSel/ALL_MONTHS). */
let ovMonthApi = null;   // themed month dropdown instance (Overview)
// small wifi/sync glyph beside each source, coloured by connection-state tone
function ovWifi(tone){
  return `<span class="ov-wifi tone-${tone||'muted'}" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 11.5a11 11 0 0 1 15 0"/><path d="M8 15a6 6 0 0 1 8 0"/><circle cx="12" cy="18.5" r="1"/></svg></span>`;
}
// normalized SVG sparkline (pathLength=1 so the draw animation is length-agnostic)
function ovSpark(values){
  const v = values.map(x=> x==null?0:x);
  if(v.length < 2) return '';
  const w=240,h=42, mn=Math.min(...v), mx=Math.max(...v), span=(mx-mn)||1, step=w/(v.length-1);
  const pts = v.map((x,i)=> `${(i*step).toFixed(1)},${(h-((x-mn)/span)*(h-6)-3).toFixed(1)}`);
  const line = `M ${pts.join(' L ')}`;
  return `<svg class="ov-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="ovsg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="var(--gold)" stop-opacity="0.35"/><stop offset="100%" stop-color="var(--gold)" stop-opacity="0"/>
    </linearGradient></defs>
    <path class="area" d="${line} L ${w},${h} L 0,${h} Z" fill="url(#ovsg)"/>
    <path class="line" pathLength="1" d="${line}" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
// Interactive dual-series area chart (spend + reach) for the Performance card.
// Uniform-scaled SVG (markers stay circular); hover reveals exact values.
function ovBigChart(asc){
  const rows = asc.slice(-12);
  const w=640,h=240, pad=20;
  if(rows.length < 2) return `<div class="ov-chart-empty note">Your performance chart appears once two or more months are reported.</div>`;
  const xs = i=> (rows.length===1 ? w/2 : (i/(rows.length-1))*w);
  const norm = (key)=>{
    const nums = rows.map(r=>{ const v=N(r,key); return v==null?0:v; });
    const mx=Math.max(...nums,1), mn=Math.min(...nums,0), span=(mx-mn)||1;
    return nums.map(v=> h - ((v-mn)/span)*(h-2*pad) - pad);
  };
  const sy=norm('spend'), ry=norm('reach');
  const path = ys => 'M ' + ys.map((y,i)=> `${xs(i).toFixed(1)},${y.toFixed(1)}`).join(' L ');
  const p1=path(sy), p2=path(ry);
  const grid = [0.25,0.5,0.75].map(y=> `<line x1="0" x2="${w}" y1="${(h*y).toFixed(0)}" y2="${(h*y).toFixed(0)}" stroke="oklch(1 0 0 / 0.05)" stroke-dasharray="3 4"/>`).join('');
  const band = w/rows.length;
  const hits = rows.map((r,i)=> `<rect class="ov-hit" data-i="${i}" data-cx="${xs(i).toFixed(1)}" data-cy="${sy[i].toFixed(1)}" x="${(xs(i)-band/2).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${h}" fill="transparent"/>`).join('');
  const labels = rows.map(r=> periodLabel(r.period).slice(0,3));
  return `<div class="ov-chart" data-chart>
    <svg viewBox="0 0 ${w} ${h}" class="ov-chart-svg" role="img" aria-label="Spend and reach over time">
      <defs>
        <linearGradient id="ova1" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--gold)" stop-opacity="0.3"/><stop offset="100%" stop-color="var(--gold)" stop-opacity="0"/></linearGradient>
        <linearGradient id="ova2" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="oklch(0.7 0.12 60)" stop-opacity="0.22"/><stop offset="100%" stop-color="oklch(0.7 0.12 60)" stop-opacity="0"/></linearGradient>
      </defs>
      ${grid}
      <line class="ov-cross" x1="0" y1="0" x2="0" y2="${h}" stroke="oklch(0.82 0.14 82 / 0.25)" stroke-width="1"/>
      <path class="area" d="${p1} L ${w},${h} L 0,${h} Z" fill="url(#ova1)"/>
      <path class="line" pathLength="1" d="${p1}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="area" d="${p2} L ${w},${h} L 0,${h} Z" fill="url(#ova2)"/>
      <path class="line dash" pathLength="1" d="${p2}" fill="none" stroke="oklch(0.7 0.12 60)" stroke-width="1.5" stroke-dasharray="4 4" stroke-linecap="round"/>
      ${hits}
    </svg>
    <div class="ov-tip" hidden></div>
    <div class="ov-chart-x">${labels.map(l=> `<span>${esc(l)}</span>`).join('')}</div>
  </div>`;
}
// Wire hover interactions on the Performance chart (tooltip + crosshair + markers).
function wireOvChart(chart, rows){
  if(!chart || !rows || rows.length<2) return;
  const tip = chart.querySelector('.ov-tip');
  const cross = chart.querySelector('.ov-cross');
  const svg = chart.querySelector('.ov-chart-svg');
  const TIP_METRICS = [['spend','Spend'],['reach','Reach'],['clicks','Link clicks'],['cpc','CPC'],['ctr','CTR']];
  const show = i=>{
    const r = rows[i]; if(!r) return;
    const hit = chart.querySelector(`.ov-hit[data-i="${i}"]`);
    const cx = hit && hit.dataset.cx, cy = hit && hit.dataset.cy;
    if(cross && cx!=null){ cross.setAttribute('x1',cx); cross.setAttribute('x2',cx); cross.style.opacity=1; }
    const body = TIP_METRICS.map(([k,l])=>{ const d=metricDef(k); const v=d?metricValue(d,r):N(r,k);
      return v==null ? '' : `<div class="ov-tip-row"><span>${esc(l)}</span><span>${esc(d?d.fmt(v):String(v))}</span></div>`; }).join('');
    const prev = rows[i-1];
    let mom = '';
    if(prev){ const cs=N(r,'spend'), ps=N(prev,'spend'); if(cs!=null && ps){ const p=((cs-ps)/Math.abs(ps))*100;
      mom = `<div class="ov-tip-mom ${p>=0?'up':'down'}">${p>=0?'▲':'▼'} ${Math.abs(p).toFixed(0)}% from ${esc(periodLabel(prev.period))}</div>`; } }
    tip.innerHTML = `<div class="ov-tip-title">${esc(periodLabel(r.period))}</div>${body}${mom}`;
    tip.hidden = false;
    // position over the spend point (computed from viewBox coords → pixels), clamped inside the chart
    const cr = chart.getBoundingClientRect();
    const sr = (svg||chart).getBoundingClientRect();
    const vb = (svg && svg.viewBox && svg.viewBox.baseVal) || {width:640,height:240};
    const px = sr.left + (parseFloat(cx)/vb.width)*sr.width - cr.left;
    const py = sr.top + (parseFloat(cy)/vb.height)*sr.height - cr.top;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = px - tw/2;
    left = Math.max(6, Math.min(cr.width - tw - 6, left));
    let top = py - th - 14;
    if(top < 4) top = py + 16;
    tip.style.left = left+'px'; tip.style.top = top+'px';
  };
  const hide = ()=>{ if(tip) tip.hidden = true; if(cross) cross.style.opacity=0; };
  chart.querySelectorAll('.ov-hit').forEach(rect=>{
    const i = +rect.dataset.i;
    rect.addEventListener('mouseenter', ()=> show(i));
    rect.addEventListener('mousemove', ()=> show(i));
  });
  chart.addEventListener('mouseleave', hide);
}
function renderOverview(reported){
  if(!$('ovKpis')) return;
  const seg = (name, fn)=>{ try{ fn(); }catch(e){ console.warn('[overview] '+name+' failed:', e); } };
  const kpi = data.kpi || [];
  const connected = hasMarketingConnected();

  // ---- Month selector (themed component; SAME state as Metrics: getSel/ALL_MONTHS) ----
  seg('month selector', ()=>{
    const host = $('ovRange'); if(!host) return;
    const sel = getSel();
    const cur = (isAllMonthsSel(sel) || sel==null) ? ALL_MONTHS : String(sel);
    const opts = [{ value:ALL_MONTHS, label:'All months' }]
      .concat(reported.map(r=> ({ value:String(r.period), label:periodLabel(r.period) })));
    if(!host.querySelector('.ov-msel-mount')){
      host.innerHTML = `<label class="ov-monthlbl">Reporting</label>
        <div class="ov-msel-mount"></div>
        <button class="btn ghost sm ov-cust" id="ovCustomize" type="button" title="Add, remove or reorder your KPI cards">Customize</button>`;
      ovMonthApi = themedSelect(host.querySelector('.ov-msel-mount'), { options:opts, value:cur,
        onChange:v=>{ setSel(v===ALL_MONTHS ? ALL_MONTHS : v); render(); } });
      if(typeof openKpiPrefsEditor==='function') $('ovCustomize').onclick = openKpiPrefsEditor;
    } else if(ovMonthApi){
      ovMonthApi.setOptions(opts); ovMonthApi.setValue(cur);
    }
  });

  // ---- editable KPI cards (kpi_dashboard_prefs) ----
  seg('kpi cards', ()=>{
    const sel = getSel();
    const allMonths = isAllMonthsSel(sel) || sel==null;
    const rangeSummary = summarizeKpiRange(kpi);
    const selRow = allMonths ? rangeSummary.totals : kpi.find(r=> String(r.period)===String(sel));
    const priorRow = (()=>{ if(allMonths) return null; const i = reported.findIndex(r=> String(r.period)===String(sel)); return i>=0 ? reported[i+1] : null; })();
    const cards = activeKpiCards();
    $('ovKpis').innerHTML = cards.map((card,i)=>{
      const def = metricDef(card.k); if(!def) return '';
      const label = card.label || def.label;
      const val = selRow ? metricValue(def, selRow) : null;
      const prev = priorRow ? metricValue(def, priorRow) : null;
      const delta = (val!=null && prev!=null && isFinite(prev) && prev!==0) ? (val-prev)/Math.abs(prev)*100 : null;
      const up = delta!=null && delta>0;
      const tone = delta==null ? 'idle' : ((def.lowerBetter ? !up : up) ? 'good' : 'bad');
      const sub = (val==null)
        ? (connected ? 'No data this period' : 'Connect your marketing data')
        : (delta!=null ? `${up?'▲':'▼'} ${Math.abs(delta).toFixed(Math.abs(delta)<10?1:0)}% vs prior`
           : (allMonths ? `cumulative · ${rangeSummary.monthCount} mo` : periodLabel(sel)));
      const spark = reported.slice().reverse().map(r=> metricValue(def, r));
      const display = val==null ? def.fmt(0) : def.fmt(val);
      return `<div class="ov-kpi">
        <div class="ov-kpi-label">${esc(label)}</div>
        <div class="ov-kpi-val count-up" data-ovk="${i}">${esc(display)}</div>
        <div class="ov-kpi-delta ${tone}">${esc(sub)}</div>
        ${ovSpark(spark)}
      </div>`;
    }).join('') || `<div class="ov-kpi-empty note">No KPI cards selected. <button class="ov-inline-link" id="ovCustomize2" type="button">Customize</button></div>`;
    cards.forEach((card,i)=>{
      const def = metricDef(card.k); if(!def) return;
      const val = selRow ? metricValue(def, selRow) : null;
      dsCountUp($('ovKpis').querySelector(`[data-ovk="${i}"]`), val==null?0:val, v=> def.fmt(v), `ovk:${practiceId}:${sel}:${card.k}`);
    });
    if($('ovCustomize2') && typeof openKpiPrefsEditor==='function') $('ovCustomize2').onclick = openKpiPrefsEditor;
  });

  // ---- Performance chart (Spend & Reach, interactive hover) ----
  seg('performance chart', ()=>{
    const asc = [...reported].reverse();
    $('ovPerf').innerHTML = `
      <div class="ov-card-head">
        <div><div class="ov-eyebrow">Performance</div><h3 class="ov-card-title">Spend &amp; reach</h3></div>
        <div class="ov-legend"><span class="ov-leg"><span class="ov-leg-dot" style="background:var(--gold)"></span>Spend</span><span class="ov-leg"><span class="ov-leg-dot" style="background:oklch(0.7 0.12 60)"></span>Reach</span></div>
      </div>
      ${ovBigChart(asc)}`;
    wireOvChart($('ovPerf').querySelector('.ov-chart'), asc.slice(-12));
  });

  // ---- Current phase (from milestones + deliverables) ----
  seg('current phase', ()=>{
    const ds = milestoneDisplayStatusMap();
    const miles = sortedMilestones();
    const current = miles.find(m=> ds.get(m.id)==='current') || miles.find(m=> ds.get(m.id)==='upcoming');
    const delivered = (data.deliv||[]).filter(d=> d.status==='delivered').length;
    const pct = current && current.progress_pct!=null ? current.progress_pct
              : (data.deliv||[]).length ? Math.round(100*delivered/data.deliv.length) : 0;
    $('ovPhase').innerHTML = current ? `
      <div class="ov-card-head"><div class="ov-eyebrow">Current phase</div><span class="ov-pct">${pct}%</span></div>
      <h3 class="ov-card-title">${esc(current.name)}</h3>
      <div class="ov-progress"><div class="ov-progress-fill" style="width:${pct}%"></div></div>
      <a class="ov-link" href="#roadmap">View roadmap ↗</a>` : `
      <div class="ov-card-head"><div class="ov-eyebrow">Current phase</div></div>
      <h3 class="ov-card-title">Kickoff</h3>
      <p class="note">Your roadmap appears here once milestones are set.</p>`;
  });

  // ---- Live sync (from platform_connections) — rich per-source state ----
  seg('live sync', ()=>{
    const conns = (data.connections||[]);
    const allGreen = conns.length>0 && conns.every(c=> connStateModel(c).key==='connected');
    const rows = conns.length ? conns.slice(0,6).map(c=>{
      const m = connStateModel(c);
      // connected → show last-sync time; every other state → show the state label
      const right = m.key==='connected' ? (connAgo(c.last_synced_at)||'synced') : m.label;
      return `<li class="ov-sync-row"><span class="ov-sync-name">${ovWifi(m.tone)}${esc(platformInfo(c.provider).title)}</span>
        <span class="ov-sync-t tone-${m.tone}">${esc(right)}</span></li>`;
    }).join('') : `<li class="ov-sync-connect"><span class="note">No marketing data connected.</span><a class="ov-link" href="#connections">Connect your marketing data</a></li>`;
    $('ovSync').innerHTML = `
      <div class="ov-card-head"><div class="ov-eyebrow">Live sync</div>
        ${conns.length ? `<span class="ov-sync-status ${allGreen?'ok':''}"><span class="ov-sync-dot2"></span>${allGreen?'All green':'Needs attention'}</span>` : ''}</div>
      <ul class="ov-sync-list">${rows}</ul>`;
  });

  // ---- Video pipeline (THIS MONTH) — only videos with activity in the current
  //      calendar month, so the "This month" label is always accurate. ----
  seg('video pipeline', ()=>{
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthName = now.toLocaleDateString(undefined, { month:'long' });
    const vids = [...(data.video||[])]
      .filter(v=> v.stage_since && new Date(v.stage_since).getTime() >= monthStart)
      .sort((a,b)=> new Date(b.stage_since||0)-new Date(a.stage_since||0)).slice(0,5);
    const vTone = s=> (s==='posted'||s==='delivered')?'good':(s==='editing'||s==='shot')?'warn':'muted';
    $('ovVideos').innerHTML = `
      <div class="ov-card-head"><div><div class="ov-eyebrow">Video pipeline</div><h3 class="ov-card-title">This month</h3></div>
        <a class="ov-link sm" href="#video">View all →</a></div>
      ${vids.length ? `<ul class="ov-vlist">${vids.map(v=>`
        <li class="ov-vrow"><span class="ov-vname">${ovVideoIco()}<span class="ov-vtxt">${esc(v.item||'Untitled')}</span></span>
        <span class="ov-vstat ${vTone(v.stage)}">${esc(stageLabelOf(v.stage))}</span></li>`).join('')}</ul>`
        : `<p class="note ov-empty-note">No video activity in ${esc(monthName)}. <a class="ov-link" href="#video">See the full pipeline →</a></p>`}`;
  });

  // ---- Latest updates (this week) — notifications + engagement events ----
  seg('latest updates', ()=>{
    const weekAgo = Date.now() - 7*86400000;
    const events = [];
    (typeof buildEngagementTimeline==='function' ? buildEngagementTimeline() : []).forEach(e=>{
      if(e && e.t) events.push({ t:e.t, text:e.text||'' });
    });
    (data.notif||[]).forEach(nItem=>{
      const txt = nItem.title || nItem.message || nItem.body;
      if(txt) events.push({ t:nItem.created_at, text:String(txt) });
    });
    // de-dup by text+minute, keep this week, newest first
    const seen = new Set();
    const week = events.filter(e=>{
      const ts = new Date(e.t).getTime();
      if(!isFinite(ts) || ts < weekAgo) return false;
      const key = (e.text||'').toLowerCase().slice(0,60) + '|' + Math.round(ts/60000);
      if(seen.has(key)) return false; seen.add(key); return true;
    }).sort((a,b)=> new Date(b.t)-new Date(a.t)).slice(0,6);
    $('ovUpdates').innerHTML = `
      <div class="ov-card-head"><div><div class="ov-eyebrow">Latest updates</div><h3 class="ov-card-title">This week</h3></div>
        <a class="ov-link sm" href="#updates">View all →</a></div>
      ${week.length ? `<ol class="ov-timeline">${week.map(e=>`
        <li class="ov-tl-item"><span class="ov-tl-dot"></span>
        <div class="ov-tl-text">${esc(e.text)}</div>
        <div class="ov-tl-time">${esc(connAgo(e.t)||'')}</div></li>`).join('')}</ol>`
        : `<p class="note ov-empty-note">No updates yet this week.</p>`}`;
  });
}
// small video glyph for the pipeline rows
function ovVideoIco(){ return `<span class="ov-vico" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="13" height="12" rx="2"/><path d="M22 8l-5 4 5 4V8z"/></svg></span>`; }

/* ---------------- Marketing Setup Wizard (opt-in, client) ----------------
   Never blocks the portal. Opened via the Metrics CTA or the Connections tab.
   Finish marks it done; "Continue without connecting" persists a declined flag
   so the CTA stops nagging (the Connections tab still lets them connect later). */
const WIZARD_PROVIDERS = [
  { key:'meta',   title:'Facebook & Instagram',
    body:'Your ads, reach, and engagement across Facebook and Instagram — connected in one click with your Facebook login.' },
  { key:'google', title:'Google',
    body:'Your Google Ads performance and website analytics — connected with your Google login.' },
];
let marketingWizardOpen = false;
// Persisted opt-out: "Continue without connecting" records a declined flag so the
// in-context prompt stops nagging. Stored on the practice (wizard_declined_at) so
// it carries across every device and co-owner — the Connections tab is always
// available to connect later, so declining hides the CTA, not the capability.
function marketingDeclined(){
  return !!(data.practice?.wizard_declined_at);
}
async function setMarketingDeclined(v){
  if(!practiceId) return;
  if(data.practice) data.practice.wizard_declined_at = v ? new Date().toISOString() : null;
  try{ await sb.rpc('decline_marketing_wizard', { p_practice: practiceId, p_declined: !!v }); }catch(_){}
}
function hasMarketingConnected(){
  const conns = data.connections || [];
  if(conns.some(c=> c.status === 'connected')) return true;
  // Practices on the legacy sheet pipeline count as connected too.
  return (data.kpiRaw||[]).some(r=>{
    const s = N(r,'spend'), reach = N(r,'reach'), clicks = N(r,'clicks');
    return s!=null || reach!=null || clicks!=null;
  });
}
function marketingOnboardingSettled(){
  return !!(data.practice?.wizard_completed_at) || hasMarketingConnected() || marketingDeclined();
}
function shouldPromptMarketingConnect(){
  return !isTeamView() && data.practice && !marketingOnboardingSettled();
}
function openMarketingWizard(){
  if(isTeamView() || !data.practice) return;
  marketingWizardOpen = true;
  const modal = $('setupWizardModal');
  // Must remove `hidden` too — `.hidden{display:none !important}` (styles.css)
  // overrides `.modal.open{display:flex}`, so `.open` alone leaves it invisible.
  if(modal){ modal.classList.remove('hidden'); modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); }
  renderSetupWizard();
  $('setupWizard')?.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function closeMarketingWizard(){
  marketingWizardOpen = false;
  const modal = $('setupWizardModal');
  if(modal){ modal.classList.remove('open'); modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }
  const el = $('setupWizard'); if(el) el.innerHTML = '';
}
function renderMarketingMetricsCta(){
  const el = $('mktMetricsCta'); if(!el) return;
  if(!shouldPromptMarketingConnect()){
    el.classList.add('hidden'); el.innerHTML = ''; return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="mkt-cta-card">
      <h3>Connect Your Marketing Data</h3>
      <p class="note">To begin tracking your marketing performance inside ROXIUM, connect your advertising platforms.</p>
      <ul class="mkt-cta-list">
        <li>✓ Meta Ads &amp; Instagram</li>
        <li>✓ Google Ads</li>
        <li>✓ Google Analytics</li>
        <li>✓ Microsoft Ads <span class="note">(optional)</span></li>
      </ul>
      <p class="note mkt-cta-time">Estimated setup time: 2–5 minutes.</p>
      <button type="button" class="btn btn-connect-marketing">Connect Marketing</button>
    </div>`;
}
function wireMarketingConnectButtons(){
  document.querySelectorAll('.btn-connect-marketing').forEach(btn=>{
    if(btn._mktWired) return;
    btn._mktWired = true;
    btn.addEventListener('click', e=>{ e.preventDefault(); openMarketingWizard(); });
  });
  if(!document.body._mktModalWired){
    document.body._mktModalWired = true;
    $('setupWizardModal')?.addEventListener('click', e=>{
      if(e.target?.id === 'setupWizardModal') closeMarketingWizard();
    });
  }
}
function renderSetupWizard(){
  const el = $('setupWizard'); if(!el) return;
  if(!marketingWizardOpen || isTeamView() || !data.practice){
    closeMarketingWizard();
    return;
  }
  let flash = '';
  try{
    const q = new URL(location.href).searchParams;
    if(q.get('connect_error')){
      flash = `<div class="wizard-flash err">That connection didn't complete (${esc(q.get('connect_error'))}). Nothing was changed — try again, or we'll help on a quick call.</div>`;
    }
  }catch(_){}
  const conn = k => (data.connections||[]).find(c=> c.provider===k);
  // Green running summary of everything the client has connected so far.
  const connectedNow = WIZARD_PROVIDERS.filter(p=> conn(p.key)?.status==='connected');
  const summary = connectedNow.length
    ? `<div class="wizard-flash ok">✓ Connected: ${connectedNow.map(p=> esc(p.title)).join(', ')} — your numbers start appearing within a couple of hours.</div>`
    : '';
  const cards = WIZARD_PROVIDERS.map(p=>{
    const c = conn(p.key);
    const state = c && c.status==='connected'
      ? `<span class="ssok">✓ Connected${c.external_account_name? ` — ${esc(c.external_account_name)}`:''}</span>`
      : c && c.status==='error'
        ? `<button class="btn sm wizard-connect" data-provider="${p.key}">Reconnect</button>`
        : `<button class="btn sm wizard-connect" data-provider="${p.key}">Connect</button>`;
    return `<div class="wizard-card">
      <div class="wizard-card-title">${esc(p.title)}</div>
      <p class="note">${esc(p.body)}</p>
      <div class="wizard-card-state" data-state-for="${p.key}">${state}</div>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="wizard-head">
      <button type="button" class="modalx wizard-close" id="wizardClose" title="Close">✕</button>
      <div class="eyebrow">${connectedNow.length ? 'Marketing connected' : 'Connect your marketing'}</div>
      <p class="note">${connectedNow.length
        ? 'You\'re all set — connect any others below if you like, then hit Finish. You can add or disconnect sources anytime.'
        : 'Use your own logins below — you never share a password, we only <b>read</b> your numbers, and you can disconnect anytime. Takes about two minutes.'}</p>
    </div>
    ${flash}${summary}
    <div class="wizard-cards">${cards}</div>
    <div class="wizard-foot">
      <button class="btn sm" id="wizardDone">Finish</button>
    </div>`;
  el.querySelectorAll('.wizard-connect').forEach(b=> b.onclick = async ()=>{
    const label = b.textContent;                     // restore on failure so it stays retryable
    const holder = el.querySelector(`[data-state-for="${b.dataset.provider}"]`);
    const oldHint = holder && holder.parentElement && holder.parentElement.querySelector('.wizard-retry');
    if(oldHint) oldHint.remove();
    b.disabled = true; b.textContent = 'Opening…';
    try{
      const { data: res, error } = await sb.functions.invoke('oauth-start', {
        body: { provider: b.dataset.provider, practice_id: practiceId }
      });
      if(error) throw error;
      if(res?.url){ location.href = res.url; return; }
      // Provider genuinely not configured on the server (no secrets) — the one
      // case where swapping the button for the "we'll handle it" note is right.
      if(res && res.configured === false){
        if(holder) holder.innerHTML = '<span class="note">Our team will connect this with you — you\'ll get a short email with exactly two clicks.</span>';
        return;
      }
      throw new Error('no authorize URL returned');
    }catch(e){
      // Transient failure — keep the button clickable so the client can retry,
      // instead of replacing it with a dead note.
      console.warn('[wizard] oauth-start failed:', e);
      b.disabled = false; b.textContent = label;
      if(holder){
        const hint = document.createElement('p');
        hint.className = 'note wizard-retry';
        hint.textContent = 'That didn\'t open — please try again.';
        holder.insertAdjacentElement('afterend', hint);
      }
    }
  });
  const finish = async ()=>{
    // complete_marketing_wizard also nulls wizard_declined_at server-side, so
    // finishing supersedes any prior opt-out; just mirror both locally.
    try{ await sb.rpc('complete_marketing_wizard', { p_practice: practiceId }); }catch(_){}
    if(data.practice){ data.practice.wizard_completed_at = new Date().toISOString(); data.practice.wizard_declined_at = null; }
    try{ const u = new URL(location.href); u.searchParams.delete('connected'); u.searchParams.delete('connect_error'); history.replaceState(null,'',u); }catch(_){}
    closeMarketingWizard();
    render();
  };
  $('wizardDone').onclick = finish;
  $('wizardClose').onclick = ()=> closeMarketingWizard();
}
function maybeOpenWizardFromOAuthReturn(){
  try{
    const q = new URL(location.href).searchParams;
    if(q.get('connected') || q.get('connect_error')) openMarketingWizard();
  }catch(_){}
}

/* ---------------- KPI dashboard customization (editor modal) ---------------- */
let kpiEditorState = null;
function openKpiPrefsEditor(){
  kpiEditorState = activeKpiCards().map(c=> ({ k:c.k, label:c.label||'' }));
  renderKpiPrefsEditor();
  const modal = $('kpiPrefsModal');
  if(modal){
    modal.classList.remove('hidden'); modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
    modal.onclick = e=>{ if(e.target === modal) closeKpiPrefsEditor(); };
  }
}
function closeKpiPrefsEditor(){
  const modal = $('kpiPrefsModal');
  if(modal){ modal.classList.remove('open'); modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }
  kpiEditorState = null;
}
function renderKpiPrefsEditor(){
  const card = $('kpiPrefsCard'); if(!card || !kpiEditorState) return;
  // carry any in-progress rename inputs into state before re-rendering
  const syncRenames = ()=> card.querySelectorAll('.kpipref-rename').forEach(inp=>{
    const i = +inp.dataset.i; if(kpiEditorState[i]) kpiEditorState[i].label = inp.value.trim();
  });
  const used = new Set(kpiEditorState.map(c=> c.k));
  const addable = METRIC_REGISTRY.filter(d=> !used.has(d.k));
  const rows = kpiEditorState.map((c,i)=>{
    const def = metricDef(c.k); if(!def) return '';
    return `<div class="kpipref-row">
      <span class="kpipref-move">
        <button type="button" class="kpipref-btn" data-move="up" data-i="${i}" ${i===0?'disabled':''} title="Move up">▲</button>
        <button type="button" class="kpipref-btn" data-move="down" data-i="${i}" ${i===kpiEditorState.length-1?'disabled':''} title="Move down">▼</button>
      </span>
      <span class="kpipref-name">${esc(def.label)}</span>
      <input class="kpipref-rename" data-i="${i}" placeholder="${esc(def.label)}" value="${esc(c.label||'')}" title="Custom label (optional)">
      <button type="button" class="kpipref-btn kpipref-x" data-remove="${i}" title="Remove card">✕</button>
    </div>`;
  }).join('');
  card.innerHTML = `
    <h3 class="kpipref-title">Customize your KPI dashboard</h3>
    <p class="note">Choose which metrics appear, rename them, and set their order. A card only shows when its metric has data for the selected month.</p>
    <div class="kpipref-list">${rows || '<p class="note">No cards yet — add your first KPI below.</p>'}</div>
    <div class="kpipref-add">
      <select id="kpiPrefAddSel" class="picker">${addable.map(d=> `<option value="${d.k}">${esc(d.label)}</option>`).join('')}</select>
      <button type="button" class="btn sm" id="kpiPrefAddBtn" ${addable.length?'':'disabled'}>＋ Add KPI</button>
    </div>
    <div class="kpipref-foot">
      <button type="button" class="btn ghost sm" id="kpiPrefReset">Reset to default</button>
      <span class="kpipref-spacer"></span>
      <button type="button" class="btn ghost sm" id="kpiPrefCancel">Cancel</button>
      <button type="button" class="btn sm" id="kpiPrefSave">Save dashboard</button>
    </div>`;
  card.querySelectorAll('[data-move]').forEach(b=> b.onclick = ()=>{
    syncRenames();
    const i = +b.dataset.i, j = b.dataset.move==='up' ? i-1 : i+1;
    if(j<0 || j>=kpiEditorState.length) return;
    [kpiEditorState[i], kpiEditorState[j]] = [kpiEditorState[j], kpiEditorState[i]];
    renderKpiPrefsEditor();
  });
  card.querySelectorAll('[data-remove]').forEach(b=> b.onclick = ()=>{
    syncRenames(); kpiEditorState.splice(+b.dataset.remove, 1); renderKpiPrefsEditor();
  });
  $('kpiPrefAddBtn')?.addEventListener('click', ()=>{
    const k = $('kpiPrefAddSel')?.value; if(!k) return;
    syncRenames(); kpiEditorState.push({ k, label:'' }); renderKpiPrefsEditor();
  });
  $('kpiPrefReset').onclick = async ()=>{ await saveKpiPrefs(null); closeKpiPrefsEditor(); render(); };
  $('kpiPrefCancel').onclick = ()=> closeKpiPrefsEditor();
  $('kpiPrefSave').onclick = async ()=>{
    syncRenames();
    const cards = kpiEditorState.map(c=> c.label ? { k:c.k, label:c.label } : { k:c.k });
    await saveKpiPrefs(cards); closeKpiPrefsEditor(); render();
  };
}

/* ---------------- Marketing Connections manager ------------------------------
   AgencyAnalytics-style self-service data sources. PLATFORM_CATALOG is the
   connector registry: adding a future platform = one entry here + a Composio
   auth config (COMPOSIO_<KEY>_AUTH_CONFIG_ID secret). No page redesign.
   Connected platforms disappear from "Add data source" until disconnected;
   disconnecting stops future syncs but preserves every imported KPI row. */
// `mono` = a 1–2 letter monogram rendered as a gold-lettered badge — no emojis,
// consistent with the portal's Cormorant/gold aesthetic.
const PLATFORM_CATALOG = [
  { key:'meta',               title:'Meta Ads',                mono:'M',  blurb:'Facebook & Instagram advertising — spend, reach, impressions and link clicks.', dflt:true },
  { key:'facebook_insights',  title:'Facebook Insights',       mono:'FB', blurb:'Organic Facebook page performance and audience growth.', dflt:true },
  { key:'instagram_insights', title:'Instagram Insights',      mono:'IG', blurb:'Organic Instagram reach, profile activity and engagement.', dflt:true },
  { key:'google',             title:'Google Ads',              mono:'G',  blurb:'Search & display campaigns — cost, impressions and clicks.', dflt:true },
  { key:'google_analytics',   title:'Google Analytics',        mono:'GA', blurb:'Website sessions, traffic sources and on-site conversions.', dflt:true },
  { key:'youtube',            title:'YouTube Analytics',       mono:'YT', blurb:'Channel views, watch time and subscriber growth.', dflt:true },
  { key:'microsoft_ads',      title:'Microsoft Ads',           mono:'MS', blurb:'Bing search campaign performance.', dflt:true },
  { key:'tiktok',             title:'TikTok Ads',              mono:'TT', blurb:'TikTok campaign spend and performance.' },
  { key:'linkedin_ads',       title:'LinkedIn Ads',            mono:'Li', blurb:'LinkedIn campaign performance.' },
  { key:'gbp',                title:'Google Business Profile', mono:'GB', blurb:'Local search views, calls and direction requests.' },
  { key:'callrail',           title:'CallRail',                mono:'CR', blurb:'Call tracking and marketing attribution.' },
  { key:'hubspot',            title:'HubSpot',                 mono:'HS', blurb:'CRM contacts and lead pipeline.' },
];
const platformInfo = key => PLATFORM_CATALOG.find(p=> p.key===key)
  || { key, title:key.replace(/_/g,' ').replace(/\b\w/g, c=> c.toUpperCase()),
       mono:(key||'?').replace(/[^a-z0-9]/gi,'').slice(0,2).toUpperCase(), blurb:'' };
// kpi source keys written by each connector's ingestion (for the import summary)
const PLATFORM_KPI_SOURCES = { meta:['marketing'], google:['google_ads'] };

function connAgo(ts){
  if(!ts) return null;
  const s = (Date.now() - new Date(ts).getTime())/1000;
  if(!isFinite(s) || s<0) return null;
  if(s<60) return 'just now';
  const m = Math.round(s/60);  if(m<60)  return `${m} minute${m===1?'':'s'} ago`;
  const h = Math.round(s/3600); if(h<24) return `${h} hour${h===1?'':'s'} ago`;
  const d = Math.round(s/86400); return `${d} day${d===1?'':'s'} ago`;
}
// Client-facing translation of raw sync errors — the UI never shows a JSON
// blob or an HTTP status; ops still get the full string in platform_connections.
function humanizeSyncError(raw){
  if(!raw) return null;
  const s = String(raw);
  if(/RESOURCE_EXHAUSTED|quota|"code":\s*429|\b429\b/i.test(s))
    return 'The platform is limiting data pulls right now — we retry automatically every couple of hours.';
  if(/expired|invalid_grant|revoked|not active|reconnect|unauthorized|\b401\b/i.test(s))
    return 'Access needs to be renewed — click Reconnect.';
  if(/permission|forbidden|\b403\b/i.test(s))
    return 'The connected account doesn’t have permission for this data.';
  if(s.length > 120 || /^[\[{]/.test(s.trim()))
    return 'The last sync hit a temporary issue — we retry automatically.';
  return s;
}
// One health readout per connection: dot class + label + optional note.
function connHealth(c){
  if(c.status==='connected'){
    if(c.last_error) return { cls:'warn', label:'Connected — last sync had an issue', note:humanizeSyncError(c.last_error) };
    if(!c.last_synced_at) return { cls:'warn', label:'Connected — first import queued', note:'Your numbers start appearing within a couple of hours.' };
    const ago = connAgo(c.last_synced_at);
    return { cls:'ok', label:'Connected', note: ago ? `Last sync: ${ago}` : null };
  }
  if(c.status==='pending') return { cls:'warn', label:'Awaiting connection', note:'The sign-in wasn’t finished — connect again to complete it.' };
  if(c.status==='error')   return { cls:'bad',  label:'Needs reconnecting', note:humanizeSyncError(c.last_error) || 'The platform stopped accepting our access — reconnect to resume.' };
  return { cls:'off', label:'Disconnected', note:'Historical data is preserved. Reconnect anytime to resume syncing.' };
}
// Richer connection-state model (label + intuitive colour tone), derived purely
// from the live platform_connections row. Shared by the Overview Live Sync card,
// the sidebar sync footer, and (later) the Connections page. Tones:
//   ok=green · syncing=yellow · approval=orange · muted=grey · bad=red
function connStateModel(c){
  const s = c && c.status;
  if(s==='connected'){
    if(c.last_error)       return { key:'failed',  label:'Connection issue',   tone:'bad' };
    if(!c.last_synced_at)  return { key:'syncing',  label:'Syncing',            tone:'syncing' };
    return                        { key:'connected',label:'Connected',          tone:'ok' };
  }
  if(s==='syncing')  return { key:'syncing',  label:'Syncing',            tone:'syncing' };
  if(s==='approval') return { key:'approval', label:'Pending approval',    tone:'approval' };
  if(s==='pending')  return { key:'pending',  label:'Pending connection',  tone:'muted' };   // started, never finished — never hidden
  if(s==='error')    return { key:'failed',   label:'Connection failed',   tone:'bad' };
  if(s==='revoked' || s==='disconnected') return { key:'disconnected', label:'Disconnected', tone:'muted' };
  return { key:'notused', label:'Not used', tone:'muted' };
}
// Finer relative time for the sync footer ("1h 43m ago", "17m ago", "just now").
function syncAgo(ts){
  if(!ts) return null;
  const s = Math.floor((Date.now() - new Date(ts).getTime())/1000);
  if(!isFinite(s) || s < 0) return null;
  if(s < 45) return 'just now';
  const m = Math.floor(s/60); if(m < 60) return `${m}m ago`;
  const h = Math.floor(s/3600), rm = Math.floor((s%3600)/60);
  if(h < 24) return rm ? `${h}h ${rm}m ago` : `${h}h ago`;
  const d = Math.floor(s/86400); return `${d}d ago`;
}
// Intelligent sidebar Live Sync footer — reflects what's ACTUALLY happening:
// last successful sync, how many sources connected, syncing / failed / pending.
function renderSidebarSync(){
  const foot = $('sbFoot'); if(!foot) return;
  const sub = $('sbSyncSub');
  const dot = foot.querySelector('.sb-sync-dot');
  const conns = (data.connections||[]);
  const setDot = tone => { if(dot) dot.className = 'sb-sync-dot dot-'+tone; };
  if(!practiceId || !conns.length){
    if(sub) sub.textContent = 'No sources connected';
    setDot('muted'); return;
  }
  const states = conns.map(connStateModel);
  const total = conns.length;
  const connectedCount = states.filter(s=> s.key==='connected').length;
  const lastSync = conns.map(c=> c.last_synced_at).filter(Boolean).sort().pop() || null;
  let status, tone;
  if(states.some(s=> s.key==='failed')){ status = 'Connection failed'; tone = 'bad'; }
  else if(states.some(s=> s.key==='syncing')){ status = 'Sync in progress'; tone = 'syncing'; }
  else if(states.some(s=> s.key==='approval')){ status = 'Pending approval'; tone = 'approval'; }
  else if(connectedCount === total){ status = 'All sources green'; tone = 'ok'; }
  else if(connectedCount > 0){ status = `${connectedCount} of ${total} sources connected`; tone = 'syncing'; }
  else { status = 'Pending connection'; tone = 'muted'; }
  const when = lastSync ? `Last updated ${syncAgo(lastSync)} • ` : '';
  if(sub) sub.textContent = when + status;
  setDot(tone);
}

const connDetailsOpen = new Set();   // provider keys with the details panel expanded
let connCatalogOpen = false;

async function reloadConnections(){
  try{
    const { data: pc, error } = await sb.from('platform_connections')
      .select('provider,status,external_account_name,connected_at,last_synced_at,last_error,connected_by')
      .eq('practice_id', practiceId);
    if(!error && Array.isArray(pc)) data.connections = pc;
  }catch(_){}
  renderConnectionsPage();
}
function connFlash(msg, ok=true){
  const el = $('connFlash'); if(!el) return;
  el.innerHTML = msg ? `<div class="wizard-flash ${ok?'ok':'err'}">${msg}</div>` : '';
}
// Begin (or redo) a connection — same oauth-start flow the wizard uses.
async function startPlatformConnect(provider, btn){
  const label = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = 'Opening…'; }
  try{
    const { data: res, error } = await sb.functions.invoke('oauth-start', {
      body: { provider, practice_id: practiceId }
    });
    if(error) throw error;
    if(res?.url){ location.href = res.url; return; }
    if(res && res.configured === false){
      connFlash(`${esc(platformInfo(provider).title)} isn’t self-serve yet — our team wires this one up for you. Nothing else needed.`, true);
      if(btn){ btn.disabled = false; btn.textContent = label; }
      return;
    }
    throw new Error('no authorize URL returned');
  }catch(e){
    console.warn('[connections] oauth-start failed:', e);
    connFlash('That didn’t open — please try again in a moment.', false);
    if(btn){ btn.disabled = false; btn.textContent = label; }
  }
}

function renderConnectionsPage(){
  const list = $('connList'); if(!list) return;
  if(!canSeeConnectionsTab() || !practiceId){ list.innerHTML=''; return; }
  const conns = (data.connections||[]).slice()
    .sort((a,b)=> String(a.provider).localeCompare(String(b.provider)));

  // ---- connected / known sources ----
  list.innerHTML = conns.length ? conns.map(c=>{
    const p = platformInfo(c.provider);
    const h = connHealth(c);
    const open = connDetailsOpen.has(c.provider);
    const isConn = c.status==='connected';
    const actions = [
      isConn ? `<button class="btn ghost sm conn-act" data-act="refresh" data-p="${c.provider}">Refresh now</button>` : '',
      (c.status==='error' || c.status==='pending') ? `<button class="btn sm conn-act" data-act="connect" data-p="${c.provider}">Reconnect</button>` : '',
      c.status==='revoked' ? `<button class="btn sm conn-act" data-act="connect" data-p="${c.provider}">Reconnect</button>` : '',
      `<button class="btn ghost sm conn-act" data-act="details" data-p="${c.provider}">${open?'Hide details':'View details'}</button>`,
      isConn ? `<button class="btn ghost sm conn-act conn-danger" data-act="disconnect" data-p="${c.provider}">Disconnect</button>` : '',
    ].filter(Boolean).join('');
    // details panel: account, connected-by/when, sync history + imported summary
    let details = '';
    if(open){
      const srcKeys = PLATFORM_KPI_SOURCES[c.provider] || [];
      const months = new Set((data.kpiRaw||[]).filter(r=> srcKeys.includes(r.source)).map(r=> r.period));
      const lines = [
        c.external_account_name ? ['Account', c.external_account_name] : null,
        ['Connected', `${c.connected_by && me && c.connected_by===me.id ? 'by you · ' : ''}${c.connected_at ? prettyDate(c.connected_at) : '—'}`],
        ['Last successful sync', c.last_synced_at ? `${prettyDate(c.last_synced_at)} (${connAgo(c.last_synced_at)||''})` : 'not yet — first import is queued'],
        months.size ? ['Imported', `${months.size} month${months.size===1?'':'s'} of performance data — live in your Metrics tab`] : null,
        c.last_error ? ['Last sync note', humanizeSyncError(c.last_error)] : null,
      ].filter(Boolean);
      details = `<div class="conn-details">${lines.map(([k,v])=>
        `<div class="conn-detail-row"><span class="conn-detail-k">${esc(k)}</span><span class="conn-detail-v">${esc(String(v))}</span></div>`).join('')}</div>`;
    }
    return `<div class="conn-card">
      <div class="conn-main">
        <span class="conn-mono">${esc(p.mono)}</span>
        <div class="conn-id">
          <div class="conn-title">${esc(p.title)}</div>
          <div class="conn-state"><span class="conn-dot ${h.cls}"></span>${esc(h.label)}${h.note && !open ? ` <span class="note">· ${esc(h.note)}</span>` : ''}</div>
        </div>
        ${c.external_account_name ? `<div class="conn-account note" title="Connected account">${esc(c.external_account_name)}</div>` : ''}
      </div>
      <div class="conn-actions">${actions}</div>
      ${details}
    </div>`;
  }).join('') : `<div class="conn-empty note">No marketing platforms connected yet — add your first data source and your dashboards populate automatically.</div>`;

  // ---- add-data-source catalog (already-connected platforms are hidden) ----
  const activeKeys = new Set(conns.filter(c=> c.status!=='revoked').map(c=> c.provider));
  const available = PLATFORM_CATALOG.filter(p=> !activeKeys.has(p.key));
  const catalog = $('connCatalog');
  if(catalog){
    const group = (items, label) => items.length ? `
      <div class="conn-cat-label">${label}</div>
      <div class="conn-cat-grid">${items.map(p=> `
        <div class="conn-cat-card">
          <span class="conn-mono">${esc(p.mono)}</span>
          <div class="conn-cat-body">
            <div class="conn-title">${esc(p.title)}</div>
            <p class="note">${esc(p.blurb)}</p>
          </div>
          <button class="btn sm conn-act" data-act="connect" data-p="${p.key}">Connect</button>
        </div>`).join('')}</div>` : '';
    catalog.innerHTML = available.length
      ? group(available.filter(p=> p.dflt), 'Core platforms') + group(available.filter(p=> !p.dflt), 'More platforms')
      : '<p class="note">Every available platform is connected.</p>';
    catalog.classList.toggle('hidden', !connCatalogOpen);
  }
  const addBtn = $('connAddBtn');
  if(addBtn){
    addBtn.textContent = connCatalogOpen ? '− Hide catalog' : '＋ Add data source';
    addBtn.onclick = ()=>{
      connCatalogOpen = !connCatalogOpen;
      addBtn.textContent = connCatalogOpen ? '− Hide catalog' : '＋ Add data source';
      catalog?.classList.toggle('hidden', !connCatalogOpen);
    };
  }

  // ---- action wiring ----
  document.querySelectorAll('#connectionsPanel .conn-act').forEach(b=> b.onclick = async ()=>{
    const provider = b.dataset.p, act = b.dataset.act;
    if(act==='connect'){ startPlatformConnect(provider, b); return; }
    if(act==='details'){
      connDetailsOpen.has(provider) ? connDetailsOpen.delete(provider) : connDetailsOpen.add(provider);
      renderConnectionsPage(); return;
    }
    if(act==='refresh'){
      b.disabled = true; b.textContent = 'Refreshing…';
      try{
        const { data: res, error } = await sb.functions.invoke('sync-platforms', {
          body: { practice_id: practiceId, provider }
        });
        if(error) throw error;
        const rep = (res?.reports||[])[0];
        connFlash(rep && !rep.error
          ? `✓ ${esc(platformInfo(provider).title)} refreshed — your dashboards are up to date.`
          : `That refresh didn’t complete${rep?.error ? ` (${esc(String(rep.error).slice(0,120))})` : ''} — it will retry automatically.`, !!(rep && !rep.error));
      }catch(e){
        console.warn('[connections] refresh failed:', e);
        connFlash('That refresh didn’t complete — it will retry automatically on the next scheduled sync.', false);
      }
      await reloadConnections();
      loadAll();   // pull fresh KPI rows into the dashboards too
      return;
    }
    if(act==='disconnect'){
      const t = platformInfo(provider).title;
      if(!await uiConfirm(`Disconnect ${esc(t)}?`, 'Future syncing stops, but every number already imported <b>stays</b> in your dashboards. You can reconnect anytime.', { danger:true, confirmLabel:'Disconnect' })) return;
      b.disabled = true;
      try{
        const { data: res, error } = await sb.rpc('disconnect_platform', { p_practice: practiceId, p_provider: provider });
        if(error || res?.ok === false) throw new Error(error?.message || res?.error || 'failed');
        connFlash(`${esc(t)} disconnected — historical data preserved. Reconnect anytime.`, true);
      }catch(e){
        console.warn('[connections] disconnect failed:', e);
        connFlash('Couldn’t disconnect just now — please try again.', false);
        b.disabled = false;
      }
      await reloadConnections();
      return;
    }
  });
}

/* ---------------- engagement timeline ----------------
   One chronological feed per practice: team-posted updates + MEANINGFUL system
   events only (deliverables delivered, milestones completed, video stage moves).
   Video: one Update per forward move; Delivered only on delivered/posted stages.
   Planned / creation seeds never appear. No new tables — merges loadAll() data. */
// Classify a free-text activity update → is it an "important" (client-cares) event,
// and which icon represents it. Keeps the What's-New "This week" list to the things
// a client would actually want after a week away (connections, KPI snapshots,
// deliveries, phase/milestone completions) — comments and minor moves are excluded.
function classifyUpdate(text){
  const s = String(text||'').toLowerCase();
  if(/connect|reconnect|\bmeta\b|google|facebook|linkedin|tiktok|instagram|integrat/.test(s)) return { important:true, ic:'connection' };
  if(/sync|snapshot|numbers|kpi|report|metric|stats/.test(s)) return { important:true, ic:'sync' };
  if(/phase .*(complete|done)|milestone|roadmap/.test(s)) return { important:true, ic:'milestone' };
  if(/deliver|posted|shipped|\blive\b|launch/.test(s)) return { important:true, ic:'delivered' };
  return { important:false, ic:'update' };
}
function buildEngagementTimeline(limit){
  const ev = [];
  const stageLbl = k => stageLabelOf(k);
  const deliveredDelivNames = new Set(
    (data.deliv||[]).filter(d=> d.status==='delivered').map(d=> (d.name||'').trim().toLowerCase())
  );
  (data.feed||[]).forEach(f=>{
    // Legacy rows: skip activity copies when the timeline already shows ✓ Delivered from data.
    const m = String(f.message||'').match(/^Deliverable completed:\s*(.+?)\.?\s*$/i);
    if(m && deliveredDelivNames.has(m[1].trim().toLowerCase())) return;
    const isComment = String(f.source||'').toLowerCase()==='comment';
    const cls = isComment ? { important:false, ic:'comment' } : classifyUpdate(f.message);
    ev.push({
      t:f.created_at, kind: isComment ? 'comment' : 'update',
      tag: isComment ? 'Comment' : 'Update', text:f.message,
      meta:`${f.author||'ROXIUM'} · ${f.source||'portal'}`, fid:f.id, edited:f.edited_at,
      important: cls.important, ic: cls.ic, pinned: !!f.pinned,
    });
  });
  (data.deliv||[]).forEach(d=>{
    if(d.status==='delivered' && d.delivered_at)
      ev.push({ t:d.delivered_at, kind:'deliverable', tag:'✓ Delivered', text:d.name, meta:d.phase||'Deliverable', important:true, ic:'delivered' });
  });
  (data.miles||[]).forEach(m=>{
    if(m.status==='done' && m.completed_on)
      ev.push({ t:m.completed_on+'T12:00:00', kind:'milestone', tag:'Milestone', text:`${m.name} — completed`, meta:'Roadmap', important:true, ic:'milestone' });
  });
  const vname = id => ((data.video||[]).find(v=> v.id===id)||{}).item || 'Video';
  const firstMove = new Map();
  (data.vhist||[]).forEach(h=>{
    const cur = firstMove.get(h.video_id);
    if(!cur || new Date(h.moved_at) < new Date(cur.moved_at)) firstMove.set(h.video_id, h);
  });
  (data.vhist||[]).forEach(h=>{
    if(h.stage==='planned') return;
    if(firstMove.get(h.video_id)===h) return;   // initial backlog seed — not progress
    const name = vname(h.video_id);
    if(h.stage==='delivered' || h.stage==='posted'){
      ev.push({
        t:h.moved_at, kind:'deliverable', tag:'✓ Delivered',
        text: h.stage==='posted' ? `${name} is posted.` : `${name} was delivered.`,
        meta:'Video production', important:true, ic:'video',
      });
      return;
    }
    ev.push({
      t:h.moved_at, kind:'update', tag:'Update',
      text:`${name} moved to ${stageLbl(h.stage)}.`,
      meta:'Video production', important:false, ic:'video',
    });
  });
  ev.sort((a,b)=> new Date(b.t)-new Date(a.t));
  return ev.slice(0, limit || 80);
}

/* ===== Updates — a concise "What's New" center (Today / Yesterday / This week)
   with a one-click full History. Client-safe: no warnings, stalled videos or
   internal ops signals ever appear here (those live in team Operations). Team
   keeps edit / delete / pin / create. ===== */
let updatesHistory = false;
const UPD_ICON = {
  delivered:  '<path d="M20 6L9 17l-5-5"/>',
  milestone:  '<path d="M4 22V4h13l-2 4 2 4H4"/>',
  sync:       '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  connection: '<path d="M8 8a4 4 0 0 0 0 8h2"/><path d="M16 8a4 4 0 0 1 0 8h-2"/><path d="M9 12h6"/>',
  video:      '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  // A team-written note reads as a human comment, not an automated event — a grey
  // speech-bubble (theme-matching) tells it apart from a delivery/sync/video icon.
  comment:    '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.6 8.6 0 0 1-4-1L3 21l1.5-5.5a8.4 8.4 0 0 1-1-4A8.5 8.5 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
  update:     '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.6 8.6 0 0 1-4-1L3 21l1.5-5.5a8.4 8.4 0 0 1-1-4A8.5 8.5 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
};
function updIconSvg(ic, tone){
  return `<span class="up-ico up-ico-${tone||'muted'}"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${UPD_ICON[ic]||UPD_ICON.update}</svg></span>`;
}
function updToneOf(ev){
  if(ev.ic==='video') return 'amber';                                    // videos → yellow
  if(ev.ic==='delivered'||ev.kind==='deliverable') return 'good';        // delivered → green
  if(ev.ic==='milestone'||ev.ic==='sync'||ev.ic==='connection'||ev.kind==='milestone') return 'orange'; // other pivotal → orange
  return 'muted';
}
function relTime(t){
  const d = new Date(t), diff = Date.now() - d.getTime();
  if(diff < 60000) return 'Just now';
  const sod = new Date(); sod.setHours(0,0,0,0);
  if(d.getTime() >= sod.getTime()) return diff < 3600000 ? Math.round(diff/60000)+'m ago' : Math.round(diff/3600000)+'h ago';
  const soy = new Date(sod); soy.setDate(soy.getDate()-1);
  if(d.getTime() >= soy.getTime()) return d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  return d.toLocaleDateString(undefined,{weekday:'short'});
}
function renderUpdates(isTeam){
  const host = $('feed'); if(!host) return;
  const all = buildEngagementTimeline(updatesHistory ? 300 : 120);
  const sod = new Date(); sod.setHours(0,0,0,0);
  const soy = new Date(sod); soy.setDate(soy.getDate()-1);
  const sow = new Date(sod); sow.setDate(sow.getDate()-7);
  const bucket = e=>{ const t=new Date(e.t).getTime();
    if(t>=sod.getTime()) return 'today';
    if(t>=soy.getTime()) return 'yesterday';
    if(t>=sow.getTime()) return 'week';
    return 'earlier';
  };
  const pinned  = all.filter(e=> e.pinned);
  const rest    = all.filter(e=> !e.pinned);
  let today   = rest.filter(e=> bucket(e)==='today');
  let yest    = rest.filter(e=> bucket(e)==='yesterday');
  let week    = rest.filter(e=> bucket(e)==='week');
  const earlier = rest.filter(e=> bucket(e)==='earlier');
  // Simple view stays concise — the latest few per section (This week is important-
  // only). History shows everything, grouped, including Earlier.
  if(!updatesHistory){
    today = today.slice(0,5);
    yest  = yest.slice(0,5);
    week  = week.filter(e=> e.important).slice(0,5);
  }

  // Where does this update live? Clicking a row jumps there.
  const navFor = ev=>{
    if(ev.ic==='video') return '#video';
    if(ev.kind==='deliverable'||ev.ic==='delivered'||ev.kind==='milestone'||ev.ic==='milestone') return '#deliverables';
    if(ev.ic==='connection') return '#connections';
    if(ev.ic==='sync') return '#metrics';
    return '';
  };
  const row = ev=>{
    const tone = updToneOf(ev);
    const nav = navFor(ev);
    const actions = (isTeam && ev.fid) ? `<span class="up-actions">
        <button class="up-pin${ev.pinned?' on':''}" type="button" data-fid="${ev.fid}" data-pin="${ev.pinned?1:0}" title="${ev.pinned?'Unpin':'Pin to top'}">${ev.pinned?'★':'☆'}</button>
        <button class="up-edit" type="button" data-fid="${ev.fid}" title="Edit">✎</button>
        <button class="up-del" type="button" data-fid="${ev.fid}" title="Delete">✕</button></span>` : '';
    return `<div class="up-item${ev.pinned?' pinned':''}${nav?' up-nav':''}" data-fid="${ev.fid||''}" data-nav="${nav}">
      ${updIconSvg(ev.ic, tone)}
      <span class="up-body">
        <span class="up-line"><span class="up-text">${esc(ev.text)}</span><span class="up-time">${esc(relTime(ev.t))}</span></span>
        ${ev.meta?`<span class="up-meta">${esc(ev.meta)}${ev.edited?' · edited':''}</span>`:''}
      </span>
      ${actions}
    </div>`;
  };
  const section = (label, items)=> items.length ? `<div class="up-sec">
    <div class="up-sec-head"><span>${label}</span><span class="up-sec-n">${items.length} item${items.length===1?'':'s'}</span></div>
    <div class="up-list">${items.map(row).join('')}</div></div>` : '';

  // Team can post their own update / comment straight from the feed.
  const compose = isTeam ? `<div class="up-compose">
      <span class="up-compose-ico" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
      <input class="up-compose-input" id="upNew" type="text" placeholder="Share an update the client will see…" autocomplete="off">
      <button class="btn sm" id="upPost" type="button">Post</button>
    </div>` : '';

  let html = compose;
  if(pinned.length) html += section('Pinned', pinned);
  html += section('Today', today);
  html += section('Yesterday', yest);
  html += section('This week', week);
  if(updatesHistory) html += section('Earlier', earlier);
  if(!pinned.length && !today.length && !yest.length && !week.length && !(updatesHistory&&earlier.length))
    html += '<p class="note">No updates yet — activity appears here as work ships.</p>';
  host.innerHTML = html;

  // click a row → jump to where that update lives (ignore the action buttons)
  host.querySelectorAll('.up-item.up-nav').forEach(r=> r.addEventListener('click', e=>{
    if(e.target.closest('button')) return;
    if(r.dataset.nav) location.hash = r.dataset.nav;
  }));

  if(isTeam){
    host.querySelectorAll('.up-edit').forEach(b=> b.onclick = ()=> editFeedItem(b.dataset.fid));
    host.querySelectorAll('.up-del').forEach(b=> b.onclick = async ()=>{
      if(!await uiConfirm('Delete this update?', 'This removes the posted update from the client feed.', {danger:true})) return;
      const { error } = await sb.from('activity').delete().eq('id', b.dataset.fid);
      if(error) uiAlert('Delete failed', esc(error.message)); else loadAll();
    });
    host.querySelectorAll('.up-pin').forEach(b=> b.onclick = ()=> togglePinUpdate(b.dataset.fid, b.dataset.pin==='1'));
    const post = $('upPost'); if(post) post.onclick = postUpdateFromFeed;
    const inp = $('upNew'); if(inp) inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); postUpdateFromFeed(); } });
  }
}
async function postUpdateFromFeed(){
  const inp = $('upNew'); if(!inp) return;
  const msg = inp.value.trim(); if(!msg) return;
  const { error } = await sb.from('activity').insert({ practice_id: practiceId, message: msg, author: (me&&me.full_name)||'ROXIUM', source:'comment' });
  if(error){ uiAlert('Post failed', esc(error.message)); return; }
  inp.value=''; loadAll();
}
async function togglePinUpdate(id, isPinned){
  const { error } = await sb.from('activity').update({ pinned: !isPinned }).eq('id', id);
  if(error){ uiAlert('Pin failed', /pinned/i.test(error.message)?'Run the activity-pinned migration first.':esc(error.message)); return; }
  loadAll();
}
/* ---- Updates unread badge — new important events since the view was last opened ---- */
function updatesSeenKey(){ return 'roxium_updates_seen_' + (practiceId||'x'); }
function markUpdatesSeen(){ try{ localStorage.setItem(updatesSeenKey(), String(Date.now())); }catch(_){ } renderUpdatesBadge(); }
function renderUpdatesBadge(){
  const el = $('sbUpdCount'); if(!el) return;
  let seen = 0; try{ seen = +localStorage.getItem(updatesSeenKey()) || 0; }catch(_){ }
  // Count important updates the user hasn't seen — but never look back more than a
  // week, so a fresh visitor gets a sensible "new this week" number (not the whole
  // history) and it clears to 0 the moment they open Updates.
  const floor = Math.max(seen, Date.now() - 7*86400000);
  // Count EVERY new item since last opened — comments and video moves included, not
  // just "important" ones — so the sidebar tally matches what actually posted. It
  // clears to 0 the moment Updates is opened (markUpdatesSeen) and returns when
  // something new lands.
  const n = buildEngagementTimeline(120).filter(e=> new Date(e.t).getTime() > floor).length;
  el.textContent = n > 9 ? '9+' : String(n);
  el.classList.toggle('hidden', n<=0);
}
/* ---- Connections warning badge — flags failing marketing connections (client) ---- */
function renderConnBadge(){
  const el = $('sbConnCount'); if(!el) return;
  const bad = (data.connections||[]).filter(c=> c.status==='error' || c.status==='revoked' || c.last_error).length;
  el.textContent = String(bad);
  el.classList.toggle('hidden', bad<=0);
}
$('updHistBtn')?.addEventListener('click', ()=>{
  updatesHistory = !updatesHistory;
  $('updHistBtn').textContent = updatesHistory ? 'Back to summary' : 'View history';
  const sub = $('updSub'); if(sub) sub.textContent = updatesHistory
    ? 'The complete history — every update, comment, delivery and change.'
    : 'Today, yesterday, and this week\'s highlights — everything important, at a glance.';
  renderUpdates(isTeamView());
});


/* ---------------- render ---------------- */
function render(){
  renderBanner();
  renderWhoami();                                          // refresh top-bar identity (practice name loads late)
  updateNotifDot();   // bell dot reflects UNSEEN notifications only
  safe('sidebar sync', ()=> renderSidebarSync());          // intelligent Live Sync footer
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
  // Default to the All-Months overview until the user explicitly picks a month.
  const allMonthsView = isAllMonthsSel(sel) || sel==null;
  let viewPeriod, emptySelected = false;
  if(allMonthsView) viewPeriod = latestPeriod;
  else if(sel==null) viewPeriod = latestPeriod;
  else if(hasData(sel)) viewPeriod = sel;
  else if(isTeamView()){ viewPeriod = sel; emptySelected = true; }
  else viewPeriod = latestPeriod;
  const latest = (!emptySelected && !allMonthsView && viewPeriod!=null) ? data.kpi.find(x=>x.period===viewPeriod) : null;
  // the snapshot immediately before the viewed one — used for trend comparison
  const prev = latest ? reported.find(x=> x.period < latest.period) : null;
  const isLive = !allMonthsView && !emptySelected && viewPeriod===latestPeriod;
  const rangeSummary = allMonthsView ? summarizeKpiRange(data.kpi) : null;
  $('updated').textContent = allMonthsView
    ? (rangeSummary?.monthCount
      ? `All months · ${rangeSummary.monthCount} reported month${rangeSummary.monthCount===1?'':'s'} · cumulative totals across the full range`
      : 'No KPI data yet across any month.')
    : emptySelected
      ? `No KPI data for ${periodLabel(viewPeriod)} yet — enter it in the Team tab and Save.`
      : latest
        ? `Showing ${periodLabel(latest.period)}${isLive?' (live)':' (archived snapshot)'} · KPI data live from Supabase`
        : 'KPI data will appear here after the first month is reported.';
  // build the month selector (latest + any reported months, + the empty month if team is on one)
  buildMetricsPicker(reported, viewPeriod, latestPeriod, emptySelected, allMonthsView);
  // build the channel selector (only when this practice has more than one ad channel)
  buildChannelPicker();
  $('kpiSub').textContent = allMonthsView
    ? (rangeSummary?.monthCount ? `All ${rangeSummary.monthCount} reported months — cumulative totals (not month-over-month).` : 'No months reported yet.')
    : emptySelected ? `${periodLabel(viewPeriod)} — no data yet.`
    : latest ? `${periodLabel(latest.period)} against target.` : 'Latest month against target.';

  // hero stats — real ad metrics (spend / reach / link clicks) + project progress
  const delivered = data.deliv.filter(x=>x.status==='delivered').length;
  // OVERVIEW dashboard (default client landing): KPI cards + performance chart +
  // current phase + live sync + video pipeline + latest updates — all composed
  // live from the same data the detail tabs use.
  safe('overview dashboard', ()=> renderOverview(reported));

  // Marketing connection prompt (single in-context surface on Metrics) + opt-in wizard.
  // The redundant global banner and the standalone Settings tab were folded into the
  // Connections page — one place to connect, one CTA to prompt it.
  safe('marketing connect', ()=>{
    renderMarketingMetricsCta();
    wireMarketingConnectButtons();
    if(marketingWizardOpen) renderSetupWizard();
  });
  safe('connections manager', ()=> renderConnectionsPage());

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
    renderKpiCharts(viewPeriod, isLive, { allMonths: allMonthsView });
    const subtitles = {spend:'total this month', reach:'unique people', impr:'times shown',
      clicks:'link clicks', ctr:'link clicks ÷ impressions', cpm:'spend per 1,000 impressions', cpc:'spend per link click',
      freq:'average views per person', page_engagement:'interactions this month', lpv:'landing page views',
      page_likes:'new page likes', foll:'new followers'};
    const rangeSubs = {spend:'cumulative total', reach:'cumulative reach', impr:'cumulative impressions',
      clicks:'cumulative link clicks', ctr:'range average', cpm:'range average', cpc:'range average',
      freq:'range average', page_engagement:'cumulative total', lpv:'cumulative total',
      page_likes:'cumulative total', foll:'cumulative total'};
    const trendVs = prev ? periodLabel(prev.period) : '';
    const trend = (cur, before, opts={})=>{
      if(before==null || cur==null || !isFinite(+before) || !isFinite(+cur) || +before===0) return '';
      const pct = (cur-before)/Math.abs(before)*100;
      if(Math.abs(pct)<0.5) return `<div class="trend flat">±0% vs ${esc(trendVs)}</div>`;
      const up = pct>0, good = opts.lowerBetter ? !up : up;
      const sign = up ? '+' : '-';
      return `<div class="trend ${good?'up':'down'}">${up?'▲':'▼'} ${sign}${Math.abs(pct).toFixed(1)}% vs ${esc(trendVs)}</div>`;
    };
    const cardNote = allMonthsView
      ? (rangeSummary?.monthCount ? `cumulative · ${rangeSummary.monthCount} months` : '')
      : (latest ? monthNote(latest.period, isLive) : '');
    const metricRow = allMonthsView ? rangeSummary?.totals : latest;
    const trendRow = allMonthsView ? null : latest;
    const trendPrev = allMonthsView ? null : prev;
    // Prefs-driven card row: the user's chosen metrics (or the default set),
    // in their order, with their custom labels. Cards still only render when
    // the metric actually has a value for the selected period.
    const cards = activeKpiCards().map(pref=>{
      const def = metricDef(pref.k); if(!def) return null;
      const v = metricRow ? metricValue(def, metricRow) : null;
      if(v==null || (def.hideIfZero && !v)) return null;
      const bv = trendRow && trendPrev ? metricValue(def, trendPrev) : null;
      const label = (pref.label||'').trim() || def.label;
      const info = METRIC_INFO[def.k]
        ? `<button class="metricinfo" type="button" data-metric="${def.k}" title="What is ${def.label}?" aria-label="What is ${def.label}?">ⓘ</button>` : '';
      const sub = allMonthsView ? (rangeSubs[def.k]||'') : (subtitles[def.k]||'');
      return `<div class="card"><div class="k">${esc(label)}${info}</div><div class="big">${def.fmt(v)}</div>`+
        `<div class="tgt">${sub}</div><div class="mnote g">${cardNote}</div>${allMonthsView ? '' : trend(metricValue(def, trendRow), bv, {lowerBetter:def.lowerBetter})}</div>`;
    }).filter(Boolean);
    if(allMonthsView && rangeSummary?.totals){
      [['cons','Total consults',fmtNum],['proc','Total procedures',fmtNum]].forEach(([k,l,fmt])=>{
        const v = N(rangeSummary.totals,k);
        if(v==null || v===0) return;
        cards.push(`<div class="card"><div class="k">${l}</div><div class="big">${fmt(v)}</div>`+
          `<div class="tgt">cumulative total</div><div class="mnote g">cumulative · ${rangeSummary.monthCount} months</div></div>`);
      });
    }
    $('kpiCards').innerHTML = cards.length ? cards.join('')
      : `<div class="note">${allMonthsView ? 'No ad performance data across any month yet.' : 'No ad performance data for this month yet — it syncs automatically from the reporting sheet.'}</div>`;
    // wire the ⓘ info buttons (client-facing metric explanations, themed popover)
    $('kpiCards').querySelectorAll('.metricinfo').forEach(b=>
      b.onclick = (e)=>{ e.stopPropagation(); openMetricInfo(b.dataset.metric); });

    // customize entry point (choose / rename / reorder KPI cards)
    const custBtn = $('kpiCustomizeBtn');
    if(custBtn) custBtn.onclick = openKpiPrefsEditor;

    // secondary: optional ad metrics, shown only when present AND not already
    // promoted to a card by the user's dashboard prefs (no double display).
    const promoted = new Set(activeKpiCards().map(c=> c.k));
    const optionalSource = allMonthsView ? rangeSummary?.totals : latest;
    const rows = (optionalSource ? OPTIONAL_METRICS : []).map(def=>{
      if(promoted.has(def.k)) return null;
      const v = metricValue(def, optionalSource); if(v==null || (def.hideIfZero && !v)) return null;
      return `<div class="srow"><span class="n">${def.label}</span><span class="s g">${def.fmt(v)}</span></div>`;
    }).filter(Boolean);
    $('statusBoard').innerHTML = rows.join('');
    $('statusBoard').style.display = rows.length ? '' : 'none';
  });

  // feed (team can edit/delete each posted update)
  safe('updates feed', ()=> renderUpdates(isTeamView()));
  safe('updates badge', ()=> renderUpdatesBadge());
  safe('connections badge', ()=> renderConnBadge());

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
function buildMetricsPicker(reported, viewPeriod, latestPeriod, emptySelected, allMonthsView){
  const mount = $('metricsPicker');
  if(!mount) return;
  if(!reported.length && !emptySelected){ mount.style.display='none'; return; }
  mount.style.display='';
  const opts = [{ value:ALL_MONTHS, label:'All Months' }]
    .concat(reported.slice().sort((a,b)=> a.period<b.period?1:a.period>b.period?-1:0).map(r=>
      ({ value:r.period, label:`${periodLabel(r.period)}${r.period===latestPeriod?' (latest)':''}` })));
  if(emptySelected) opts.push({ value:viewPeriod, label:`${periodLabel(viewPeriod)} (no data yet)` });
  const cur = getSel();
  const val = allMonthsView ? ALL_MONTHS : (cur!=null ? String(cur) : (latestPeriod ? String(latestPeriod) : ''));
  if(!metricsSelApi || metricsSelApi._mount !== mount){
    metricsSelApi = themedSelect(mount, { options:opts, value:val, placeholder:'Reporting month',
      onChange:(v)=>{ setSel(v===ALL_MONTHS ? ALL_MONTHS : v); render(); } });
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
// Three canonical deliverable states (match the "What do these mean?" guide).
// 'promised' is the historical value for a not-yet-started item; it now reads "Planned".
const STATUS_OPTS = [['promised','Planned'],['in_progress','In progress'],['delivered','Delivered']];
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
// Position a themed dropdown popup with position:fixed so it escapes any
// overflow:hidden ancestor (accordion bodies, cards). Flips up when there isn't
// room below; clamps inside the viewport. Call while the popup is visible.
function positionTselPop(btn, pop){
  pop.style.position='fixed'; pop.style.right='auto'; pop.style.bottom='auto';
  const r = btn.getBoundingClientRect();
  pop.style.minWidth = r.width+'px';
  pop.style.left = r.left+'px';
  pop.style.top = (r.bottom+4)+'px';
  const ph = pop.offsetHeight, pw = pop.offsetWidth;
  let top = r.bottom+4;
  if(top + ph > window.innerHeight-6 && r.top - ph - 4 > 6) top = r.top - ph - 4;  // flip up
  let left = r.left;
  if(left + pw > window.innerWidth-6) left = Math.max(6, window.innerWidth - pw - 6);
  pop.style.top = top+'px'; pop.style.left = left+'px';
}
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
    if(o){ positionTselPop(btn,pop); (pop.querySelector('.tsel-opt.sel')||pop.querySelector('.tsel-opt'))?.focus(); } };
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
  wrap.appendChild(btn); wrap.appendChild(pop);
  const isOpen = ()=> wrap.classList.contains('open');
  const setOpen = o=>{ wrap.classList.toggle('open',o); pop.hidden=!o; btn.setAttribute('aria-expanded',o?'true':'false');
    if(o){ positionTselPop(btn,pop); (pop.querySelector('.tsel-opt.sel')||pop.querySelector('.tsel-opt'))?.focus(); } };
  // expose open/toggle so a wrapping row can act as a bigger click target
  sel._tsel = { wrap, btn, pop, open:()=>setOpen(true), toggle:()=>setOpen(!isOpen()) };
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
  (root||document).querySelectorAll('select.cellinput, select.picker, select#accessPractice, select#accessRole, select.statussel, select.stagesel, select.milesel, select.ops-deliv-status, select.ops-vid-stage').forEach(enhanceNativeSelect);
}
// one global outside-click closer for all enhanced (native-wrapped) dropdowns
document.addEventListener('click', e=>{
  document.querySelectorAll('.tsel-wrap.open').forEach(w=>{ if(!w.contains(e.target)){
    w.classList.remove('open'); const p=w.querySelector('.tsel-pop'); if(p)p.hidden=true; w.querySelector('.tsel-btn')?.setAttribute('aria-expanded','false'); } });
});
// popups are position:fixed, so close any open dropdown on scroll (it would otherwise
// detach from its button). Capture phase catches scrolls in any container.
window.addEventListener('scroll', ()=>{
  document.querySelectorAll('.tsel.open').forEach(w=>{
    w.classList.remove('open'); const p=w.querySelector('.tsel-pop'); if(p)p.hidden=true; w.querySelector('.tsel-btn')?.setAttribute('aria-expanded','false'); });
}, true);

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
function phaseOrderMap(delivs){
  const order = {};
  (delivs || data.deliv || []).forEach(d=>{ if(!(d.phase in order)) order[d.phase] = d.phase_order ?? 999; });
  return order;
}
function comparePhaseNames(a, b, order){
  const na = parsePhaseNum(a), nb = parsePhaseNum(b);
  const oa = order[a] ?? 999, ob = order[b] ?? 999;
  return ((na ?? 9999) - (nb ?? 9999)) || (oa - ob) || a.localeCompare(b);
}
function phaseGroups(){
  // group deliverables by phase — numeric phase first, then phase_order, then label
  const groups = {};
  data.deliv.forEach(d=>{ (groups[d.phase] = groups[d.phase] || []).push(d); });
  const order = phaseOrderMap();
  return Object.keys(groups)
    .sort((a,b)=> comparePhaseNames(a, b, order))
    .map(phase=>({ phase, items: groups[phase].sort((x,y)=>(x.sort||0)-(y.sort||0)) }));
}

let delivCollapsed = new Set();   // phase names the user has collapsed (persists in-session)
function phaseProgress(g){
  const done = g.items.filter(i=> DELIV_DONE(i.status)).length;
  const pct = g.items.length? Math.round(100*done/g.items.length):0;
  return { done, total:g.items.length, pct };
}

function renderDeliverables(isTeam){
  // Same unified "Project Progress" design for both roles — read-only for the
  // client, fully editable for the team (phases, deliverables, milestones, drag-drop).
  if(isTeam) renderTeamProgress();
  else renderClientProgress();
}
/* ===== Unified CLIENT "Project Progress" (Roadmap folded in) =====
   Numbered phase cards (progress bars + %), expandable to reveal deliverables
   with status icons (delivered ✓ / in-progress rotating spinner / planned ○ /
   needs-attention !), a compact milestone timeline, and a "what's next" footer.
   Beautiful + simplified + read-only. Live from deliverables + milestones. */
let ppOpen = null;   // Set of expanded phase names (seeded with the active phase)
const DELIV_DONE = s => s==='delivered';
// Needs-attention is INTERNAL (team/ops only) — never surfaced to clients. It clears
// the moment the item is done, or its due date moves to today/future, so no stale
// flags survive an edit. Compared at day granularity (something due later today ≠ overdue).
function delivAttention(x){
  if(!x || DELIV_DONE(x.status) || !x.due) return false;
  const due = new Date(x.due); due.setHours(23,59,59,999);
  return due.getTime() < Date.now();
}
function delivStatusIcon(status, attn){
  if(attn) return `<span class="pp-ico attn" aria-hidden="true">!</span>`;
  if(DELIV_DONE(status)) return `<span class="pp-ico done" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>`;
  if(status==='in_progress') return `<span class="pp-ico prog" aria-hidden="true"><span class="pp-spin"></span></span>`;
  return `<span class="pp-ico plan" aria-hidden="true"></span>`;
}
function delivStatusMeta(status, attn){
  if(attn) return ['Needs attention','attn'];
  if(status==='delivered') return ['Delivered','done'];
  if(status==='in_progress') return ['In progress','prog'];
  return ['Planned','plan'];
}
function phaseStateOf(g){
  const {done,total} = phaseProgress(g);
  if(total && done===total) return 'complete';
  if(done>0 || g.items.some(i=> i.status==='in_progress')) return 'current';
  return 'planned';
}
/* Compact, themed milestone hero — sits ABOVE the phase cards (both roles). Answers
   at a glance: where you are (current milestone), what's next (the next PHASE step),
   current phase %, and the whole timeline progression. Read-only. */
function ppMilestoneHero(){
  const ds = milestoneDisplayStatusMap();
  const miles = sortedMilestones();
  const groups = phaseGroups();
  const curPhase = groups.find(g=> phaseStateOf(g)==='current')
    || groups.find(g=> phaseStateOf(g)==='planned') || groups[groups.length-1];
  const curPct = curPhase ? phaseProgress(curPhase).pct : 0;
  const current = miles.find(m=> ds.get(m.id)==='current');
  // What's next = the next PHASE to begin (the actual next step of work).
  const nextPhase = groups.find(g=> phaseStateOf(g)==='planned');
  const allComplete = groups.length && groups.every(g=> phaseStateOf(g)==='complete');
  const nextLabel = nextPhase ? nextPhase.phase
    : allComplete ? 'All phases complete'
    : curPhase ? curPhase.phase : '—';
  const cards = `<div class="pp-hero-row">
    <div class="pp-hero-card"><span class="pp-hero-k">Where you are</span><span class="pp-hero-v">${current?esc(current.name):(curPhase?esc(curPhase.phase):'Kicking off')}</span></div>
    <div class="pp-hero-card"><span class="pp-hero-k">What's next</span><span class="pp-hero-v">${esc(nextLabel)}</span></div>
    <div class="pp-hero-card"><span class="pp-hero-k">${curPhase?esc(curPhase.phase):'Current phase'}</span><span class="pp-hero-v gold">${curPct}%<span class="pp-hero-sub">complete</span></span></div>
  </div>`;
  const tl = miles.length ? `<div class="pp-tl">${miles.map(m=>{
    const st = ds.get(m.id) || m.status;
    const tag = st==='done'?'Complete':st==='current'?'You are here':'Up next';
    return `<div class="pp-step ${st}"><span class="pp-step-dot"></span><div class="pp-step-name">${esc(m.name)}</div><div class="pp-step-tag">${tag}</div></div>`;
  }).join('')}</div>` : '';
  return `<div class="pp-hero">${cards}${tl}</div>`;
}
function ppPhaseCard(g, idx, open){
  const {done,total,pct} = phaseProgress(g);
  const state = phaseStateOf(g);
  const pill = state==='complete' ? 'Complete' : state==='current' ? 'In progress' : 'Planned';
  // Client view is read-only and INTERNAL-signal-free: no needs-attention, no overdue.
  const rows = g.items.map(x=>{
    const [lbl,cls] = delivStatusMeta(x.status, false);
    return `<div class="pp-item ${cls}">
      <span class="pp-item-l">${delivStatusIcon(x.status, false)}<span class="pp-item-name">${esc(x.name)}</span></span>
      <span class="pp-item-stat ${cls}">${lbl}</span>
    </div>`;
  }).join('') || `<div class="pp-item plan"><span class="pp-item-l"><span class="pp-ico plan"></span><span class="pp-item-name note">No deliverables in this phase yet.</span></span></div>`;
  return `<div class="pp-phase state-${state}${open?'':' collapsed'}" data-phase="${esc(g.phase)}">
    <button class="pp-phase-head" type="button" data-phase="${esc(g.phase)}" aria-expanded="${open?'true':'false'}">
      <span class="pp-badge">${idx+1}</span>
      <span class="pp-phase-name">${esc(g.phase)}</span>
      <span class="pp-phase-pill ${state}">${pill}</span>
      <span class="pp-phase-right"><span class="pp-phase-pct">${pct}%</span><span class="pp-phase-count">${done}/${total} done</span></span>
      <span class="pp-caret" aria-hidden="true">▾</span>
    </button>
    <div class="pp-bar"><div class="pp-bar-fill" style="width:${pct}%"></div></div>
    <div class="pp-body"><div class="pp-body-inner">${rows}</div></div>
  </div>`;
}
function renderClientProgress(){
  const t = $('delivTable'); if(!t) return;
  const groups = phaseGroups();
  document.querySelector('section[data-view="deliverables"] .progressbar')?.classList.add('hidden');
  if(ppOpen===null){
    ppOpen = new Set();
    const cur = groups.find(g=> phaseStateOf(g)==='current');
    if(cur) ppOpen.add(cur.phase);
  }
  const cards = groups.map((g,idx)=> ppPhaseCard(g, idx, ppOpen.has(g.phase))).join('')
    || `<p class="note">Your project phases appear here at kickoff.</p>`;
  t.innerHTML = `${ppMilestoneHero()}<div class="pp">${cards}</div>`;
  t.querySelectorAll('.pp-phase-head').forEach(h=> h.addEventListener('click', ()=>{
    const phase = h.dataset.phase, card = h.closest('.pp-phase');
    if(ppOpen.has(phase)) ppOpen.delete(phase); else ppOpen.add(phase);
    const open = ppOpen.has(phase);
    card.classList.toggle('collapsed', !open);
    h.setAttribute('aria-expanded', open?'true':'false');
  }));
}
/* ===== TEAM "Project Progress" — SAME design as the client, fully editable =====
   Identical pp-phase cards + accordion + status icons, but every field is live-
   editable: rename/delete/drag phases, edit/move/reorder/delete deliverables,
   change status (themed dropdown), dates, client explanation (ⓘ), plus a folded-in
   editable Milestones section (add / edit / drag-reorder) and the What's-next foot. */
function renderTeamProgress(){
  const t = $('delivTable'); if(!t) return;
  const groups = phaseGroups();
  document.querySelector('section[data-view="deliverables"] .progressbar')?.classList.add('hidden');
  if(ppOpen===null){
    ppOpen = new Set();
    const cur = groups.find(g=> phaseStateOf(g)==='current');
    ppOpen.add(cur ? cur.phase : (groups[0] && groups[0].phase));
  }
  const cards = groups.map((g,idx)=>{
    const {done,total,pct} = phaseProgress(g);
    const state = phaseStateOf(g);
    const pill = state==='complete' ? 'Complete' : state==='current' ? 'In progress' : 'Planned';
    const open = ppOpen.has(g.phase);
    const rows = g.items.map(x=>{
      const attn = delivAttention(x);
      const [,cls] = delivStatusMeta(x.status, attn);
      const sla = slaState(x.status_since, x.status==='delivered');
      const ageChip = sla ? `<span class="agechip ${sla}" title="${daysIn(x.status_since)} days in this status">${daysIn(x.status_since)}d</span>` : '';
      return `<div class="pp-item pp-item-edit ${cls} taskrow" draggable="true" data-id="${x.id}" data-phase="${esc(g.phase)}">
        <span class="pp-item-l">
          <span class="pp-drag" title="Drag to reorder">⋮⋮</span>
          ${delivStatusIcon(x.status, attn)}
          <input class="pp-name-input cellinput" data-f="name" value="${esc(x.name)}">
        </span>
        <span class="pp-item-r">
          <input class="pp-owner-input cellinput" data-f="owner_seat" value="${esc(x.owner_seat||'')}" placeholder="—" title="Owner seat">
          <input class="pp-due-input cellinput" type="date" data-f="due" value="${x.due ? String(x.due).slice(0,10) : ''}" title="Due date">
          ${ageChip}
          <button class="pp-info infobtn${x.description?' has':''}" data-info-edit="${x.id}" title="Edit client explanation">ⓘ</button>
          ${statusSelect('deliv', x.status)}
          <button class="pp-del rowdel" title="Delete">✕</button>
        </span>
      </div>`;
    }).join('');
    return `<div class="pp-phase pp-team state-${state}${open?'':' collapsed'}" draggable="true" data-phase="${esc(g.phase)}">
      <div class="pp-phase-head" data-phase="${esc(g.phase)}">
        <span class="pp-grip" title="Drag to reorder phase">⋮⋮</span>
        <span class="pp-badge">${idx+1}</span>
        <input class="pp-phase-name-input phasename" data-phase="${esc(g.phase)}" value="${esc(g.phase)}" title="Rename phase">
        <span class="pp-phase-pill ${state}">${pill}</span>
        <span class="pp-phase-right"><span class="pp-phase-pct">${pct}%</span><span class="pp-phase-count">${done}/${total}</span></span>
        <button class="pp-phase-del phasedel" data-phase="${esc(g.phase)}" title="Delete phase">✕</button>
        <button class="pp-caret-btn" type="button" data-phase="${esc(g.phase)}" aria-expanded="${open?'true':'false'}"><span class="pp-caret" aria-hidden="true">▾</span></button>
      </div>
      <div class="pp-bar"><div class="pp-bar-fill" style="width:${pct}%"></div></div>
      <div class="pp-body"><div class="pp-body-inner">${rows}
        <button class="pp-add adddeliv" data-phase="${esc(g.phase)}" type="button">+ Add deliverable</button>
      </div></div>
    </div>`;
  }).join('') || `<p class="note">No phases yet — add the first one below.</p>`;

  const newphase = `<div class="pp-newphase"><input id="ndPhase" class="cellinput" placeholder="New phase name…"><button class="btn sm" id="ndAddPhase" type="button">+ Add phase</button></div>`;

  // folded-in editable Milestones section
  const ds = milestoneDisplayStatusMap();
  const miles = sortedMilestones();
  const mileRows = miles.map(m=>{
    const st = ds.get(m.id) || m.status;
    const tag = st==='done'?'Complete':st==='current'?'You are here':'Up next';
    const dates = m.target_date ? ` · ${prettyDate(m.target_date,'month')}` : '';
    return `<div class="pp-mile pp-item msrow" draggable="true" data-id="${m.id}">
      <span class="pp-item-l"><span class="pp-drag" title="Drag to reorder">⋮⋮</span>${mileStatusIcon(st)}<span class="pp-mile-name">${esc(m.name)}</span></span>
      <span class="pp-item-r"><span class="pp-mile-tag ${st}">${tag}${dates}</span><button class="btn ghost xs pp-mile-edit" type="button">Edit</button></span>
    </div>`;
  }).join('') || `<p class="note">No milestones yet — add the first one.</p>`;
  const mileSec = `<div class="pp-mile-sec">
    <div class="pp-mile-head"><span class="pp-mile-title">Milestones</span><button class="btn ghost sm" id="ppAddMile" type="button">+ Add milestone</button></div>
    <div class="pp-mile-list">${mileRows}</div>
  </div>`;

  // Order (matches the IA): timeline hero → editable milestones → deliverables by phase → what's next.
  const delivHead = `<div class="pp-sec-head">Deliverables by phase</div>`;
  t.innerHTML = `${ppMilestoneHero()}${mileSec}${delivHead}<div class="pp pp-editable" id="phaseWrap">${cards}</div>${newphase}`;
  enhanceSelectsIn(t);   // themed status dropdowns on every row
  wireTeamProgress(t);
}
function mileStatusIcon(st){
  if(st==='done') return delivStatusIcon('delivered', false);
  if(st==='current') return delivStatusIcon('in_progress', false);
  return delivStatusIcon('promised', false);
}
function wireTeamProgress(t){
  // accordion: click the head (never an input/select/button) or the caret toggles
  const toggle = (phase, card, head)=>{
    if(ppOpen.has(phase)) ppOpen.delete(phase); else ppOpen.add(phase);
    const open = ppOpen.has(phase);
    card.classList.toggle('collapsed', !open);
    head.setAttribute('aria-expanded', open?'true':'false');
    card.querySelector('.pp-caret-btn')?.setAttribute('aria-expanded', open?'true':'false');
  };
  t.querySelectorAll('.pp-team').forEach(card=>{
    const phase = card.dataset.phase, head = card.querySelector('.pp-phase-head');
    head.addEventListener('click', e=>{
      if(e.target.closest('input,select,textarea,button,.tsel-wrap')) return;
      toggle(phase, card, head);
    });
    card.querySelector('.pp-caret-btn')?.addEventListener('click', e=>{ e.stopPropagation(); toggle(phase, card, head); });
  });
  // inline edits on each deliverable row
  t.querySelectorAll('.taskrow[data-id]').forEach(row=>{
    const id = row.dataset.id;
    row.addEventListener('dblclick', e=>{ if(e.target.closest('input,select,textarea,button,.tsel-wrap')) return; openDeliverableEditor(id); });
    // Click anywhere on the row (not an editable field, drag grip, ⓘ, ✕, or the
    // dropdown itself) opens the status dropdown — a much larger target than the pill.
    row.addEventListener('click', e=>{
      if(e.detail>1) return;   // the 2nd click of a dbl-click → let the editor handle it
      if(e.target.closest('input,textarea,button,.tsel-wrap,.pp-drag')) return;
      const sel = row.querySelector('select.statussel');
      if(sel && sel._tsel){ e.stopPropagation(); sel._tsel.toggle(); }
    });
    row.querySelectorAll('.cellinput').forEach(inp=> inp.onchange = ()=>{
      let val = inp.value.trim();
      if(inp.type === 'date') val = val || null;
      updateRow('deliverables', id, { [inp.dataset.f]: val || null });
    });
    const ssel = row.querySelector('select');
    if(ssel) ssel.onchange = ()=> updateDeliverableStatus(id, ssel.value);
    row.querySelector('.rowdel').onclick = ()=> deleteRow('deliverables', id, 'Delete this deliverable?');
    const info = row.querySelector('.infobtn[data-info-edit]');
    if(info) info.onclick = ()=> editDeliverableInfo(id);
  });
  // rename / delete a whole phase
  t.querySelectorAll('.phasename').forEach(inp=> inp.onchange = async ()=>{
    const oldName = inp.dataset.phase, newName = inp.value.trim();
    if(!newName || newName===oldName) return;
    await sb.from('deliverables').update({ phase:newName }).eq('practice_id',practiceId).eq('phase',oldName);
    loadAll();
  });
  t.querySelectorAll('.phasedel').forEach(b=> b.onclick = async e=>{
    e.stopPropagation();
    const phase = b.dataset.phase;
    if(!await uiConfirm(`Delete the "${phase}" phase?`, 'This removes the phase and <b>all</b> of its deliverables.', {danger:true})) return;
    const { error } = await sb.from('deliverables').delete().eq('practice_id',practiceId).eq('phase',phase);
    if(error){ uiAlert('Delete failed', esc(error.message)); return; }
    loadAll();
  });
  t.querySelectorAll('.adddeliv').forEach(b=> b.onclick = ()=> addDeliverableTo(b.dataset.phase));
  const addPhaseBtn = t.querySelector('#ndAddPhase'); if(addPhaseBtn) addPhaseBtn.onclick = addPhase;

  // drag phase CARDS to reorder
  t.querySelectorAll('.pp-phase[draggable]').forEach(card=>{
    card.addEventListener('dragstart', e=>{ if(e.target.closest('.taskrow')) return; e.stopPropagation(); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain','phase:'+card.dataset.phase); card.classList.add('dragging'); });
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
  t.querySelectorAll('.taskrow[draggable]').forEach(row=>{
    row.addEventListener('dragstart', e=>{ e.stopPropagation(); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain','task:'+row.dataset.id); row.classList.add('dragging'); });
    row.addEventListener('dragend', ()=> row.classList.remove('dragging'));
    row.addEventListener('dragover', e=>{ e.preventDefault(); e.stopPropagation(); row.classList.add('taskover'); });
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
  // milestones: add / edit / drag-reorder
  const addMileBtn = t.querySelector('#ppAddMile'); if(addMileBtn) addMileBtn.onclick = ()=> addMilestone();
  t.querySelectorAll('.msrow[draggable]').forEach(row=>{
    const id = row.dataset.id;
    row.addEventListener('dblclick', e=>{ if(e.target.closest('button')) return; openMilestoneEditor(id); });
    row.querySelector('.pp-mile-edit')?.addEventListener('click', e=>{ e.stopPropagation(); openMilestoneEditor(id); });
    row.addEventListener('dragstart', e=>{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', id); row.classList.add('dragging'); });
    row.addEventListener('dragend', ()=> row.classList.remove('dragging'));
    row.addEventListener('dragover', e=>{ e.preventDefault(); row.classList.add('over'); });
    row.addEventListener('dragleave', ()=> row.classList.remove('over'));
    row.addEventListener('drop', async e=>{
      e.preventDefault(); row.classList.remove('over');
      const from = e.dataTransfer.getData('text/plain');
      if(from && from!==id) await reorderMilestones(from, id);
    });
  });
}
async function addMilestone(){
  const name = await uiPrompt('New milestone', 'Add a milestone to the roadmap.', '', 'Milestone name'); if(name===null) return;
  if(!name.trim()){ flash('Enter a name.'); return; }
  const sort = (Math.max(0,...data.miles.map(m=>m.sort||0)))+1;
  const { error } = await sb.from('milestones').insert({ practice_id:practiceId, name:name.trim(), status:'upcoming', phase:MILE_PHASE_DEFAULT, sort });
  flash(error? error.message : 'Milestone added.'); if(!error) loadAll();
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
    // Double-click the row (not an inline field) → full themed deliverable editor.
    row.addEventListener('dblclick', e=>{ if(e.target.closest('input,select,textarea,button,.tsel-wrap')) return; openDeliverableEditor(id); });
    row.querySelectorAll('.cellinput').forEach(inp=>{
      inp.onchange = ()=>{
        let val = inp.value.trim();
        if(inp.type === 'date') val = val || null;
        updateRow('deliverables', id, { [inp.dataset.f]: val || null });
      };
    });
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
  // In-app notification for every delivered item; email ONLY when the whole phase completes.
  if(status==='delivered' && prev && prev.status!=='delivered'){
    await notifyClient('deliverable', `Deliverable completed: ${prev.name}.`, { email:false });
    const inPhase = data.deliv.filter(d=> (d.phase||'')===(prev.phase||''));
    if(inPhase.length && inPhase.every(d=> d.id===id || d.status==='delivered')){
      await notifyClient('deliverable', `Phase "${prev.phase}" is complete — every deliverable in it has shipped.`, { email:true });
    }
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
    if(miles[i].status_manual) continue;
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
function stageSelect(cur){
  return `<select class="stagesel">`+STAGES.map(([v,l])=>`<option value="${v}" ${v===cur?'selected':''}>${l}</option>`).join('')+`</select>`;
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

/* Redesigned Video Pipeline — collapsible stage groups (accordion, same language as
   Project Progress) + a filter chip row, instead of long kanban columns. Scales to
   hundreds of videos. Team keeps ALL editing (drag between stages, themed stage
   dropdown, add/delete, full detail modal); client sees a clean read-only view. */
const SHOW_VIDEO_PERF = false;   // Video Performance parked — flip on later (see videoPerfCell)
// Display stage model — cleaner than the raw DB stages: pre_production+shot fold into
// "Shooting"; delivered+posted fold into "Delivered" (a posted video is just a delivered
// one with a link, so there's no separate Posted section). DB stage values are never
// changed by this — it only governs grouping, labels, and what the stage picker offers.
const VIDEO_STAGES = [
  { key:'planned',   label:'Planned',   tone:'plan',  set:'planned'   },
  { key:'scheduled', label:'Scheduled', tone:'sched', set:'scheduled' },
  { key:'shooting',  label:'Shooting',  tone:'prog',  set:'shot'      },
  { key:'editing',   label:'Editing',   tone:'prog',  set:'editing'   },
  { key:'delivered', label:'Delivered', tone:'done',  set:'delivered' },
];
const STAGE_GROUP = { planned:'planned', scheduled:'scheduled', pre_production:'shooting', shot:'shooting', editing:'editing', delivered:'delivered', posted:'delivered' };
const stageGroupOf = s => STAGE_GROUP[s] || 'planned';
const vStage = key => VIDEO_STAGES.find(s=> s.key===key) || VIDEO_STAGES[0];
const stageTone = dbStage => vStage(stageGroupOf(dbStage)).tone;   // tone from a RAW db stage
const STAGE_ICON = {
  all:       '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  planned:   '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  scheduled: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v2.5l1.5 1"/>',
  shooting:  '<polygon points="6 4 20 12 6 20 6 4"/>',
  editing:   '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
  delivered: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
};
function stageIconSvg(key){ return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${STAGE_ICON[key]||''}</svg>`; }
// Stage picker offers the five display stages; values are the canonical DB stage each
// group writes back (Shooting → 'shot', Delivered → 'delivered').
function videoStageSelect(v){
  const cur = vStage(stageGroupOf(v.stage)).set;
  return `<select class="stagesel">`+VIDEO_STAGES.map(s=>`<option value="${s.set}" ${s.set===cur?'selected':''}>${s.label}</option>`).join('')+`</select>`;
}
// Parked: video performance cell. Returns markup only when SHOW_VIDEO_PERF is on, so
// the feature can be reinstated in one place without touching the row layout.
function videoPerfCell(v){ if(!SHOW_VIDEO_PERF) return ''; return `<span class="vp-perf">${esc(String(v.perf??''))}</span>`; }
function copyText(text, okMsg){
  if(!text) return;
  const ok = ()=> flash(okMsg||'Link copied.');
  if(navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, ()=> flash('Copy failed.'));
  else ok();
}
let vpFilter = 'all';   // active stage filter chip
let vpOpen = null;      // Set of expanded stage keys (session)

function videoRow(v, isTeam){
  const isFinal = stageGroupOf(v.stage)==='delivered';
  const sla = slaState(v.stage_since, isFinal);           // team-only age colour
  const dateStr = v.stage_since ? fmtDate(v.stage_since) : '';
  // Any video that has a finished link shows watch / download / copy — no separate
  // Posted section; a posted video is just a delivered one with a link.
  const actions = v.video_url ? `
      <a class="vp-act" href="${esc(v.video_url)}" target="_blank" rel="noopener" title="Watch video">▶</a>
      <a class="vp-act" href="${esc(v.video_url)}" download target="_blank" rel="noopener" title="Download">⤓</a>
      <button class="vp-act vp-copy" type="button" data-url="${esc(v.video_url)}" title="Copy link">⧉</button>` : '';
  if(isTeam){
    const ageChip = sla ? `<span class="agechip ${sla}" title="${daysIn(v.stage_since)} days in this stage">${daysIn(v.stage_since)}d</span>` : '';
    const flag = v.blocked ? `<span class="vp-flag" title="${esc(v.blocked_reason||'Waiting on practice')}">⚑</span>` : '';
    const owner = v.owner_seat ? `<span class="vp-owner" title="Assignee">${esc(v.owner_seat)}</span>` : '';
    const nComments = (data.vcomments||[]).filter(c=> c.video_id===v.id).length;
    const commentChip = nComments ? `<span class="vp-cc" title="${nComments} internal comment${nComments===1?'':'s'}">💬 ${nComments}</span>` : '';
    return `<div class="vp-item vp-item-edit ${v.blocked?'blocked':''} ${sla}" draggable="true" data-vid="${v.id}">
      <span class="vp-item-l">
        <span class="pp-drag" title="Drag to another stage">⋮⋮</span>
        <span class="vp-dot ${stageTone(v.stage)}"></span>
        <span class="vp-name"${v.description?` title="${esc(v.description)}"`:''}>${esc(v.item)}</span>
        ${flag}${owner}
      </span>
      <span class="vp-item-r">
        ${commentChip}
        ${dateStr?`<span class="vp-date">${esc(dateStr)}</span>`:''}
        ${ageChip}${videoPerfCell(v)}${actions}
        <button class="vp-info" type="button" data-open="${v.id}" title="Open details">ⓘ</button>
        ${videoStageSelect(v)}
        <button class="vp-del" type="button" data-del="${v.id}" title="Delete">✕</button>
      </span>
    </div>`;
  }
  // Client: read-only, simplified — no team SLA/age, no internal controls.
  const flag = v.blocked ? `<span class="vp-flag client" title="We need something from you to continue">⚑ Needs your input</span>` : '';
  return `<div class="vp-item" data-vid="${v.id}">
    <span class="vp-item-l"><span class="vp-dot ${stageTone(v.stage)}"></span><span class="vp-name">${esc(v.item)}</span>${flag}</span>
    <span class="vp-item-r">${dateStr?`<span class="vp-date">${esc(dateStr)}</span>`:''}${actions}</span>
  </div>`;
}

function renderPipeline(isTeam){
  const wrap = $('pipeline'); if(!wrap) return;
  const vids = data.video || [];
  const counts = {}; VIDEO_STAGES.forEach(s=> counts[s.key] = vids.filter(v=> stageGroupOf(v.stage)===s.key).length);

  // Icon summary cards — the at-a-glance band that also filters. "All" (total) is
  // the default landing view; clicking a stage focuses it, clicking All resets.
  const summaryCard = (key, label, count, on, tone)=>`<button class="vp-card${tone?' stage-'+tone:' vp-card-all'}${on?' on':''}" type="button" data-f="${key}">
      <span class="vp-card-top"><span class="vp-card-ico">${stageIconSvg(key)}</span><span class="vp-card-n">${count}</span></span>
      <span class="vp-card-l">${label}</span></button>`;
  const cards = `<div class="vp-summary">
    ${summaryCard('all','All', vids.length, vpFilter==='all', null)}
    ${VIDEO_STAGES.map(s=> summaryCard(s.key, s.label, counts[s.key], vpFilter===s.key, s.tone)).join('')}
  </div>`;

  if(vpOpen===null){ vpOpen = new Set(); VIDEO_STAGES.forEach(s=>{ if(counts[s.key]>0 && counts[s.key]<=6) vpOpen.add(s.key); }); }

  // Empty groups are hidden (unless that group is the active filter, so the team can
  // still add into an empty stage).
  const shown = VIDEO_STAGES.filter(s=> vpFilter==='all' ? counts[s.key]>0 : s.key===vpFilter);
  const groups = shown.map(s=>{
    const items = vids.filter(v=> stageGroupOf(v.stage)===s.key);
    const open = (vpFilter!=='all') || vpOpen.has(s.key);
    const rows = items.map(v=> videoRow(v, isTeam)).join('')
      || `<div class="vp-empty note">No videos in this stage${isTeam?' yet.':'.'}</div>`;
    const addBtn = isTeam ? `<button class="vp-add" type="button" data-addstage="${s.set}">+ Add video</button>` : '';
    return `<div class="vp-stage stage-${s.tone}${open?'':' collapsed'}${isTeam?' dropstage':''}" data-stage="${s.set}">
      <button class="vp-stage-head" type="button" data-group="${s.key}" aria-expanded="${open?'true':'false'}">
        <span class="vp-dot ${s.tone}"></span>
        <span class="vp-stage-name">${s.label}</span>
        <span class="vp-stage-n">${items.length}</span>
        <span class="vp-caret" aria-hidden="true">▾</span>
      </button>
      <div class="vp-body"><div class="vp-body-inner"><div class="vp-body-pad">${rows}${addBtn}</div></div></div>
    </div>`;
  }).join('') || `<p class="note">${vpFilter==='all'?'No video assets yet.':'No videos in this stage.'}</p>`;

  wrap.innerHTML = `${cards}<div class="vp">${groups}</div>`;
  if(isTeam) enhanceSelectsIn(wrap);   // themed stage dropdowns (fixed-positioned, no clipping)
  wirePipeline(wrap, isTeam);
}

function wirePipeline(wrap, isTeam){
  // summary cards act as stage filters (toggle); Clear filter resets
  wrap.querySelectorAll('.vp-card').forEach(b=> b.addEventListener('click', ()=>{ vpFilter = (vpFilter===b.dataset.f ? 'all' : b.dataset.f); renderPipeline(isTeam); }));
  wrap.querySelectorAll('.vp-clear').forEach(b=> b.addEventListener('click', ()=>{ vpFilter = 'all'; renderPipeline(isTeam); }));
  // accordion toggle (keyed by display group)
  wrap.querySelectorAll('.vp-stage-head').forEach(h=> h.addEventListener('click', ()=>{
    const key = h.dataset.group, card = h.closest('.vp-stage');
    if(vpOpen.has(key)) vpOpen.delete(key); else vpOpen.add(key);
    const open = vpOpen.has(key); card.classList.toggle('collapsed', !open); h.setAttribute('aria-expanded', open?'true':'false');
  }));
  // click a row (not an action/control) → full detail modal (client + team)
  wrap.querySelectorAll('.vp-item[data-vid]').forEach(row=>{
    row.addEventListener('click', e=>{
      if(_vDragged) return;
      if(e.target.closest('.vp-act,.vp-del,.vp-info,.vp-copy,.tsel-wrap,select,.pp-drag')) return;
      openVideoDetail(row.dataset.vid);
    });
  });
  wrap.querySelectorAll('.vp-copy').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); copyText(b.dataset.url); }));
  wrap.querySelectorAll('.vp-info').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); openVideoDetail(b.dataset.open); }));
  if(!isTeam) return;   // everything below is team editing

  // quick stage change via the themed dropdown
  wrap.querySelectorAll('.vp-item .stagesel').forEach(sel=>{
    const row = sel.closest('[data-vid]'); const id = row.dataset.vid;
    sel.onchange = ()=>{ const v = data.video.find(x=>x.id===id); if(v && v.stage!==sel.value) updateRow('video_pipeline', id, { stage:sel.value }); };
  });
  wrap.querySelectorAll('.vp-del').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); deleteRow('video_pipeline', b.dataset.del, 'Delete this video asset and its history?'); }));
  wrap.querySelectorAll('.vp-add').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); addVideoTo(b.dataset.addstage); }));
  // drag a video row onto another stage group to move it
  wrap.querySelectorAll('.vp-item[draggable]').forEach(row=>{
    row.addEventListener('dragstart', e=>{ _vDragged=true; e.dataTransfer.setData('text/plain', row.dataset.vid); e.dataTransfer.effectAllowed='move'; row.classList.add('dragging'); });
    row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); setTimeout(()=>{ _vDragged=false; }, 60); });
  });
  wrap.querySelectorAll('.vp-stage.dropstage').forEach(st=>{
    st.addEventListener('dragover', e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; st.classList.add('over'); });
    st.addEventListener('dragleave', e=>{ if(!st.contains(e.relatedTarget)) st.classList.remove('over'); });
    st.addEventListener('drop', async e=>{
      e.preventDefault(); st.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain'); if(!id) return;
      const v = data.video.find(x=>x.id===id); const newStage = st.dataset.stage;
      if(v && v.stage!==newStage) await updateRow('video_pipeline', id, { stage:newStage });
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
             <a class="btn ghost" href="${esc(v.video_url)}" download target="_blank" rel="noopener">⤓ Download</a>
             <button class="btn ghost" id="mCopy" type="button">⧉ Copy link</button>`
          : '<span class="note">Video not posted yet.</span>'}
      </div></div>`;
    mc.classList.add('open');
    $('mClose').onclick = closeModal;
    $('mCopy') && ($('mCopy').onclick = ()=> copyText(v.video_url));
    mc.onclick = e=>{ if(e.target===mc) closeModal(); };
    return;
  }

  const histRows = hist.length? hist.map(h=>
    `<div class="histrow"><span class="hstage">${stageLabel(h.stage)}</span><span class="hdate">${fmtHistTime(h.moved_at)}</span><button class="histdel" data-hid="${h.id}" title="Delete">✕</button></div>`).join('')
    : '<div class="note">No history yet.</div>';

  // Internal comment thread (team-only). Never shown to clients.
  const comments = (data.vcomments||[]).filter(c=> c.video_id===id).sort((a,b)=> new Date(a.created_at)-new Date(b.created_at));
  const commentRows = comments.length ? comments.map(c=>
    `<div class="vc-row" data-cid="${c.id}">
      <div class="vc-head"><span class="vc-author">${esc(c.author_name||'Team')}</span><span class="vc-date">${fmtHistTime(c.created_at)}</span><button class="vc-del" data-cid="${c.id}" title="Delete comment">✕</button></div>
      <div class="vc-body">${esc(c.body)}</div></div>`).join('')
    : '<div class="note">No comments yet — start the thread below.</div>';

  const m = $('modal');
  m.innerHTML = `<div class="modalcard">
    <div class="modalhead"><h3 style="margin:0">${esc(v.item)}</h3><button class="modalx" id="mClose">✕</button></div>
    <div class="modalbody">
      <label class="mlabel">Asset name</label>
      <input class="cellinput mfield" id="mName" value="${esc(v.item)}">

      <label class="mlabel">Description (what this asset is — shown on hover)</label>
      <textarea class="cellinput mfield mtextarea" id="mDesc" rows="2" placeholder="e.g. 3-min educational video on facelift recovery timeline">${esc(v.description||'')}</textarea>

      <div class="mform-row">
        <div><label class="mlabel">Assignee (owner seat)</label><input class="cellinput mfield" id="mOwner" value="${esc(v.owner_seat||'')}" placeholder="e.g. AL"></div>
        <div><label class="mlabel">Current stage</label><div class="mstage">${stageLabel(v.stage)} · ${daysIn(v.stage_since)}d in stage</div></div>
      </div>

      <label class="mlabel">Date entered ${stageLabel(v.stage)} (auto-set on move — edit to schedule ahead or correct)</label>
      <input type="date" class="dateedit mfield" id="mStageDate" value="${(v.stage_since||'').slice(0,10)}">

      <label class="mlabel">Blocked reason (blank = not blocked)</label>
      <input class="cellinput mfield" id="mBlock" value="${esc(v.blocked_reason||'')}" placeholder="e.g. Awaiting surgeon approval">

      <label class="mlabel">Finished video link (shown to client when posted)</label>
      <input class="cellinput mfield" id="mUrl" value="${esc(v.video_url||'')}" placeholder="https://…">

      <label class="mlabel">Stage history</label>
      <div class="histbox">${histRows}</div>

      <label class="mlabel">Internal comments <span class="note">(team-only — never shown to the client)</span></label>
      <div class="vc-list">${commentRows}</div>
      <div class="vc-add">
        <textarea class="cellinput mfield mtextarea" id="mComment" rows="2" placeholder="Add an internal note…"></textarea>
        <button class="btn sm" id="mAddComment" type="button">Post comment</button>
      </div>
    </div>
    <div class="modalfoot">
      <button class="btn" id="mSave">Save changes</button>
      <button class="btn" id="mPost">Post video &amp; email client</button>
      ${v.video_url? `<a class="btn ghost" href="${esc(v.video_url)}" target="_blank" rel="noopener">▶ Watch</a>
        <a class="btn ghost" href="${esc(v.video_url)}" download target="_blank" rel="noopener">⤓ Download</a>
        <button class="btn ghost" id="mCopy" type="button">⧉ Copy link</button>`:''}
      <span id="mMsg" class="note"></span>
    </div></div>`;
  m.classList.add('open');

  $('mClose').onclick = closeModal;
  $('mCopy') && ($('mCopy').onclick = ()=> copyText(v.video_url));
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

  // internal comments: add + delete (team-only; RLS enforces it too)
  $('mAddComment').onclick = async ()=>{
    const body = $('mComment').value.trim(); if(!body){ $('mComment').focus(); return; }
    $('mAddComment').disabled = true;
    const { error } = await sb.from('video_comments').insert({
      video_id: id, practice_id: practiceId, author_id: (me&&me.id)||null,
      author_name: (me && me.full_name) || 'ROXIUM team', body,
    });
    $('mAddComment').disabled = false;
    if(error){ $('mMsg').textContent = /relation .* does not exist/i.test(error.message) ? 'Run the video-comments migration first.' : error.message; return; }
    await loadAll(); openVideoDetail(id);   // reopen so the thread refreshes
  };
  m.querySelectorAll('.vc-del').forEach(b=> b.onclick = async e=>{
    e.stopPropagation();
    if(!await uiConfirm('Delete this comment?', '', { danger:true, confirmLabel:'Delete' })) return;
    const { error } = await sb.from('video_comments').delete().eq('id', b.dataset.cid);
    if(error){ uiAlert('Delete failed', esc(error.message)); return; }
    await loadAll(); openVideoDetail(id);
  });

  $('mSave').onclick = async ()=>{
    const stageDate = $('mStageDate').value; // yyyy-mm-dd or ''
    const patch = {
      item: $('mName').value.trim()||v.item,
      description: $('mDesc').value.trim()||null,
      owner_seat: $('mOwner').value.trim()||null,
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
    // In-app notification is created by the trg_notify_video_stage DB trigger (on the
    // stage → 'posted' change), deduped per video; here we only handle the email.
    await loadAll();
    setTimeout(closeModal, 1400);
  };
}
function closeModal(){ const m=$('modal'); m.classList.remove('open'); m.innerHTML=''; }

/* ---- MILESTONES: client timeline + team editable / draggable list ---- */
const MILE_PHASE_DEFAULT = 'Roadmap';
function sortedMilestones(){ return [...data.miles].sort((a,b)=>(a.sort||0)-(b.sort||0)); }
// Displayed milestone status, normalized by sequence so labels stay monotonic: once a
// later milestone is current/done, every earlier one reads Complete — so a milestone in
// an early slot can never wrongly show "Up next" after the roadmap has moved past it.
function milestoneDisplayStatusMap(){
  const miles = sortedMilestones();
  let frontier = -1;
  miles.forEach((m,i)=>{ if(m.status==='done' || m.status==='current') frontier = i; });
  const map = new Map();
  miles.forEach((m,i)=> map.set(m.id, i < frontier ? 'done' : i === frontier ? m.status : 'upcoming'));
  return map;
}
function milestonePhases(){
  const phases = [];
  const seen = new Set();
  sortedMilestones().forEach(m=>{
    const p = (m.phase||'').trim() || MILE_PHASE_DEFAULT;
    if(!seen.has(p)){ seen.add(p); phases.push(p); }
  });
  return phases.length ? phases : [MILE_PHASE_DEFAULT];
}
function renderTimeline(isTeam){
  const wrap = $('timeline');
  if(!data.miles.length){
    wrap.innerHTML = '<p class="note">Roadmap milestones will appear here at kickoff.</p>';
    return;
  }
  if(isTeam) renderMilestoneTeamList(wrap);
  else renderClientRoadmap(wrap);
}
/* CLIENT roadmap — premium, simplified, confidence-building. Phase progress
   (moving bars + %), the current phase expanded, then a modernized milestone
   timeline (You are here / Up next / Complete). Read-only; editing is the TEAM
   view. All live from milestones + their normalized display status. */
function renderClientRoadmap(wrap){
  wrap.className = 'croad';
  const ds = milestoneDisplayStatusMap();
  const phases = milestonePhases();
  const miles = sortedMilestones();

  const phaseCards = phases.map(phase=>{
    const items = miles.filter(m=> ((m.phase||'').trim() || MILE_PHASE_DEFAULT)===phase);
    const done = items.filter(m=> ds.get(m.id)==='done').length;
    const hasCurrent = items.some(m=> ds.get(m.id)==='current');
    const pct = items.length ? Math.round(100*done/items.length) : 0;
    const state = (items.length && done===items.length) ? 'complete' : (hasCurrent || done>0) ? 'current' : 'planned';
    const pill = state==='complete' ? 'Complete' : state==='current' ? 'In progress' : 'Planned';
    const expand = state==='current' ? `<div class="croad-phase-items">${items.map(m=>{
      const st = ds.get(m.id);
      const tag = st==='done' ? 'Done' : st==='current' ? 'In progress' : 'Up next';
      return `<div class="croad-mi ${st}"><span class="croad-mi-dot"></span><span class="croad-mi-name">${esc(m.name)}</span><span class="croad-mi-tag">${tag}</span></div>`;
    }).join('')}</div>` : '';
    return `<div class="croad-phase state-${state}">
      <div class="croad-phase-top">
        <span class="croad-phase-name">${esc(phase)}</span>
        <span class="croad-phase-pill ${state}">${pill}</span>
        <span class="croad-phase-pct">${pct}%</span>
      </div>
      <div class="croad-bar"><div class="croad-bar-fill" style="width:${pct}%"></div></div>
      ${expand}
    </div>`;
  }).join('');

  const steps = miles.map(m=>{
    const st = ds.get(m.id) || m.status;
    const tag = st==='done' ? 'Complete' : st==='current' ? 'You are here' : 'Up next';
    let date = '';
    if(st==='done'){ const dd = m.completed_on || m.target_date; if(dd) date = `✓ ${prettyDate(dd,'month')}`; }
    else if(m.target_date){ date = `Planned · ${prettyDate(m.target_date,'month')}`; }
    return `<div class="croad-step ${st}">
      <span class="croad-step-dot"></span>
      <div class="croad-step-name">${esc(m.name)}</div>
      <div class="croad-step-tag">${tag}</div>
      ${date ? `<div class="croad-step-date">${esc(date)}</div>` : ''}
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="croad-phases">${phaseCards}</div>
    <div class="croad-tl-wrap">
      <div class="croad-tl-head">Milestone timeline</div>
      <div class="croad-tl">${steps}</div>
    </div>`;
}
function renderMilestoneTeamList(wrap){
  wrap.className = 'mslist';
  const phases = milestonePhases();
  const ds = milestoneDisplayStatusMap();
  wrap.innerHTML = phases.map(phase=>{
    const items = sortedMilestones().filter(m=> ((m.phase||'').trim() || MILE_PHASE_DEFAULT)===phase);
    return `<div class="msphase" data-phase="${esc(phase)}">
      <div class="msphase-head" data-phase="${esc(phase)}" title="Double-click to edit phase"><span class="chanlabel">${esc(phase)}</span><span class="note">${items.length} milestone${items.length===1?'':'s'} · double-click to edit</span></div>
      <div class="msphase-items">${items.map(m=> milestoneTeamRow(m, ds)).join('')}</div>
    </div>`;
  }).join('');
  // Double-click a phase header to edit the phase (rename / renumber).
  wrap.querySelectorAll('.msphase-head[data-phase]').forEach(head=>
    head.addEventListener('dblclick', ()=> openPhaseEditor(head.dataset.phase)));
  wrap.querySelectorAll('.msrow[draggable]').forEach(row=>{
    // Double-click a milestone row to open its full editor.
    row.addEventListener('dblclick', ()=> openMilestoneEditor(row.dataset.id));
    row.addEventListener('dragstart', e=>{
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', row.dataset.id);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', ()=> row.classList.remove('dragging'));
    row.addEventListener('dragover', e=>{ e.preventDefault(); row.classList.add('over'); });
    row.addEventListener('dragleave', ()=> row.classList.remove('over'));
    row.addEventListener('drop', async e=>{
      e.preventDefault(); row.classList.remove('over');
      const from = e.dataTransfer.getData('text/plain');
      if(from && from!==row.dataset.id) await reorderMilestones(from, row.dataset.id);
    });
    row.querySelector('.msedit')?.addEventListener('click', e=>{ e.stopPropagation(); openMilestoneEditor(row.dataset.id); });
  });
}
function milestoneTeamRow(m, ds){
  const st = ds ? (ds.get(m.id) || m.status) : m.status;
  const tag = st==='done'?'Complete':st==='current'?'Current':'Up next';
  const dates = [
    m.target_date ? `Planned ${prettyDate(m.target_date,'month')}` : null,
    m.completed_on ? `Done ${prettyDate(m.completed_on)}` : null,
  ].filter(Boolean).join(' · ');
  const owner = m.owner_seat ? `<span class="msowner">${esc(m.owner_seat)}</span>` : '';
  const prog = m.progress_pct!=null ? `<span class="msprog">${m.progress_pct}%</span>` : '';
  return `<div class="msrow ${st}" draggable="true" data-id="${m.id}" data-milestone="${m.id}">
    <span class="grip" title="Drag to reorder">⋮⋮</span>
    <div class="msrow-main">
      <div class="msrow-title">${esc(m.name)} ${owner} ${prog}</div>
      <div class="msrow-meta">${esc(tag)}${dates? ' · '+esc(dates):''}${m.status_manual?' · manual status':''}</div>
    </div>
    <button type="button" class="btn ghost xs msedit">Edit</button>
  </div>`;
}
async function reorderMilestones(fromId, toId){
  const list = sortedMilestones();
  const fromIdx = list.findIndex(m=> m.id===fromId);
  const toIdx = list.findIndex(m=> m.id===toId);
  if(fromIdx<0 || toIdx<0) return;
  const phase = (list[fromIdx].phase||'').trim() || MILE_PHASE_DEFAULT;
  const phaseItems = list.filter(m=> ((m.phase||'').trim()||MILE_PHASE_DEFAULT)===phase);
  const fLocal = phaseItems.findIndex(m=> m.id===fromId);
  const tLocal = phaseItems.findIndex(m=> m.id===toId);
  if(fLocal<0 || tLocal<0) return;
  const moved = phaseItems.splice(fLocal, 1)[0];
  phaseItems.splice(tLocal, 0, moved);
  for(let i=0;i<phaseItems.length;i++){
    await sb.from('milestones').update({ sort: i+1 }).eq('id', phaseItems[i].id);
  }
  await loadAll();
}
async function logMilestoneHistory(mid, field, oldVal, newVal){
  if(String(oldVal??'')===String(newVal??'')) return;
  try{
    await sb.from('milestone_history').insert({
      milestone_id: mid, practice_id: practiceId, field,
      old_value: oldVal==null ? null : String(oldVal),
      new_value: newVal==null ? null : String(newVal),
      changed_by: me?.id || null,
    });
  }catch(_){ /* table may not exist until migration */ }
}
async function saveMilestonePatch(id, patch, { logFields=true }={}){
  const prev = data.miles.find(m=> m.id===id);
  if(!prev) return { error: 'not found' };
  const { error } = await sb.from('milestones').update(patch).eq('id', id);
  if(!error && logFields){
    for(const [k,v] of Object.entries(patch)){
      if(k==='sort') continue;
      await logMilestoneHistory(id, k, prev[k], v);
    }
  }
  return { error };
}
async function openMilestoneEditor(id){
  const m = data.miles.find(x=> x.id===id);
  if(!m) return;
  let histHtml = '';
  try{
    const { data: hist } = await sb.from('milestone_history')
      .select('*').eq('milestone_id', id).order('changed_at',{ascending:false}).limit(8);
    if(hist?.length){
      histHtml = `<div class="mshist"><div class="chanlabel">Recent changes</div>`+
        hist.map(h=>`<div class="mshist-row"><span>${esc(h.field)}</span><span class="note">${esc(h.old_value||'—')} → ${esc(h.new_value||'—')}</span><span class="note">${new Date(h.changed_at).toLocaleString()}</span></div>`).join('')+
        `</div>`;
    }
  }catch(_){}
  const mileSel = MILE_OPTS.map(([v,l])=>`<option value="${v}"${v===m.status?' selected':''}>${l}</option>`).join('');
  $('modal').innerHTML = `<div class="modalcard modalcard-wide">
    <div class="modalhead"><h3>Edit milestone</h3><button class="modalx" id="mCancelX">✕</button></div>
    <div class="modalbody">
      <label class="mlabel">Title</label><input class="cellinput mfield" id="mName" value="${esc(m.name)}">
      <label class="mlabel">Description</label><textarea class="cellinput mfield mtextarea" id="mDesc" rows="2">${esc(m.detail||'')}</textarea>
      <div class="mform-row">
        <div><label class="mlabel">Phase</label><input class="cellinput mfield" id="mPhase" value="${esc(m.phase||MILE_PHASE_DEFAULT)}"></div>
        <div><label class="mlabel">Owner seat</label><input class="cellinput mfield" id="mOwner" value="${esc(m.owner_seat||'')}" placeholder="AL"></div>
      </div>
      <div class="mform-row">
        <div><label class="mlabel">Planned date</label><input type="date" class="cellinput mfield" id="mTarget" value="${m.target_date||''}"></div>
        <div><label class="mlabel">Completion date</label><input type="date" class="cellinput mfield" id="mDone" value="${m.completed_on||''}"></div>
      </div>
      <div class="mform-row">
        <div><label class="mlabel">Status</label><select class="cellinput mfield" id="mStatus">${mileSel}</select></div>
        <div><label class="mlabel">Progress %</label><input type="number" class="cellinput mfield" id="mProg" min="0" max="100" value="${m.progress_pct??''}" placeholder="0–100"></div>
      </div>
      <label class="mlabel">Link URL</label><input class="cellinput mfield" id="mUrl" value="${esc(m.link_url||'')}" placeholder="https://…">
      <label class="mlabel">Notes</label><textarea class="cellinput mfield mtextarea" id="mNotes" rows="2" placeholder="Internal notes">${esc(m.notes||'')}</textarea>
      ${histHtml}
      <p class="note" id="mMsg"></p>
    </div>
    <div class="modalfoot">
      <button class="btn danger ghost" id="mDelete">Delete</button>
      <button class="btn ghost" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Save</button>
    </div>
  </div>`;
  $('modal').classList.add('open');
  enhanceSelectsIn($('modal'));   // themed dropdowns (no native <select>)
  $('mCancel').onclick = closeModal;
  $('mCancelX').onclick = closeModal;
  $('mDelete').onclick = async ()=>{
    if(!await uiConfirm('Delete milestone?', `Remove “${esc(m.name)}” from the roadmap?`, { danger:true, confirmLabel:'Delete' })) return;
    const { error } = await sb.from('milestones').delete().eq('id', id);
    if(error){ $('mMsg').textContent = error.message; return; }
    closeModal(); loadAll();
  };
  $('mSave').onclick = async ()=>{
    const status = $('mStatus').value;
    const patch = {
      name: $('mName').value.trim() || m.name,
      detail: $('mDesc').value.trim() || null,
      phase: $('mPhase').value.trim() || MILE_PHASE_DEFAULT,
      owner_seat: $('mOwner').value.trim() || null,
      target_date: $('mTarget').value || null,
      completed_on: $('mDone').value || null,
      status,
      status_manual: status !== m.status ? true : (m.status_manual || false),
      progress_pct: $('mProg').value==='' ? null : Math.max(0, Math.min(100, +$('mProg').value)),
      link_url: $('mUrl').value.trim() || null,
      notes: $('mNotes').value.trim() || null,
    };
    if(status==='done' && !patch.completed_on) patch.completed_on = new Date().toISOString().slice(0,10);
    $('mMsg').textContent = 'Saving…';
    const prevStatus = m.status;
    const { error } = await saveMilestonePatch(id, patch);
    if(error){ $('mMsg').textContent = error.message; return; }
    if(prevStatus!==status && (status==='current'||status==='done')){
      const verb = status==='done' ? 'completed' : 'now underway';
      await notifyClient('milestone', `Milestone ${verb}: ${patch.name}.`);
    }
    closeModal(); loadAll();
  };
}
// Double-click a roadmap phase header → themed editor to rename it (updates every
// milestone in that phase). Phases are a text field on milestones.
async function openPhaseEditor(phase){
  if(!phase) return;
  const items = data.miles.filter(m=> ((m.phase||'').trim() || MILE_PHASE_DEFAULT)===phase);
  $('modal').innerHTML = `<div class="modalcard">
    <div class="modalhead"><h3>Edit phase</h3><button class="modalx" id="phX">✕</button></div>
    <div class="modalbody">
      <label class="mlabel">Phase name</label>
      <input class="cellinput mfield" id="phName" value="${esc(phase)}">
      <p class="note" style="margin-top:8px">${items.length} milestone${items.length===1?'':'s'} in this phase will be renamed.</p>
      <p class="note" id="phMsg"></p>
    </div>
    <div class="modalfoot">
      <button class="btn ghost" id="phCancel">Cancel</button>
      <button class="btn" id="phSave">Save</button>
    </div>
  </div>`;
  $('modal').classList.add('open');
  const close = ()=> closeModal();
  $('phX').onclick = close; $('phCancel').onclick = close;
  $('phSave').onclick = async ()=>{
    const name = $('phName').value.trim();
    if(!name){ $('phMsg').textContent = 'Enter a phase name.'; return; }
    if(name===phase){ close(); return; }
    $('phMsg').textContent = 'Saving…';
    for(const m of items){ await sb.from('milestones').update({ phase:name }).eq('id', m.id); }
    close(); loadAll();
  };
}
// Double-click a deliverable row → full themed editor (name/owner/due/status/phase/notes).
async function openDeliverableEditor(id){
  const d = (data.deliv||[]).find(x=> x.id===id); if(!d) return;
  const phases = [...new Set((data.deliv||[]).map(x=> x.phase).filter(Boolean))];
  const phaseOpts = phases.map(p=> `<option value="${esc(p)}"${p===d.phase?' selected':''}>${esc(p)}</option>`).join('');
  const statusOpts = STATUS_OPTS.map(([v,l])=> `<option value="${v}"${v===d.status?' selected':''}>${esc(l)}</option>`).join('');
  $('modal').innerHTML = `<div class="modalcard modalcard-wide">
    <div class="modalhead"><h3>Edit deliverable</h3><button class="modalx" id="deX">✕</button></div>
    <div class="modalbody">
      <label class="mlabel">Name</label><input class="cellinput mfield" id="deName" value="${esc(d.name||'')}">
      <div class="mform-row">
        <div><label class="mlabel">Owner seat</label><input class="cellinput mfield" id="deOwner" value="${esc(d.owner_seat||'')}" placeholder="AL"></div>
        <div><label class="mlabel">Due date</label><input type="date" class="cellinput mfield" id="deDue" value="${d.due? String(d.due).slice(0,10):''}"></div>
      </div>
      <div class="mform-row">
        <div><label class="mlabel">Status</label><select class="cellinput mfield" id="deStatus">${statusOpts}</select></div>
        <div><label class="mlabel">Phase</label><select class="cellinput mfield" id="dePhase">${phaseOpts}</select></div>
      </div>
      <label class="mlabel">Client explanation (optional)</label>
      <textarea class="cellinput mfield mtextarea" id="deDesc" rows="2" placeholder="Plain-English description the client sees">${esc(d.description||'')}</textarea>
      <p class="note" id="deMsg"></p>
    </div>
    <div class="modalfoot">
      <button class="btn danger ghost" id="deDelete">Delete</button>
      <button class="btn ghost" id="deCancel">Cancel</button>
      <button class="btn" id="deSave">Save</button>
    </div>
  </div>`;
  $('modal').classList.add('open');
  enhanceSelectsIn($('modal'));   // themed dropdowns
  const close = ()=> closeModal();
  $('deX').onclick = close; $('deCancel').onclick = close;
  $('deDelete').onclick = async ()=>{
    if(!await uiConfirm('Delete deliverable?', `Remove “${esc(d.name||'this item')}”?`, { danger:true, confirmLabel:'Delete' })) return;
    const { error } = await sb.from('deliverables').delete().eq('id', id);
    if(error){ $('deMsg').textContent = error.message; return; }
    close(); loadAll();
  };
  $('deSave').onclick = async ()=>{
    const status = $('deStatus').value;
    const patch = {
      name: $('deName').value.trim() || d.name,
      owner_seat: $('deOwner').value.trim() || null,
      due: $('deDue').value || null,
      status,
      phase: $('dePhase').value || d.phase,
      description: $('deDesc').value.trim() || null,
    };
    if(status==='delivered' && d.status!=='delivered') patch.delivered_at = new Date().toISOString();
    $('deMsg').textContent = 'Saving…';
    const { error } = await sb.from('deliverables').update(patch).eq('id', id);
    if(error){ $('deMsg').textContent = error.message; return; }
    close(); loadAll();
  };
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
// Notify a practice. Writes an in-app notification; activity feed only when the event
// isn't already represented in buildEngagementTimeline() (deliverable rows, video
// history, milestones). opts.email (default true) controls whether an email is ALSO sent.
async function notifyClient(kind, message, opts={}){
  const pid = opts.practiceId || practiceId;
  if(!pid) return;
  const skipFeed = opts.feed === false
    || (kind === 'deliverable' && /^Deliverable completed:/i.test(message));
  try{
    await sb.from('notifications').insert({ practice_id: pid, kind, message });
    if(!skipFeed){
      await sb.from('activity').insert({ practice_id: pid, message, author:'ROXIUM', source:'portal' });
    }
    if(opts.email !== false){
      const { data: sess } = await sb.auth.getSession();
      fetch(`${CONFIG.SUPABASE_URL}/functions/v1/notify-client`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${sess.session.access_token}` },
        body: JSON.stringify({ practice_id: pid, message, kind }),
      }).catch(()=>{});
    }
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

/* ---------------- Operations Dashboard (team workspace) ---------------- */
let opsData = null;
let opsClientFilter = '';
let opsExpandedClient = null;
let opsClientSortAsc = true;
let opsCompanyPeriod = ALL_MONTHS;   // default the company overview to All-Months
let opsMonthSelApi = null;
let opsLoadPromise = null;
const OPS_ATTN_STORE = 'roxium_ops_attention_v2';
let opsAttnSaveTimer = null;
let opsAttnServerReady = false;
function snoozeUntilTomorrow(){
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function normalizeOpsAttentionState(raw){
  const snoozed = { ...(raw?.snoozed || {}) };
  const now = Date.now();
  Object.keys(snoozed).forEach(id=>{
    if(!snoozed[id] || new Date(snoozed[id]).getTime() <= now) delete snoozed[id];
  });
  return {
    dismissed: new Set(raw?.dismissed || []),
    snoozed,
    pinned: [...(raw?.pinned || [])],
    order: raw?.order || null,
  };
}
function serializeOpsAttentionState(st){
  return {
    dismissed: [...st.dismissed],
    snoozed: st.snoozed,
    pinned: st.pinned,
    order: st.order,
  };
}
function loadOpsAttentionStateLocal(){
  try{
    const raw = JSON.parse(localStorage.getItem(OPS_ATTN_STORE) || localStorage.getItem('roxium_ops_attention_v1') || '{}');
    return normalizeOpsAttentionState(raw);
  }catch(_){ return normalizeOpsAttentionState({}); }
}
function saveOpsAttentionState(st, { immediate=false }={}){
  const payload = serializeOpsAttentionState(st);
  try{ localStorage.setItem(OPS_ATTN_STORE, JSON.stringify(payload)); }catch(_){}
  if(!me || me.role !== 'team') return;
  const push = async ()=>{
    const { error } = await sb.rpc('set_my_ops_attention_state', { p_state: payload });
    if(error && !/does not exist|not find/i.test(error.message)) console.warn('[ops] attention save:', error.message);
    else if(!error) opsAttnServerReady = true;
  };
  if(immediate) push();
  else{
    clearTimeout(opsAttnSaveTimer);
    opsAttnSaveTimer = setTimeout(push, 450);
  }
}
async function initOpsAttentionState(){
  opsAttentionState = loadOpsAttentionStateLocal();
  if(!me || me.role !== 'team') return;
  const { data, error } = await sb.rpc('get_my_ops_attention_state');
  if(error){
    if(!/does not exist|not find/i.test(error.message)) console.warn('[ops] attention load:', error.message);
    return;
  }
  opsAttnServerReady = true;
  const server = normalizeOpsAttentionState(data || {});
  const local = loadOpsAttentionStateLocal();
  const serverEmpty = !server.dismissed.size && !Object.keys(server.snoozed).length && !server.pinned.length && !server.order;
  const localHas = local.dismissed.size || Object.keys(local.snoozed).length || local.pinned.length || local.order;
  if(serverEmpty && localHas){
    opsAttentionState = local;
    saveOpsAttentionState(opsAttentionState, { immediate:true });
  } else {
    opsAttentionState = server;
    try{ localStorage.setItem(OPS_ATTN_STORE, JSON.stringify(serializeOpsAttentionState(server))); }catch(_){}
  }
}
function getOpsAlertUiState(id){
  if(opsAttentionState.dismissed.has(id)) return 'dismissed';
  const until = opsAttentionState.snoozed[id];
  if(!until) return 'active';
  if(new Date(until).getTime() > Date.now()) return 'snoozed';
  delete opsAttentionState.snoozed[id];
  return 'active';
}
function formatSnoozeUntil(iso){
  const d = new Date(iso);
  if(isNaN(d)) return 'soon';
  return d.toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
let opsAttentionState = loadOpsAttentionStateLocal();
const PHASE_TIMING = {
  0: { warn: 7, red: 14 },
  1: { warn: 11, red: 21 },
  2: { warn: 152, red: 182 },
  3: { warn: 30, red: 60 },
  4: { warn: 30, red: 60 },
  5: { warn: 30, red: 60 },
};
const OPS_HEALTH_RANK = { red: 0, yellow: 1, green: 2 };
function parsePhaseNum(label){
  const m = String(label||'').match(/Phase\s*(\d+)/i);
  return m ? +m[1] : null;
}
function groupDelivsByPhase(delivs){
  const groups = {};
  delivs.forEach(d=>{ (groups[d.phase] = groups[d.phase] || []).push(d); });
  const order = phaseOrderMap(delivs);
  return Object.keys(groups)
    .sort((a,b)=> comparePhaseNames(a, b, order))
    .map(phase=>({ phase, items: groups[phase].sort((x,y)=>(x.sort||0)-(y.sort||0)) }));
}
// Sequential phase state machine. Exactly ONE phase runs a live countdown at a
// time — the first phase that isn't fully delivered. Earlier phases are
// 'complete' (green); later phases are 'upcoming' (green, no clock) and only
// begin counting once their immediate predecessor completes. This is what stops
// every future phase from turning yellow on the same day (they used to share the
// last-completed phase's start date and cross the warn/red thresholds together).
function computePracticePhaseState(practice, delivs){
  const groups = groupDelivsByPhase(delivs);
  const fallbackStart = practice.go_live ? new Date(practice.go_live+'T12:00:00') : new Date(practice.created_at||Date.now());
  let prevCompleteAt = practice.go_live ? new Date(practice.go_live+'T12:00:00') : null;
  let currentPhase = null;
  let currentHealth = 'green';
  let currentDays = 0;
  let reachedCurrent = false;   // once we hit the first incomplete phase, all later phases are 'upcoming'
  const states = [];
  for(const g of groups){
    const num = parsePhaseNum(g.phase);
    const delivered = g.items.filter(d=> d.status==='delivered');
    const done = delivered.length;
    const allDelivered = g.items.length > 0 && done === g.items.length;
    let health = 'green';
    let days = 0;
    let phaseState;

    if(!g.items.length){
      phaseState = 'complete';                       // empty phase — nothing to track
    } else if(allDelivered){
      phaseState = 'complete';
      const dates = delivered.map(d=> d.delivered_at).filter(Boolean).map(d=> new Date(d));
      if(dates.length) prevCompleteAt = new Date(Math.max(...dates));   // advance the anchor
    } else if(!reachedCurrent){
      // THE current phase — the only one with a live clock
      reachedCurrent = true;
      currentPhase = g.phase;
      phaseState = 'current';
      let phaseStart = prevCompleteAt || fallbackStart;
      const active = g.items.filter(d=> d.status!=='promised');
      if(active.length){
        const starts = active.map(d=> new Date(d.status_since||phaseStart)).filter(d=> !isNaN(d));
        if(starts.length) phaseStart = new Date(Math.min(...starts));
      }
      days = Math.max(0, Math.floor((Date.now()-phaseStart.getTime())/86400000));
      const rule = PHASE_TIMING[num];
      if(rule){
        if(days >= rule.red) health = 'red';
        else if(days >= rule.warn) health = 'yellow';
      }
      currentHealth = health;
      currentDays = days;
    } else {
      phaseState = 'upcoming';                        // predecessor not done yet — no clock
    }

    states.push({ phase:g.phase, num, health, days, state: phaseState,
      isCurrent: g.phase===currentPhase,
      progress: g.items.length? Math.round(100*done/g.items.length):0 });
  }
  if(!currentPhase && groups.length) currentPhase = groups[groups.length-1].phase;
  return { currentPhase, currentHealth, currentDays, states };
}
function practiceNameMap(){
  const m = new Map();
  (opsData?.practices||[]).forEach(p=> m.set(p.id, p.name));
  return m;
}
function latestKpiByPractice(rows){
  const byP = new Map();
  const norm = normalizeKpiRows(rows||[]).filter(r=> sourceKey(r.source)==='marketing');
  norm.sort((a,b)=> String(a.period).localeCompare(String(b.period)));
  norm.forEach(r=>{
    const cur = byP.get(r.practice_id);
    if(!cur || String(r.period) > String(cur.period)) byP.set(r.practice_id, r);
  });
  return byP;
}
function kpiSyncMeta(practiceId){
  const sources = (opsData?.sources||[]).filter(s=> s.practice_id===practiceId);
  const hasError = sources.some(s=> s.last_status==='error');
  const lastSync = sources.map(s=> s.last_synced_at).filter(Boolean).sort().pop() || null;
  return { hasError, lastSync, mapped: sources.filter(s=> (s.tab_name||'').trim()).length, total: sources.length };
}
function computeClientHealth(practice, delivs, videos){
  const phase = computePracticePhaseState(practice, delivs);
  let score = 100;
  if(phase.currentHealth==='red') score -= 30;
  else if(phase.currentHealth==='yellow') score -= 12;
  delivs.filter(d=> d.status!=='delivered' && d.due && new Date(d.due) < new Date()).forEach(()=>{ score -= 5; });
  videos.forEach(v=>{
    const fin = v.stage==='posted' || v.stage==='delivered';
    const sla = slaState(v.stage_since, fin);
    if(sla==='overdue') score -= 8;
    else if(sla==='warn') score -= 3;
    if(v.blocked && daysIn(v.stage_since) >= 7) score -= 10;
  });
  const sync = kpiSyncMeta(practice.id);
  if(sync.hasError) score -= 15;
  score = Math.max(0, Math.min(100, score));
  let band = 'green';
  if(score < 60 || phase.currentHealth==='red') band = 'red';
  else if(score < 85 || phase.currentHealth==='yellow') band = 'yellow';
  return { score, band, phase, sync };
}
function opsMatchesQuery(q, parts){
  if(!q) return true;
  return parts.some(p=> String(p||'').toLowerCase().includes(q));
}
function buildOpsAlerts(){
  const alerts = [];
  (opsData?.practices||[]).forEach(p=>{
    const delivs = (opsData.deliverables||[]).filter(d=> d.practice_id===p.id);
    const videos = (opsData.videos||[]).filter(v=> v.practice_id===p.id);
    const phase = computePracticePhaseState(p, delivs);
    const pname = p.name;
      if(phase.currentHealth!=='green' && phase.currentPhase){
        const label = phase.currentHealth==='red' ? 'Phase overdue' : 'Phase approaching deadline';
        const detail = `${phase.currentPhase} · ${phase.currentDays} day${phase.currentDays===1?'':'s'} in phase`;
        alerts.push({ severity: phase.currentHealth, practice:pname, practiceId:p.id, title:label, detail, sort: OPS_HEALTH_RANK[phase.currentHealth], linkView:'deliverables', phase: phase.currentPhase });
      }
    delivs.filter(d=> d.status!=='delivered' && d.due).forEach(d=>{
      const due = new Date(d.due);
      const daysLeft = Math.ceil((due - Date.now())/86400000);
      let severity = 'green', title = 'Deliverable on track';
      if(daysLeft < 0){ severity = 'red'; title = 'Deliverable overdue'; }
      else if(daysLeft <= 1){ severity = 'yellow'; title = 'Deliverable due tomorrow'; }
      else if(daysLeft <= 7){ severity = 'yellow'; title = 'Deliverable approaching deadline'; }
      if(severity==='green') return;
      const detail = `${d.name}${daysLeft < 0 ? ` · ${Math.abs(daysLeft)} day${Math.abs(daysLeft)===1?'':'s'} overdue` : daysLeft<=1 ? '' : ` · ${daysLeft} days left`}`;
      alerts.push({ severity, practice:pname, practiceId:p.id, title, detail, sort: OPS_HEALTH_RANK[severity], days: daysLeft, linkView:'deliverables', delivId:d.id, phase:d.phase });
    });
    videos.forEach(v=>{
      const fin = v.stage==='posted' || v.stage==='delivered';
      const sla = slaState(v.stage_since, fin);
      if(sla){
        const days = daysIn(v.stage_since);
        const title = sla==='overdue' ? 'Video overdue' : 'Video stalled';
        const detail = `${v.item} · ${days} day${days===1?'':'s'} in ${stageLabelOf(v.stage)}`;
        alerts.push({ severity: sla==='overdue'?'red':'yellow', practice:pname, practiceId:p.id, title, detail, sort: OPS_HEALTH_RANK[sla==='overdue'?'red':'yellow'], days, linkView:'video', videoId:v.id });
      }
      if(v.blocked){
        const days = daysIn(v.stage_since);
        if(days >= 7){
          const title = 'Waiting on client approval';
          const detail = `${v.item} · ${days} day${days===1?'':'s'} waiting`;
          alerts.push({ severity: days>=14?'red':'yellow', practice:pname, practiceId:p.id, title, detail, sort: OPS_HEALTH_RANK[days>=14?'red':'yellow'], days, linkView:'video', videoId:v.id });
        }
      }
    });
    const sync = kpiSyncMeta(p.id);
    const pSources = (opsData?.sources||[]).filter(s=> s.practice_id===p.id);
    if(sync.hasError){
      alerts.push({ severity:'red', practice:pname, practiceId:p.id, title:'KPI sync failed', detail:'Reporting workbook sync error', sort:0, linkView:'metrics', action:'sync' });
    } else {
      // Data stopped flowing without an outright error (>26h since a 2-hourly job)
      const staleSrcs = pSources.filter(s=> s.last_status!=='error' && syncAge(s.last_synced_at)?.cls==='bad');
      if(staleSrcs.length){
        alerts.push({ severity:'yellow', practice:pname, practiceId:p.id, title:'KPI sync stale',
          detail:`${staleSrcs.map(s=> channelLabel(s.source)).join(', ')} · no data for over a day`,
          sort: OPS_HEALTH_RANK.yellow, linkView:'metrics', action:'sync' });
      }
    }
    // The pre-pipeline chase: access asked for but never granted (SOP: escalate ~5
    // business days), and access granted but never wired into a syncing tab.
    pSources.forEach(s=>{
      if(s.access_status==='requested'){
        const days = accessAgeDays(s);
        if(days==null || days < 3) return;
        const sev = days>=7 ? 'red' : 'yellow';
        alerts.push({ severity:sev, practice:pname, practiceId:p.id,
          title: days>=7 ? 'Access request aging — escalate' : 'Access request pending',
          detail:`${channelLabel(s.source)} · requested ${days}d ago`,
          sort: OPS_HEALTH_RANK[sev], days, linkView:'metrics', srcKey:s.source });
      } else if(s.access_status==='granted' && !s.last_synced_at){
        alerts.push({ severity:'yellow', practice:pname, practiceId:p.id,
          title:'Access granted — finish wiring',
          detail:`${channelLabel(s.source)} · connect the workbook tab, then sync`,
          sort: OPS_HEALTH_RANK.yellow, linkView:'metrics', srcKey:s.source });
      }
    });
    // Failing marketing connections — a reconnect the team needs to chase.
    (opsData.connections||[]).filter(c=> c.practice_id===p.id).forEach(c=>{
      if(c.status==='error' || c.status==='revoked'){
        alerts.push({ severity:'red', practice:pname, practiceId:p.id,
          title:'Connection failed', detail:`${platformInfo(c.provider).title} · ${humanizeSyncError(c.last_error)||'reconnect to resume reporting'}`,
          sort: OPS_HEALTH_RANK.red, linkView:'connections' });
      } else if(c.last_error){
        alerts.push({ severity:'yellow', practice:pname, practiceId:p.id,
          title:'Connection needs attention', detail:`${platformInfo(c.provider).title} · last sync had an issue`,
          sort: OPS_HEALTH_RANK.yellow, linkView:'connections' });
      }
    });
    (opsData.milestones||[]).filter(m=> m.practice_id===p.id).forEach(m=>{
      if(!m.target_date || m.status==='done') return;
      const days = Math.ceil((new Date(m.target_date+'T12:00:00')-Date.now())/86400000);
      if(days > 7) return;
      const severity = days < 0 ? 'red' : 'yellow';
      const title = days < 0 ? 'Milestone overdue' : 'Milestone approaching';
      const detail = `${m.name}${days < 0 ? ` · ${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue` : days===0 ? ' · due today' : ` · ${days} day${days===1?'':'s'} left`}`;
      alerts.push({ severity, practice:pname, practiceId:p.id, title, detail, sort: OPS_HEALTH_RANK[severity], days, linkView:'roadmap', milestoneId:m.id });
    });
  });
  alerts.sort((a,b)=> a.sort - b.sort || (a.days??999) - (b.days??999) || a.practice.localeCompare(b.practice));
  return alerts;
}
function opsAlertId(a){
  return [a.practiceId, a.linkView||'', a.title, a.delivId||'', a.videoId||'', a.milestoneId||'', a.phase||'', a.srcKey||''].join('|');
}
function defaultAlertSort(a, b){
  return a.sort - b.sort || (a.days??999) - (b.days??999) || a.practice.localeCompare(b.practice);
}
function prepareOpsAttentionList(alerts){
  const activeIds = new Set(alerts.map(opsAlertId));
  [...opsAttentionState.dismissed].forEach(id=>{ if(!activeIds.has(id)) opsAttentionState.dismissed.delete(id); });
  Object.keys(opsAttentionState.snoozed).forEach(id=>{ if(!activeIds.has(id)) delete opsAttentionState.snoozed[id]; });
  opsAttentionState.pinned = opsAttentionState.pinned.filter(id=> activeIds.has(id));
  if(opsAttentionState.order) opsAttentionState.order = opsAttentionState.order.filter(id=> activeIds.has(id));
  saveOpsAttentionState(opsAttentionState);
  const items = alerts.map(a=> ({ ...a, id: opsAlertId(a), uiState: getOpsAlertUiState(opsAlertId(a)) }));
  const stateRank = { active:0, snoozed:1, dismissed:2 };
  items.sort((a,b)=>{
    const ra = stateRank[a.uiState], rb = stateRank[b.uiState];
    if(ra !== rb) return ra - rb;
    const pa = opsAttentionState.pinned.indexOf(a.id);
    const pb = opsAttentionState.pinned.indexOf(b.id);
    if(pa >= 0 || pb >= 0){
      if(pa < 0) return 1;
      if(pb < 0) return -1;
      return pa - pb;
    }
    if(opsAttentionState.order){
      const oa = opsAttentionState.order.indexOf(a.id);
      const ob = opsAttentionState.order.indexOf(b.id);
      if(oa >= 0 && ob >= 0) return oa - ob;
      if(oa >= 0) return -1;
      if(ob >= 0) return 1;
    }
    return defaultAlertSort(a, b);
  });
  return items;
}
function openOpsDeepLink({ practiceId: pid, view = 'deliverables', delivId, videoId, phase, milestoneId }){
  if(!pid) return;
  practiceId = pid;
  updateSwitcherLabel();
  resetPracticeUiState();
  pendingDeepLink = { delivId, videoId, phase, milestoneId, view };
  const parts = [view, `pid=${encodeURIComponent(pid)}`];
  if(delivId) parts.push(`deliv=${encodeURIComponent(delivId)}`);
  if(videoId) parts.push(`video=${encodeURIComponent(videoId)}`);
  if(phase) parts.push(`phase=${encodeURIComponent(phase)}`);
  if(milestoneId) parts.push(`ms=${encodeURIComponent(milestoneId)}`);
  const targetView = view;
  loadAll().then(()=>{
    location.hash = '#' + parts.join('&');
    showView(targetView);
    requestAnimationFrame(()=> applyDeepLinkFocus());
  });
}
function openOpsClient(pid){ openOpsDeepLink({ practiceId: pid, view: 'roadmap' }); }
function destroyOpsCharts(){ destroyKpiCharts(); }
function renderOpsCompanyKpi(viewPeriod, isLive, { allMonths=false }={}){
  destroyOpsCharts();
  const wrap = $('opsKpiCharts');
  if(!wrap) return;
  if(allMonths){
    const monthly = aggregateCompanyKpiByMonth(opsData?.kpiRaw||[]);
    const series = buildMonthlyChartSeries(monthly);
    renderInvestChartPanel({
      wrap, canvasId:'opsChartInvest', series, viewPeriod:ALL_MONTHS, isLive:false, mode:'monthly',
      headTitle:'Company trend',
      headNote:`All clients · all channels · ${series.length} month${series.length===1?'':'s'}`,
      chartTitle:'Investment & performance',
      chartSub:'Monthly company-wide rollup — select a month to drill into daily detail.',
    });
    return;
  }
  const series = aggregateOpsDailyByDay(opsDailyRows(), viewPeriod, isLive);
  renderInvestChartPanel({
    wrap, canvasId:'opsChartInvest', series, viewPeriod, isLive, mode:'daily',
    headTitle:'Company trend',
    headNote:`All clients · all channels · ${periodLabel(viewPeriod)} · days 1–${series.length}`,
    chartTitle:'Investment & performance',
    chartSub:'Daily rollup across the roster for the selected reporting month.',
  });
}
function aggregateCompanyKpiByMonth(kpiRaw){
  // Sum across EVERY channel/source (Meta + Google + …), not just marketing — one
  // normalized row per (period, source), then add additive metrics per period.
  const norm = normalizeKpiRows(kpiRaw||[]);
  const byPeriod = new Map();
  norm.forEach(r=>{
    const key = String(r.period);
    const agg = byPeriod.get(key) || { period:key, spend:0, reach:0, impr:0, clicks:0, cons:0, proc:0 };
    agg.spend += N(r,'spend')||0;
    agg.reach += N(r,'reach')||0;
    agg.impr += N(r,'impr')||0;
    agg.clicks += N(r,'clicks')||0;
    agg.cons += N(r,'cons')||0;
    agg.proc += N(r,'proc')||0;
    byPeriod.set(key, agg);
  });
  return [...byPeriod.values()]
    .sort((a,b)=> a.period.localeCompare(b.period))
    .map(row=>{
      row.ctr = row.impr ? row.clicks/row.impr : null;
      row.cpc = row.clicks ? row.spend/row.clicks : null;
      row.cpm = row.impr ? row.spend/(row.impr/1000) : null;
      return row;
    });
}
function opsKpiTrend(cur, prev, key, { lowerBetter=false, decimals=0 }={}){
  const c = N(cur,key), p = prev ? N(prev,key) : null;
  if(c==null || p==null || !isFinite(+p) || +p===0) return null;
  const pct = (c-p)/Math.abs(p)*100;
  if(Math.abs(pct) < 0.5) return { text:'±0%', cls:'flat', note:'vs previous month' };
  const up = pct > 0;
  const good = lowerBetter ? !up : up;
  const sign = up ? '+' : '-';
  return { text:`${up?'▲':'▼'} ${sign}${Math.abs(pct).toFixed(decimals)}%`, cls: good ? 'up' : 'down', note:'vs previous month' };
}
function buildOpsMonthPicker(monthly, viewPeriod, latestPeriod){
  const mount = $('opsKpiMonthPicker');
  if(!mount) return;
  if(!monthly.length){ mount.innerHTML = ''; return; }
  const opts = [{ value:ALL_MONTHS, label:'All Months' }]
    .concat(monthly.slice().reverse().map(r=> ({
      value: r.period,
      label: `${periodLabel(r.period)}${String(r.period)===String(latestPeriod)?' (latest)':''}`,
    })));
  const val = isAllMonthsSel(opsCompanyPeriod) ? ALL_MONTHS : (opsCompanyPeriod || latestPeriod || opts[1]?.value || '');
  if(!opsMonthSelApi || opsMonthSelApi._mount !== mount){
    opsMonthSelApi = themedSelect(mount, { options:opts, value:val, placeholder:'Reporting month',
      onChange:p=>{ opsCompanyPeriod = p; renderOperationsDashboard(); } });
    opsMonthSelApi._mount = mount;
  } else {
    opsMonthSelApi.setOptions(opts);
    opsMonthSelApi.setValue(val);
  }
}
async function updateOpsRow(table, id, patch){
  const { error } = await sb.from(table).update(patch).eq('id', id);
  if(error){ flash(error.message); return false; }
  const listKey = table === 'deliverables' ? 'deliverables' : table === 'video_pipeline' ? 'videos' : null;
  if(listKey && opsData?.[listKey]){
    const row = opsData[listKey].find(r=> r.id === id);
    if(row) Object.assign(row, patch);
  }
  renderOperationsDashboard();
  flash('Saved.');
  return true;
}
async function updateOpsDeliverable(id, patch){
  const row = opsData?.deliverables?.find(d=> d.id===id);
  const wasDelivered = row?.status==='delivered';
  if(patch.status){
    if(patch.status==='delivered'){
      patch.delivered_at = row?.delivered_at || new Date().toISOString();
    } else {
      patch.delivered_at = null;
    }
  }
  const ok = await updateOpsRow('deliverables', id, patch);
  // Completing from the team/ops dashboard must notify too (previously it didn't).
  // In-app per deliverable; email only when the phase is fully shipped.
  if(ok && row && patch.status==='delivered' && !wasDelivered){
    await notifyClient('deliverable', `Deliverable completed: ${row.name}.`, { email:false, practiceId: row.practice_id });
    const inPhase = (opsData?.deliverables||[]).filter(d=> d.practice_id===row.practice_id && (d.phase||'')===(row.phase||''));
    if(inPhase.length && inPhase.every(d=> d.status==='delivered')){
      await notifyClient('deliverable', `Phase "${row.phase}" is complete — every deliverable in it has shipped.`, { email:true, practiceId: row.practice_id });
    }
  }
  return ok;
}
async function updateOpsVideo(id, patch){
  return updateOpsRow('video_pipeline', id, patch);
}
function renderOpsAlertItem(a){
  const icon = a.severity==='red' ? '🔴' : a.severity==='yellow' ? '🟡' : '🟢';
  const pinned = opsAttentionState.pinned.includes(a.id);
  const muted = a.uiState==='snoozed' || a.uiState==='dismissed';
  const until = a.uiState==='snoozed' ? opsAttentionState.snoozed[a.id] : null;
  const badge = a.uiState==='snoozed'
    ? `<span class="ops-alert-badge ops-alert-badge-paused">Paused</span>`
    : a.uiState==='dismissed'
      ? `<span class="ops-alert-badge ops-alert-badge-dismissed">Dismissed</span>`
      : '';
  const meta = a.uiState==='snoozed' && until
    ? `<div class="ops-alert-meta">Returns ${esc(formatSnoozeUntil(until))}</div>`
    : a.uiState==='dismissed'
      ? `<div class="ops-alert-meta">Hidden from your active queue</div>`
      : '';
  const resumeBtn = a.uiState==='snoozed'
    ? `<button type="button" class="ops-alert-resume" data-resume-alert="${esc(a.id)}" title="Resume now">Resume</button>`
    : '';
  const restoreBtn = a.uiState==='dismissed'
    ? `<button type="button" class="ops-alert-restore" data-restore-alert="${esc(a.id)}" title="Restore to queue">Restore</button>`
    : '';
  return `<div class="ops-alert ops-alert-${a.severity} ops-alert-item${pinned?' pinned':''}${muted?' ops-alert-muted':''}${a.uiState==='snoozed'?' ops-alert-paused':''}${a.uiState==='dismissed'?' ops-alert-dismissed-state':''}" draggable="${a.uiState==='active'?'true':'false'}" data-alert-id="${esc(a.id)}">
    <span class="ops-alert-grip" title="Drag to reorder">⋮⋮</span>
    <div class="ops-alert-icon">${icon}</div>
    <div class="ops-alert-body ops-alert-link" data-ops-link="1" data-ops-pid="${a.practiceId}" data-ops-view="${a.linkView||'roadmap'}"${a.delivId? ` data-ops-deliv="${a.delivId}"`:''}${a.videoId? ` data-ops-video="${a.videoId}"`:''}${a.phase? ` data-ops-phase="${esc(a.phase)}"`:''}${a.milestoneId? ` data-ops-ms="${a.milestoneId}"`:''} role="button" tabindex="0">
      <div class="ops-alert-practice">${esc(a.practice)} ${badge}</div>
      <div class="ops-alert-title">${esc(a.title)}</div>
      <div class="ops-alert-detail">${esc(a.detail)}</div>
      ${meta}
    </div>
    <div class="ops-alert-actions">
      ${a.uiState==='active' ? `
      ${a.action==='sync' ? `<button type="button" class="ops-alert-verb" data-sync-alert="${esc(a.id)}" title="Run the reporting sync now">Sync now</button>` : ''}
      <button type="button" class="ops-alert-pin${pinned?' active':''}" data-pin-alert="${esc(a.id)}" title="${pinned?'Unpin':'Pin to top'}">📌</button>
      <button type="button" class="ops-alert-snooze" data-snooze-alert="${esc(a.id)}" title="Snooze until tomorrow">⏸</button>
      <button type="button" class="ops-alert-dismiss" data-dismiss-alert="${esc(a.id)}" title="Dismiss">✕</button>` : `${resumeBtn}${restoreBtn}`}
    </div>
  </div>`;
}
function wireOpsAttentionList(root){
  const scope = root || document;
  scope.querySelectorAll('[data-dismiss-alert]').forEach(btn=>{
    btn.onclick = async e=>{
      e.stopPropagation();
      const id = btn.dataset.dismissAlert;
      const ok = await uiDialog({
        title:'Dismiss this item?',
        body:'Are you sure you want to dismiss this item? You can restore it from the bottom of the list.',
        confirmLabel:'Dismiss',
        cancelLabel:'Cancel',
        danger:true,
      });
      if(!ok) return;
      opsAttentionState.dismissed.add(id);
      delete opsAttentionState.snoozed[id];
      saveOpsAttentionState(opsAttentionState);
      renderOperationsDashboard();
    };
  });
  scope.querySelectorAll('[data-snooze-alert]').forEach(btn=>{
    btn.onclick = e=>{
      e.stopPropagation();
      const id = btn.dataset.snoozeAlert;
      opsAttentionState.snoozed[id] = snoozeUntilTomorrow();
      opsAttentionState.dismissed.delete(id);
      saveOpsAttentionState(opsAttentionState);
      renderOperationsDashboard();
    };
  });
  // One-click verb on sync alerts: run the reporting sync right from the queue,
  // then reload ops data so the alert clears itself if the sync fixed it.
  scope.querySelectorAll('[data-sync-alert]').forEach(btn=>{
    btn.onclick = async e=>{
      e.stopPropagation();
      btn.disabled = true; btn.textContent = 'Syncing…';
      try{
        await invokeSyncFn({ action:'sync', trigger:'manual' });
        await loadSheetSources();
        await loadOperationsData(true);
      }catch(err){
        console.error('[ops] sync-now failed:', err);
        btn.textContent = 'Failed';
        setTimeout(()=>{ btn.disabled = false; btn.textContent = 'Sync now'; }, 2000);
      }
    };
  });
  scope.querySelectorAll('[data-resume-alert]').forEach(btn=>{
    btn.onclick = e=>{
      e.stopPropagation();
      delete opsAttentionState.snoozed[btn.dataset.resumeAlert];
      saveOpsAttentionState(opsAttentionState);
      renderOperationsDashboard();
    };
  });
  scope.querySelectorAll('[data-restore-alert]').forEach(btn=>{
    btn.onclick = e=>{
      e.stopPropagation();
      opsAttentionState.dismissed.delete(btn.dataset.restoreAlert);
      saveOpsAttentionState(opsAttentionState);
      renderOperationsDashboard();
    };
  });
  scope.querySelectorAll('[data-pin-alert]').forEach(btn=>{
    btn.onclick = e=>{
      e.stopPropagation();
      const id = btn.dataset.pinAlert;
      const i = opsAttentionState.pinned.indexOf(id);
      if(i >= 0) opsAttentionState.pinned.splice(i, 1);
      else opsAttentionState.pinned.unshift(id);
      saveOpsAttentionState(opsAttentionState);
      renderOperationsDashboard();
    };
  });
  wireOpsDeepLinks(scope);
  const list = scope.querySelector('.ops-attention-list') || scope;
  let dragId = null;
  list.querySelectorAll('.ops-alert-item[draggable="true"]').forEach(item=>{
    item.addEventListener('dragstart', e=>{
      dragId = item.dataset.alertId;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    item.addEventListener('dragend', ()=>{ item.classList.remove('dragging'); dragId = null; });
    item.addEventListener('dragover', e=>{ e.preventDefault(); item.classList.add('over'); });
    item.addEventListener('dragleave', ()=> item.classList.remove('over'));
    item.addEventListener('drop', e=>{
      e.preventDefault();
      item.classList.remove('over');
      const from = e.dataTransfer.getData('text/plain') || dragId;
      const to = item.dataset.alertId;
      if(!from || !to || from===to) return;
      const ids = [...list.querySelectorAll('.ops-alert-item')].map(el=> el.dataset.alertId);
      const fi = ids.indexOf(from), ti = ids.indexOf(to);
      if(fi < 0 || ti < 0) return;
      ids.splice(ti, 0, ids.splice(fi, 1)[0]);
      opsAttentionState.order = ids;
      saveOpsAttentionState(opsAttentionState);
      renderOperationsDashboard();
    });
  });
  const resetBtn = $('opsAttentionReset');
  if(resetBtn){
    resetBtn.hidden = !opsAttentionState.order && !opsAttentionState.pinned.length;
    if(!resetBtn._wired){
      resetBtn._wired = true;
      resetBtn.onclick = ()=>{
        opsAttentionState.order = null;
        opsAttentionState.pinned = [];
        saveOpsAttentionState(opsAttentionState);
        renderOperationsDashboard();
      };
    }
  }
}
function wireOpsDeepLinks(root){
  (root || document).querySelectorAll('[data-ops-link]').forEach(el=>{
    const go = ()=> openOpsDeepLink({
      practiceId: el.dataset.opsPid,
      view: el.dataset.opsView || 'deliverables',
      delivId: el.dataset.opsDeliv || null,
      videoId: el.dataset.opsVideo || null,
      phase: el.dataset.opsPhase || null,
      milestoneId: el.dataset.opsMs || null,
    });
    el.onclick = e=>{ e.preventDefault(); go(); };
    el.onkeydown = e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); go(); } };
  });
}
function opsClientMatchesFilter(row, q){
  if(!q) return true;
  const delivs = (opsData.deliverables||[]).filter(d=> d.practice_id===row.p.id);
  const videos = (opsData.videos||[]).filter(v=> v.practice_id===row.p.id);
  const parts = [
    row.p.name, row.phase.currentPhase, row.marketing,
    ...delivs.flatMap(d=> [d.name, d.owner_seat, d.phase]),
    ...videos.flatMap(v=> [v.item, v.blocked_reason, stageLabelOf(v.stage)]),
    ...(row.milestones||[]).map(m=> m.name),
  ];
  return opsMatchesQuery(q, parts);
}
function opsPhaseShortLabel(phase){
  if(!phase) return '—';
  const num = parsePhaseNum(phase);
  if(num==null) return phase.length > 28 ? phase.slice(0, 26)+'…' : phase;
  return `Phase ${num}`;
}
function wireOpsClientEdits(root){
  const scope = root || document;
  scope.querySelectorAll('.ops-due-input').forEach(inp=>{
    inp.onclick = e=> e.stopPropagation();
    inp.onchange = async ()=>{
      const ok = await updateOpsDeliverable(inp.dataset.delivId, { due: inp.value || null });
      if(!ok) inp.value = inp.defaultValue;
    };
  });
  scope.querySelectorAll('.ops-deliv-at').forEach(inp=>{
    inp.onclick = e=> e.stopPropagation();
    inp.onchange = async ()=>{
      const val = inp.value ? new Date(inp.value+'T12:00:00').toISOString() : null;
      const ok = await updateOpsDeliverable(inp.dataset.delivId, { delivered_at: val });
      if(!ok) inp.value = inp.defaultValue;
    };
  });
  scope.querySelectorAll('.ops-deliv-status').forEach(sel=>{
    sel.onclick = e=> e.stopPropagation();
    sel.onchange = async ()=> updateOpsDeliverable(sel.dataset.delivId, { status: sel.value });
  });
  scope.querySelectorAll('.ops-vid-stage').forEach(sel=>{
    sel.onclick = e=> e.stopPropagation();
    sel.onchange = async ()=> updateOpsVideo(sel.dataset.vidId, { stage: sel.value });
  });
  scope.querySelectorAll('.ops-shoot-date').forEach(inp=>{
    inp.onclick = e=> e.stopPropagation();
    inp.onchange = async ()=>{
      const ok = await updateOpsVideo(inp.dataset.vidId, { planned_shoot_date: inp.value || null });
      if(!ok) inp.value = inp.defaultValue;
    };
  });
  enhanceSelectsIn(scope);
}
function renderOpsClientDetail(r){
  const delivs = (opsData.deliverables||[]).filter(d=> d.practice_id===r.p.id && d.status!=='delivered');
  const videos = (opsData.videos||[]).filter(v=> v.practice_id===r.p.id && v.stage!=='posted' && v.stage!=='delivered');
  const groups = groupDelivsByPhase(delivs);
  const overdueDeliv = delivs.filter(d=> d.due && new Date(d.due) < new Date()).length;
  const upcomingDeliv = delivs.filter(d=>{
    if(!d.due) return false;
    const days = Math.ceil((new Date(d.due)-Date.now())/86400000);
    return days >= 0 && days <= 14;
  }).length;
  const mini = [
    { l:'Health score', v: String(r.h.score), cls: r.h.band, compact:false },
    { l:'Current phase', v: opsPhaseShortLabel(r.phase.currentPhase), title: r.phase.currentPhase||'', compact:true },
    { l:'Open deliverables', v: String(r.openDeliv), compact:false },
    { l:'Overdue', v: String(overdueDeliv), warn: overdueDeliv>0, compact:false },
    { l:'Due ≤14d', v: String(upcomingDeliv), compact:false },
    { l:'Videos active', v: String(r.openVid), compact:false },
    { l:'Waiting on client', v: String(r.waitingVid), warn: r.waitingVid>0, compact:false },
    { l:'Marketing', v: r.marketing, compact:true },
    { l:'Last sync', v: r.sync?.lastSync ? ago(r.sync.lastSync) : '—',
      warn: !!(r.sync?.lastSync && syncAge(r.sync.lastSync)?.stale) || r.sync?.hasError, compact:true },
  ];
  const delivRows = groups.flatMap(g=> g.items.map(d=>{
    const daysLeft = d.due ? Math.ceil((new Date(d.due)-Date.now())/86400000) : null;
    const days = daysLeft==null? '—' : daysLeft < 0 ? `${Math.abs(daysLeft)} overdue` : String(daysLeft);
    const rowCls = daysLeft!=null && daysLeft<0? 'ops-row-warn' : daysLeft!=null && daysLeft<=3? 'ops-row-caution' : '';
    return `<tr class="${rowCls}">
      <td>${esc(d.name)}</td>
      <td class="ops-phase-cell" title="${esc(g.phase)}">${esc(opsPhaseShortLabel(g.phase))}</td>
      <td>${esc(d.owner_seat||'—')}</td>
      <td class="ops-due-cell"><input type="date" class="cellinput ops-due-input" data-deliv-id="${d.id}" value="${d.due? String(d.due).slice(0,10):''}"></td>
      <td>${days}</td>
      <td class="ops-status-cell"><select class="statussel ops-deliv-status" data-deliv-id="${d.id}">${STATUS_OPTS.map(([v,l])=>`<option value="${v}" ${v===d.status?'selected':''}>${l}</option>`).join('')}</select></td>
      <td class="ops-due-cell">${d.status==='delivered' || d.delivered_at ? `<input type="date" class="cellinput ops-deliv-at" data-deliv-id="${d.id}" value="${d.delivered_at? String(d.delivered_at).slice(0,10):''}">` : '—'}</td>
    </tr>`;
  }));
  const vidRows = videos.map(v=>{
    const fin = v.stage==='posted' || v.stage==='delivered';
    const sla = slaState(v.stage_since, fin);
    const wait = v.blocked ? (v.blocked_reason||'Practice') : '—';
    const st = sla==='overdue'? 'Overdue' : sla==='warn'? 'Watch' : v.blocked? 'Blocked' : 'On track';
    return `<tr class="${sla? 'ops-row-'+sla:''}">
      <td>${esc(v.item)}</td>
      <td class="ops-status-cell"><select class="stagesel ops-vid-stage" data-vid-id="${v.id}">${STAGES.map(([k,l])=>`<option value="${k}" ${k===v.stage?'selected':''}>${l}</option>`).join('')}</select></td>
      <td>${daysIn(v.stage_since)}</td>
      <td class="ops-due-cell"><input type="date" class="cellinput ops-shoot-date" data-vid-id="${v.id}" value="${v.planned_shoot_date? String(v.planned_shoot_date).slice(0,10):''}"></td>
      <td>${esc(wait)}</td>
      <td>${esc(st)}</td>
    </tr>`;
  });
  // Marketing Connections — one row per source: access state → sync health.
  // This is where "we asked for Google Ads access 9 days ago" stops being tribal
  // knowledge and becomes a red row on the client card.
  const connSources = (opsData.sources||[]).filter(s=> s.practice_id===r.p.id);
  const connRows = connSources.map(s=>{
    const acc = s.access_status || 'connected';
    const age = syncAge(s.last_synced_at);
    const reqDays = accessAgeDays(s);
    let state;
    if(s.last_status==='error') state = `<span class="ssbad" title="${esc(s.last_error||'')}">⚠ Sync error${age?` · ${esc(age.label)}`:''}</span>`;
    else if(age && !age.stale) state = `<span class="ssok">✓ Connected · synced ${esc(age.label)}</span>`;
    else if(age) state = `<span class="${age.cls==='bad'?'ssbad':'sswarn'}">⚠ Connected · stale ${esc(age.label)}</span>`;
    else if(acc==='granted') state = `<span class="sswarn">Granted — wire the tab &amp; sync</span>`;
    else if(acc==='requested') state = `<span class="${accessAgeCls(reqDays)}">Requested${reqDays!=null?` · ${reqDays}d ago`:''}${(reqDays??0)>=7?' — escalate':''}</span>`;
    else state = `<span class="note">Connected · awaiting first sync</span>`;
    return `<div class="ops-conn-row">
      <span class="ops-conn-name">${esc(channelLabel(s.source))}</span>
      <span class="ops-conn-tab note">${esc(s.tab_name||'—')}</span>
      <span class="ops-conn-state">${state}</span>
    </div>`;
  });
  return `<div class="ops-client-detail">
    <div class="ops-client-metrics">${mini.map(m=>`
      <div class="ops-client-metric${m.warn?' warn':''}${m.cls? ' band-'+m.cls:''}${m.compact?' compact':''}">
        <div class="ops-client-metric-v"${m.title? ` title="${esc(m.title)}"`:''}>${esc(m.v)}</div>
        <div class="ops-client-metric-l">${esc(m.l)}</div>
      </div>`).join('')}</div>
    <div class="ops-client-section">
      <h4>Marketing connections</h4>
      ${connRows.length ? `<div class="ops-conn-list">${connRows.join('')}</div>`
                        : '<p class="note">No reporting sources configured yet — add them in Team Controls → Reporting &amp; KPI.</p>'}
    </div>
    <div class="ops-client-section">
      <h4>Open deliverables</h4>
      ${delivRows.length ? `<table class="ops-table ops-table-compact ops-edit-table"><thead><tr>
        <th>Deliverable</th><th>Phase</th><th>Owner</th><th>Due</th><th>Days</th><th>Status</th><th>Delivered</th>
      </tr></thead><tbody>${delivRows.join('')}</tbody></table>` : '<p class="note">No open deliverables.</p>'}
    </div>
    <div class="ops-client-section">
      <h4>Video production</h4>
      ${vidRows.length ? `<table class="ops-table ops-table-compact ops-edit-table"><thead><tr>
        <th>Video</th><th>Stage</th><th>Days</th><th>Scheduled</th><th>Waiting</th><th>Status</th>
      </tr></thead><tbody>${vidRows.join('')}</tbody></table>` : '<p class="note">No active videos.</p>'}
    </div>
    <button type="button" class="btn sm ghost ops-open-client" data-ops-pid="${r.p.id}">Open full client workspace →</button>
  </div>`;
}
function renderOperationsDashboard(){
  if(!opsData) return;
  const practices = opsData.practices || [];
  const alerts = buildOpsAlerts();
  const healthRows = practices.map(p=>{
    const delivs = opsData.deliverables.filter(d=> d.practice_id===p.id);
    const videos = opsData.videos.filter(v=> v.practice_id===p.id);
    const h = computeClientHealth(p, delivs, videos);
    const phase = h.phase;
    const openDeliv = delivs.filter(d=> d.status!=='delivered').length;
    const openVid = videos.filter(v=> v.stage!=='posted' && v.stage!=='delivered').length;
    const waitingVid = videos.filter(v=> v.blocked).length;
    const sync = h.sync;
    const nextDue = delivs.filter(d=> d.status!=='delivered' && d.due).map(d=> d.due).sort()[0] || null;
    const kpi = latestKpiByPractice(opsData.kpiRaw).get(p.id);
    let marketing = kpi ? 'Synced' : (sync.mapped ? 'Awaiting data' : 'Not configured');
    if(sync.hasError) marketing = 'Sync error';
    return { p, h, phase, openDeliv, openVid, waitingVid, sync, nextDue, marketing, kpi, milestones: opsData.milestones.filter(m=> m.practice_id===p.id) };
  });
  const flaggedClients = new Set(alerts.map(a=> a.practiceId));
  const onTrack = healthRows.filter(r=> r.h.band==='green' && !flaggedClients.has(r.p.id)).length;
  const videosProd = (opsData.videos||[]).filter(v=> v.stage!=='posted' && v.stage!=='delivered').length;
  const videosWait = (opsData.videos||[]).filter(v=> v.blocked).length;
  const videosOver = (opsData.videos||[]).filter(v=>{
    const fin = v.stage==='posted' || v.stage==='delivered';
    return slaState(v.stage_since, fin)==='overdue';
  }).length;
  const upcomingDeliv = (opsData.deliverables||[]).filter(d=>{
    if(d.status==='delivered' || !d.due) return false;
    const days = Math.ceil((new Date(d.due)-Date.now())/86400000);
    return days >= 0 && days <= 14;
  }).length;
  const avgHealth = healthRows.length ? Math.round(healthRows.reduce((s,r)=> s+r.h.score, 0)/healthRows.length) : 0;
  const overdueDelivCount = (opsData.deliverables||[]).filter(d=>{
    if(d.status==='delivered' || !d.due) return false;
    return new Date(d.due) < new Date();
  }).length;
  const attentionList = prepareOpsAttentionList(alerts);
  const activeAttention = attentionList.filter(a=> a.uiState==='active');
  const needAttentionCount = activeAttention.length;
  const needAttentionClients = new Set(activeAttention.map(a=> a.practiceId)).size;
  // Data-connection digest: everything between "we asked" and "data is flowing".
  const allSources = opsData.sources || [];
  const connPending = allSources.filter(s=> s.access_status==='requested' || (s.access_status==='granted' && !s.last_synced_at)).length;
  const connErrors  = allSources.filter(s=> s.last_status==='error').length;
  const connStale   = allSources.filter(s=> s.last_status!=='error' && syncAge(s.last_synced_at)?.cls==='bad').length;
  const connIssues  = connPending + connErrors + connStale;
  const connNoteParts = [];
  if(connPending) connNoteParts.push(`${connPending} awaiting access/wiring`);
  if(connErrors)  connNoteParts.push(`${connErrors} sync error${connErrors===1?'':'s'}`);
  if(connStale)   connNoteParts.push(`${connStale} stale`);
  const cards = [
    { v: practices.length, l:'Active clients', note:'on the roster', tier:'primary' },
    { v: needAttentionCount, l:'Need attention', note: needAttentionCount ? `${needAttentionClients} client${needAttentionClients===1?'':'s'} · ${needAttentionCount} flag${needAttentionCount===1?'':'s'}` : 'nothing flagged', cls: needAttentionCount? 'a':'', tier:'primary' },
    { v: overdueDelivCount, l:'Overdue deliverables', note:'past due date', cls: overdueDelivCount? 'r':'', tier:'primary' },
    { v: upcomingDeliv, l:'Due within 14 days', note:'coming up soon', cls: upcomingDeliv? 'a':'', tier:'primary' },
    { v: onTrack, l:'On track', note:'green health band', cls:'g', tier:'secondary' },
    { v: videosProd, l:'Videos in production', note:'not yet delivered', tier:'secondary' },
    { v: videosWait, l:'Videos waiting', note:'blocked on client', cls: videosWait? 'a':'', tier:'secondary' },
    { v: videosOver, l:'Videos overdue', note:'SLA exceeded', cls: videosOver? 'r':'', tier:'secondary' },
    { v: connIssues, l:'Data connections', note: connIssues ? connNoteParts.join(' · ') : 'all sources flowing', cls: connErrors? 'r' : connIssues? 'a':'g', tier:'secondary' },
    { v: (opsData.pendingAccounts||[]).length, l:'Account requests', note: (opsData.pendingAccounts||[]).length ? 'review in Team Controls → Access' : 'none waiting', cls: (opsData.pendingAccounts||[]).length? 'a':'', tier:'secondary' },
    { v: avgHealth, l:'Avg health score', note:'across filtered clients', tier:'secondary' },
  ];
  $('opsExecCards').innerHTML = cards.map(c=>`
    <div class="card ops-metric ops-metric-${c.tier}${c.cls? ' ops-metric-'+c.cls:''}">
      <div class="k">${esc(c.l)}</div>
      <div class="big">${esc(String(c.v))}</div>
      <div class="tgt">${esc(c.note)}</div>
    </div>`).join('');
  const feed = $('opsAttentionFeed');
  feed.innerHTML = attentionList.length
    ? attentionList.map(a=> renderOpsAlertItem(a)).join('')
    : '<p class="note ops-empty-note">No priorities flagged — everything looks on track.</p>';
  wireOpsAttentionList(feed);
  // KPI rollup — selected reporting month across all clients
  const monthly = aggregateCompanyKpiByMonth(opsData.kpiRaw);
  const latestPeriod = monthly.length ? monthly[monthly.length-1].period : null;
  const allMonthsView = isAllMonthsSel(opsCompanyPeriod);
  const viewPeriod = allMonthsView ? latestPeriod : (opsCompanyPeriod || latestPeriod);
  const monthIdx = monthly.findIndex(r=> String(r.period)===String(viewPeriod));
  const agg = monthIdx >= 0 ? monthly[monthIdx] : { spend:0, reach:0, impr:0, clicks:0, cons:0, proc:0, ctr:null, cpc:null, cpm:null };
  const prevMonth = monthIdx > 0 ? monthly[monthIdx-1] : null;
  const isLive = !allMonthsView && latestPeriod && String(viewPeriod)===String(latestPeriod);
  const rangeSummary = allMonthsView ? summarizeKpiRange(monthly) : null;
  buildOpsMonthPicker(monthly, viewPeriod, latestPeriod);
  $('opsKpiPeriod').textContent = monthly.length
    ? (allMonthsView
      ? `All months · ${rangeSummary?.monthCount||0} reported · company-wide cumulative KPIs across all channels`
      : `${isLive ? 'Live' : 'Archived snapshot'} · ${periodLabel(viewPeriod)} · sum of every client's KPIs across all channels for this month`)
    : 'No KPI data yet across clients.';
  const rollup = allMonthsView && rangeSummary ? rangeSummary.totals : agg;
  const trendCur = allMonthsView ? null : agg;
  const trendPrev = allMonthsView ? null : prevMonth;
  const ctrV = allMonthsView ? (rollup.impr ? rollup.clicks/rollup.impr : null) : agg.ctr;
  const cpcV = allMonthsView ? (rollup.clicks ? rollup.spend/rollup.clicks : null) : agg.cpc;
  const cpmV = allMonthsView ? (rollup.impr ? rollup.spend/(rollup.impr/1000) : null) : agg.cpm;
  const kpiCards = [
    { l:'Total reach', v: fmtNum(rollup.reach), trend: allMonthsView ? null : opsKpiTrend(trendCur, trendPrev, 'reach') },
    { l:'Total impressions', v: fmtNum(rollup.impr), trend: allMonthsView ? null : opsKpiTrend(trendCur, trendPrev, 'impr') },
    { l:'Total spend', v: fmt$(rollup.spend), trend: allMonthsView ? null : opsKpiTrend(trendCur, trendPrev, 'spend', { lowerBetter:true }) },
    { l:'Link clicks', v: fmtNum(rollup.clicks), trend: allMonthsView ? null : opsKpiTrend(trendCur, trendPrev, 'clicks') },
    ctrV!=null ? { l:'Avg CTR', v: fmtP(ctrV), trend: allMonthsView ? null : opsKpiTrend(trendCur, trendPrev, 'ctr') } : null,
    cpcV!=null ? { l:'Avg CPC', v: fmt$(cpcV), trend: allMonthsView ? null : opsKpiTrend(trendCur, trendPrev, 'cpc', { lowerBetter:true }) } : null,
    cpmV!=null ? { l:'Avg CPM', v: fmt$(cpmV), trend: allMonthsView ? null : opsKpiTrend(trendCur, trendPrev, 'cpm', { lowerBetter:true }) } : null,
    N(rollup,'cons') ? { l:'Total consults', v: fmtNum(rollup.cons), trend: allMonthsView ? null : opsKpiTrend(trendCur, trendPrev, 'cons') } : null,
    N(rollup,'proc') ? { l:'Total procedures', v: fmtNum(rollup.proc), trend: allMonthsView ? null : opsKpiTrend(trendCur, trendPrev, 'proc') } : null,
  ].filter(Boolean);
  $('opsKpiRollup').innerHTML = kpiCards.map(c=>`
    <div class="card ops-metric ops-metric-secondary">
      <div class="k">${esc(c.l)}</div>
      <div class="big">${esc(c.v)}</div>
      ${c.trend ? `<div class="ops-trend ${c.trend.cls}">${esc(c.trend.text)}${c.trend.note ? ` <span class="ops-trend-note">${esc(c.trend.note)}</span>`:''}</div>` : ''}
    </div>`).join('');
  renderOpsCompanyKpi(viewPeriod, isLive, { allMonths: allMonthsView });
  // Client overview — unified search + expandable inline edits
  const clientQ = opsClientFilter.trim().toLowerCase();
  let overviewRows = healthRows.filter(r=> opsClientMatchesFilter(r, clientQ));
  overviewRows.sort((a,b)=> opsClientSortAsc
    ? a.p.name.localeCompare(b.p.name)
    : b.p.name.localeCompare(a.p.name));
  if(opsExpandedClient && !overviewRows.some(r=> r.p.id===opsExpandedClient)){
    opsExpandedClient = null;
  }
  const urgentStrip = alerts.filter(a=> a.severity!=='green').slice(0, 8);
  const stripEl = $('opsUrgentStrip');
  if(stripEl){
    stripEl.innerHTML = urgentStrip.length
      ? urgentStrip.map(a=>`<button type="button" class="ops-urgent-chip ops-urgent-${a.severity}" data-ops-link="1" data-ops-pid="${a.practiceId}" data-ops-view="${a.linkView||'roadmap'}"${a.delivId? ` data-ops-deliv="${a.delivId}"`:''}${a.videoId? ` data-ops-video="${a.videoId}"`:''}${a.phase? ` data-ops-phase="${esc(a.phase)}"`:''}${a.milestoneId? ` data-ops-ms="${a.milestoneId}"`:''}>
        <span class="ops-urgent-practice">${esc(a.practice)}</span>
        <span class="ops-urgent-title">${esc(a.title)}</span>
      </button>`).join('')
      : '<p class="note">No urgent items in the current filter.</p>';
    wireOpsDeepLinks(stripEl);
  }
  const overviewEl = $('opsClientOverview');
  if(overviewEl){
    overviewEl.innerHTML = overviewRows.length
      ? overviewRows.map(r=>{
        const expanded = opsExpandedClient === r.p.id;
        return `<div class="ops-client-block${expanded?' expanded':''}">
          <button type="button" class="ops-client-head" data-expand-client="${r.p.id}" aria-expanded="${expanded?'true':'false'}">
            <span class="ops-client-caret" aria-hidden="true">${expanded?'▾':'▸'}</span>
            <span class="ops-client-name">${esc(r.p.name)}</span>
            <span class="ops-pill ops-pill-${r.h.band}">${r.h.score}</span>
            <span class="ops-client-meta" title="${esc(r.phase.currentPhase||'')}">${esc(opsPhaseShortLabel(r.phase.currentPhase))} · ${r.openDeliv} deliv · ${r.openVid} video${r.waitingVid? ` · ${r.waitingVid} waiting`:''}</span>
            <span class="ops-client-next">${r.nextDue? 'Next due '+fmtDate(r.nextDue):'No due dates set'}</span>
          </button>
          ${expanded ? renderOpsClientDetail(r) : ''}
        </div>`;
      }).join('')
      : '<p class="note">No clients match your search.</p>';
    overviewEl.querySelectorAll('[data-expand-client]').forEach(btn=>{
      btn.onclick = ()=>{
        const id = btn.dataset.expandClient;
        opsExpandedClient = opsExpandedClient === id ? null : id;
        renderOperationsDashboard();
      };
    });
    wireOpsClientEdits(overviewEl);
    wireOpsDeepLinks(overviewEl);
    overviewEl.querySelectorAll('.ops-open-client').forEach(btn=>{
      btn.onclick = ()=> openOpsDeepLink({ practiceId: btn.dataset.opsPid, view: 'roadmap' });
    });
  }
  const countEl = $('opsClientCount');
  if(countEl) countEl.textContent = `${overviewRows.length} client${overviewRows.length===1?'':'s'}${clientQ? ' matching search':''}`;
}
// Delivery accountability — quantify execution per client the way response time
// quantifies a front office: shipped volume, on-time rate, and what's aging.
// Uses only columns the ops loader already fetches (due / delivered_at /
// status / status_since) — no schema change.
async function loadOperationsData(force){
  if(!isTeamView()) return;
  if(opsLoadPromise && !force) return opsLoadPromise;
  opsLoadPromise = (async()=>{
    try{
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setMonth(monthStart.getMonth()-24);
      const dayCutoff = monthStart.toISOString().slice(0,10);
      const [practices, deliverables, milestones, videos, kpiRaw, kpiDaily, sources] = await Promise.all([
        sb.from('practices').select('id,name,go_live,workbook_sheet_id,created_at').order('name'),
        sb.from('deliverables').select('id,practice_id,phase,phase_order,name,owner_seat,status,due,delivered_at,status_since,sort'),
        sb.from('milestones').select('id,practice_id,name,status,target_date,completed_on,sort,phase'),
        sb.from('video_pipeline').select('id,practice_id,item,stage,blocked,blocked_reason,stage_since,planned_shoot_date,sort'),
        sb.from('kpi_monthly').select('practice_id,period,source,spend,reach,impr,clicks,cons,proc,updated_at'),
        sb.from('kpi_daily').select('practice_id,day,source,spend,reach,impr,clicks,updated_at').gte('day', dayCutoff),
        // '*' so the access-state columns (marketing-connections migration) ride
        // along when present without breaking on databases that predate them.
        sb.from('sheet_sources').select('*'),
      ]);
      // Marketing OAuth connections (fail-soft on pre-migration DBs) — feeds the
      // connection-failure alerts in Needs Attention.
      let platformConns = [];
      try{
        const { data: pc, error: pcErr } = await sb.from('platform_connections')
          .select('practice_id,provider,status,last_error,last_synced_at');
        if(!pcErr && Array.isArray(pc)) platformConns = pc;
      }catch(_){ /* pre-migration DB */ }
      // Pending self-service account requests (fail-soft on pre-migration DBs).
      let pendingAccounts = [];
      try{
        const { data: pa, error: paErr } = await sb.rpc('get_pending_accounts');
        if(!paErr && Array.isArray(pa)) pendingAccounts = pa.filter(a=> a.status==='pending');
      }catch(_){ /* migration not applied yet */ }
      opsData = {
        practices: practices.data||[],
        deliverables: deliverables.data||[],
        milestones: milestones.data||[],
        videos: videos.data||[],
        kpiRaw: kpiRaw.data||[],
        kpiDailyRaw: kpiDaily.error ? [] : (kpiDaily.data||[]),
        sources: sources.data||[],
        connections: platformConns,
        pendingAccounts,
      };
      renderOperationsDashboard();
    }catch(e){
      console.error('[ops] load failed', e);
      $('opsAttentionFeed').innerHTML = '<p class="note">Could not load operations data. Try refreshing.</p>';
    }finally{
      opsLoadPromise = null;
    }
  })();
  return opsLoadPromise;
}
function wireOpsSearch(){
  const clientEl = $('opsClientSearch');
  if(clientEl && !clientEl._wired){
    clientEl._wired = true;
    clientEl.addEventListener('input', ()=>{
      opsClientFilter = (clientEl.value||'').trim().toLowerCase();
      if(opsClientFilter && !opsExpandedClient){
        const practices = opsData?.practices || [];
        const rows = practices.map(p=>{
          const delivs = (opsData?.deliverables||[]).filter(d=> d.practice_id===p.id);
          const videos = (opsData?.videos||[]).filter(v=> v.practice_id===p.id);
          const h = computeClientHealth(p, delivs, videos);
          return { p, h, phase: h.phase, marketing:'', milestones: (opsData?.milestones||[]).filter(m=> m.practice_id===p.id) };
        });
        const match = rows.find(r=> opsClientMatchesFilter(r, opsClientFilter));
        if(match) opsExpandedClient = match.p.id;
      }
      renderOperationsDashboard();
    });
  }
  const sortBtn = $('opsClientSort');
  if(sortBtn && !sortBtn._wired){
    sortBtn._wired = true;
    sortBtn.addEventListener('click', ()=>{
      opsClientSortAsc = !opsClientSortAsc;
      sortBtn.textContent = opsClientSortAsc ? 'A → Z' : 'Z → A';
      sortBtn.setAttribute('aria-pressed', opsClientSortAsc ? 'true' : 'false');
      renderOperationsDashboard();
    });
  }
}
wireOpsSearch();

/* ---- ONBOARDING & ACCESS (Team Controls + client owners) ---- */
const onbFlash = (t, ok)=>{ const el=$('onbMsg'); if(el){ el.textContent=t; el.classList.toggle('onb-ok', !!ok); setTimeout(()=>{ if(el.textContent===t){ el.textContent=''; el.classList.remove('onb-ok'); } }, 9000); } };
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

// Supabase functions.invoke gives a generic "Edge Function returned a non-2xx
// status code" on failure — dig the function's real {error} message out of the
// response body so the user sees what actually went wrong.
async function fnErrorMessage(error, fallback = 'Request failed'){
  if(!error) return fallback;
  try{ const b = await error.context?.json?.(); if(b?.error) return b.error; }catch(_){ }
  return error.message || fallback;
}

async function sendPracticeInvite(practice_id, email, full_name, role, { sendEmail = true } = {}){
  if(sendEmail){
    const { data, error } = await sb.functions.invoke('invite-user', {
      body: { email, practice_id, full_name, role }
    });
    if(error) throw new Error(await fnErrorMessage(error, 'Invite failed'));
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
      <span class="rosterrole">${esc(roleLabel(m.role))}</span>
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
      <span class="rosterrole">${esc(roleLabel(i.role))}</span>
      <span class="rosterstatus">${esc(i.status)}</span>
      ${revokeBtn}
    </div>`;
  }).join('');
  wrap.innerHTML = `<div class="rosterhead"><span>Email</span><span>Role</span><span>Status</span><span></span></div>`
    + memRows + invRows;
  if(opts.canRemove){
    wrap.querySelectorAll('[data-rmuser]').forEach(b=> b.onclick = async ()=>{
      if(!await uiConfirm('Remove member',
        'This removes their access to this practice. They can be re-invited anytime. (To delete the account and its login entirely, use “Delete selected client”.)',
        {danger:true, confirmLabel:'Remove'})) return;
      // remove_practice_member revokes membership + the invite. It works for
      // practice OWNERS and team (delete-account is team-only, which is why routing
      // removal through it broke owners). Full auth deletion stays a team-only
      // "Delete client" action.
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
    if(!await uiConfirm('Remove platform admin', 'This person will lose access to Team Controls. Continue?', {danger:true})) return;
    const { error } = await sb.rpc('demote_platform_admin', { p_user: b.dataset.demote });
    if(error) uiAlert('Cannot remove admin', esc(error.message));
    else { onbFlash('Administrator access removed.'); loadPlatformAdmins(); }
  });
}

// Account approvals — self-service sign-ups waiting for review. Approving
// assigns a practice (creating the membership auto-approves the profile via
// the DB trigger); "send welcome email" routes through the invite-user
// function so the doctor also gets the branded sign-in email.
async function loadAccountApprovals(){
  const wrap = $('accountApprovals'); if(!wrap || !isTeamView()) return;
  const { data, error } = await sb.rpc('get_pending_accounts');
  if(error){
    wrap.innerHTML = '<div class="note">Run migration 2026-07-09_account_approvals.sql to enable account approvals.</div>';
    return;
  }
  if(!data || !data.length){
    wrap.innerHTML = '<div class="note">No pending account requests — invited users are approved automatically.</div>';
    return;
  }
  const praxOpts = '<option value="">— Assign practice —</option>'
    + (practicesList||[]).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  wrap.innerHTML = `
    <label class="checklabel" style="display:block;margin-bottom:10px"><input type="checkbox" id="apprSendEmail" checked> Send welcome email on approval</label>
    ${data.map(r=>`<div class="apprrow" data-uid="${esc(r.id)}">
      <div class="apprwho">
        <div class="apprname">${esc(r.full_name || r.email)}</div>
        <div class="note">${esc(r.email)} · signed up ${esc(prettyDate(r.requested_at))} · <span class="${r.status==='rejected'?'ssbad':'sswarn'}">${esc(r.status)}</span></div>
      </div>
      <select class="picker apprpractice" title="Practice to assign (create it in the Clients tab first if it's new)">${praxOpts}</select>
      <select class="picker apprrole"><option value="member">Member</option><option value="owner">Owner</option></select>
      <button class="btn sm apprapprove">Approve</button>
      <button class="btn ghost sm danger apprreject">Reject</button>
    </div>`).join('')}`;
  enhanceSelectsIn(wrap);   // theme the practice / role dropdowns like the rest of the site
  wrap.querySelectorAll('.apprrow').forEach(row=>{
    const uid = row.dataset.uid;
    const rec = (data||[]).find(x=> x.id===uid);
    row.querySelector('.apprapprove').onclick = async ()=>{
      const pid = row.querySelector('.apprpractice').value;
      const role = row.querySelector('.apprrole').value || 'member';
      if(!pid){ uiAlert('Assign a practice first', 'Pick which practice this account belongs to. If the practice doesn\'t exist yet, create it in the <b>Clients</b> tab, then approve.'); return; }
      const btn = row.querySelector('.apprapprove');
      btn.disabled = true; btn.textContent = 'Approving…';
      try{
        if($('apprSendEmail')?.checked){
          await sendPracticeInvite(pid, rec.email, rec.full_name || null, role, { sendEmail:true });
          // invite-user creates the membership; the DB trigger flips the profile
          // to approved. Belt-and-braces in case of older function deploys:
          await sb.rpc('approve_account', { p_user: uid, p_practice: pid, p_role: role });
        } else {
          const { data: res, error: aerr } = await sb.rpc('approve_account', { p_user: uid, p_practice: pid, p_role: role });
          if(aerr || res?.ok === false) throw new Error(aerr?.message || res?.error || 'approve failed');
        }
        loadAccountApprovals();
        loadAccessRoster($('accessPractice')?.value);
      }catch(e){
        uiAlert('Approve failed', esc(e.message||String(e)));
        btn.disabled = false; btn.textContent = 'Approve';
      }
    };
    row.querySelector('.apprreject').onclick = async ()=>{
      const ok = await uiConfirm('Reject this account?',
        `<b>${esc(rec.email)}</b> will see "access not approved" when they sign in. You can still approve them later.`,
        { danger:true, confirmLabel:'Reject' });
      if(!ok) return;
      const { error: rerr } = await sb.rpc('reject_account', { p_user: uid });
      if(rerr) uiAlert('Reject failed', esc(rerr.message)); else loadAccountApprovals();
    };
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
  const wrap = $('accessRoster'); if(!wrap) return;
  if(!pid){
    wrap.innerHTML = '<div class="note">Select a client above to view and manage access.</div>';
    return;
  }
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
    if(data){ practiceId = data; resetPracticeUiState(); showOnboardChecklist(data, name); }
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
    const pname = (practicesList||[]).find(p=> p.id===practice_id)?.name || 'the practice';
    $('accessEmail').value=''; $('accessName').value='';
    if(sendEmail && data?.emailed === false){
      onbFlash(`${email} is set up and has access to ${pname} — but the invite email didn't send (${esc(data?.email_note||'email not configured yet')}). Finish email setup to deliver sign-in links.`, false);
    } else {
      onbFlash(sendEmail
        ? (data?.invited===false
            ? `✓ ${email} already had an account — linked to ${pname} and emailed a sign-in link.`
            : `✓ Invite sent — ${email} was emailed a sign-in link and added to ${pname}. They now appear in the list below.`)
        : `✓ ${email} allowlisted for ${pname} — they can sign up with that email anytime.`, true);
    }
    loadAccessRoster(practice_id);
    refreshOnboardChecklist(practice_id);
  }catch(e){
    onbFlash('Invite failed: '+(e.message||e)+(sendEmail ? ' (is invite-user deployed?)' : ''));
  }finally{ $('btnInvite').disabled = false; }
};


$('btnDeleteAccessClient')?.addEventListener('click', async ()=>{
  if(!isTeamView()) return;
  const pid = $('accessPractice')?.value;
  const p = (practicesList||[]).find(x=> x.id===pid);
  if(!p){
    const el=$('accessDelMsg'); if(el) el.textContent='Select a practice in the dropdown above first.';
    return;
  }
  await deletePractice(p.id, p.name, { flash: t=>{ const el=$('accessDelMsg'); if(el) el.textContent=t; } });
});

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
const deployFlashByPractice = {};
function setDeployMsg(pid, text, kind){
  clearTimeout(deployFlashByPractice[pid]?._timer);
  if(!text) delete deployFlashByPractice[pid];
  else{
    deployFlashByPractice[pid] = { text, kind };
    if(kind==='ok' || kind==='err'){
      deployFlashByPractice[pid]._timer = setTimeout(()=>{
        delete deployFlashByPractice[pid];
        const el = document.getElementById('deploy-msg-'+pid);
        if(el){ el.textContent=''; el.className='deploy-msg'; }
      }, kind==='ok' ? 10000 : 14000);
    }
  }
  const el = document.getElementById('deploy-msg-'+pid);
  if(el){
    el.textContent = text || '';
    el.className = 'deploy-msg' + (kind ? ' '+kind : '');
  }
}
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
// Sync freshness band. The automation runs every 2 hours, so a healthy source is
// never more than a few hours old: ok <6h · warn 6–26h (missed runs) · bad >26h
// (a full day without data). Returns null when there's no timestamp at all.
function syncAge(ts){
  if(!ts) return null;
  const then = new Date(ts).getTime(); if(!isFinite(then)) return null;
  const h = (Date.now()-then)/3600000;
  const cls = h < 6 ? 'ok' : h <= 26 ? 'warn' : 'bad';
  return { cls, hours: h, label: ago(ts), stale: cls!=='ok' };
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
    const parts = [`Synced ${data2.upserted ?? 0} row(s)`];
    const months = monthsList(data2.months_seen);
    if(months) parts.push(`months: ${months}`);
    // surface WHY rows were missed: per-source skipped daily-row counts + sample reasons
    const missed = [];
    (data2.reports||[]).forEach(r=>{
      if(r && r.skipped_rows){
        const samp = [...new Set((r.skipped_samples||[]).map(x=> x && (x.reason + (x.value!=null ? ` (${x.value})` : ''))).filter(Boolean))].slice(0,2);
        missed.push(`${r.skipped_rows} row(s) skipped${samp.length ? ' — '+samp.join('; ') : ''}`);
      }
    });
    (data2.skipped||[]).forEach(s=>{ if(s && s.reason && s.skipped_rows==null) missed.push(s.reason); });
    if(missed.length) parts.push(missed.slice(0,3).join(' · '));
    else if(data2.skipped_count) parts.push(`skipped ${data2.skipped_count}`);
    if(data2.rows_seen === 0 && !missed.length){
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
  const age = syncAge(s.last_synced_at);
  // Access state machine (present only once the marketing-connections migration ran).
  const hasAccessCol = ('access_status' in s);
  const acc = s.access_status || 'connected';
  // Access-state control (Requested/Granted/Connected) removed from the reporting
  // workbook — sources just show their sync status.
  const accSel = '';
  const notSynced = `<span class="note">not synced</span>`;
  const status = s.last_status==='error'
      ? `<span class="ssbad" title="${esc(s.last_error||'')}">⚠ error${age?` · ${esc(age.label)}`:''}</span>`
    : age
      ? (age.stale
          ? `<span class="${age.cls==='bad'?'ssbad':'sswarn'}" title="${esc(new Date(s.last_synced_at).toLocaleString())}">⚠ stale · ${esc(age.label)}${esc(dtxt)}</span>`
          : `<span class="ssok" title="${esc(new Date(s.last_synced_at).toLocaleString())}">✓ ${esc(age.label)}${esc(dtxt)}</span>`)
    : notSynced;
  return `<div class="srcrow${accSel?' has-access':''}">
    <span class="chanlabel srcname">${esc(channelLabel(source))}</span>
    <select class="cellinput sheettab" data-pid="${pid}" data-source="${esc(source)}" title="Pick this source's tab">${tabOptions(pid, s.tab_name)}</select>
    ${accSel}
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
      <span class="deploy-msg${deployFlashByPractice[pid]?.kind ? ' '+deployFlashByPractice[pid].kind : ''}" id="deploy-msg-${pid}">${deployFlashByPractice[pid]?.text ? esc(deployFlashByPractice[pid].text) : ''}</span>
      <span class="note deploy-hint">Saves tab mappings &amp; runs sync to confirm.</span>
    </div>
  </div>`;
}
// Reporting tab · filter + sort helpers (many clients → find a surgeon without scrolling)
let reportingListWired = false;
let adminClientSort = 'name-asc';
try{ adminClientSort = sessionStorage.getItem('roxium_admin_client_sort') || 'name-asc'; }catch(_){}

function practiceReportingMeta(p){
  const pid = p.id;
  const sources = Object.values(sheetSources).filter(s=> s.practice_id===pid);
  const hasWorkbook = !!(p.workbook_sheet_id && p.workbook_sheet_id.trim());
  const mapped = sources.filter(s=> (s.tab_name||'').trim()).length;
  const hasError = sources.some(s=> s.last_status==='error');
  const lastSync = sources.map(s=> s.last_synced_at).filter(Boolean).sort().pop() || null;
  let setupRank = 5;
  if(!hasWorkbook) setupRank = 0;
  else if(!sources.length) setupRank = 1;
  else if(mapped < sources.length) setupRank = 2;
  else if(hasError) setupRank = 3;
  else if(!lastSync) setupRank = 4;
  return {
    name: (p.name||'').toLowerCase(),
    hasWorkbook, hasError, lastSync, setupRank,
    needsSetup: setupRank < 5,
  };
}
function adminClientListFiltered(){
  const q = ($('reportingClientSearch')?.value || '').trim().toLowerCase();
  const sort = $('reportingClientSort')?.value || adminClientSort || 'name-asc';
  let list = [...(practicesList || [])];
  if(q) list = list.filter(p=> (p.name||'').toLowerCase().includes(q));
  list.sort((a,b)=>{
    const ma = practiceReportingMeta(a), mb = practiceReportingMeta(b);
    switch(sort){
      case 'name-desc': return mb.name.localeCompare(ma.name) || a.name.localeCompare(b.name);
      case 'setup-first': return ma.setupRank - mb.setupRank || ma.name.localeCompare(mb.name);
      case 'errors-first':
        return (mb.hasError?1:0) - (ma.hasError?1:0) || ma.setupRank - mb.setupRank || ma.name.localeCompare(mb.name);
      default: return ma.name.localeCompare(mb.name);
    }
  });
  return { list, total: (practicesList||[]).length, query: q };
}
function wireReportingListControls(){
  if(reportingListWired) return;
  reportingListWired = true;
  const search = $('reportingClientSearch');
  const sort = $('reportingClientSort');
  if(sort){
    sort.value = adminClientSort;
    sort.addEventListener('change', ()=>{
      adminClientSort = sort.value;
      try{ sessionStorage.setItem('roxium_admin_client_sort', adminClientSort); }catch(_){}
      renderAdminClients();
    });
    enhanceNativeSelect(sort);
  }
  search?.addEventListener('input', ()=> renderAdminClients());
  search?.addEventListener('keydown', e=>{ if(e.key==='Escape'){ search.value=''; renderAdminClients(); search.blur(); } });
}
function renderAdminClients(){
  const wrap = $('adminClientList'); if(!wrap) return;
  if(!isTeamView()){ wrap.innerHTML=''; return; }
  wireReportingListControls();
  const { list, total, query } = adminClientListFiltered();
  const countEl = $('reportingClientCount');
  if(countEl){
    if(!total) countEl.textContent = '';
    else if(query) countEl.textContent = list.length === total
      ? `${total} client${total===1?'':'s'}`
      : `Showing ${list.length} of ${total} client${total===1?'':'s'}`;
    else countEl.textContent = `${total} client${total===1?'':'s'}`;
  }
  wrap.innerHTML = (list.length ? list.map(p=> `<div class="clientrow2">
      <div class="ccol"><span class="cname">${esc(p.name)}</span></div>
      ${clientWorkbookBlock(p)}
      ${clientSourcesHTML(p.id)}
    </div>`).join('') : (query
      ? '<div class="note">No clients match your search — try a different name.</div>'
      : '<div class="note">No practices yet — add one above.</div>'));
  wireAdminClients();
}
// (Re)bind all client-card handlers — called after a full render or a sources refresh.
function wireAdminClients(){
  const wrap = $('adminClientList'); if(!wrap) return;
  wrap.querySelectorAll('[data-saveworkbook]').forEach(b=> b.onclick = ()=> saveWorkbook(b.dataset.saveworkbook));
  wrap.querySelectorAll('[data-detecttabs]').forEach(b=> b.onclick = ()=> detectTabs(b.dataset.detecttabs));
  wrap.querySelectorAll('[data-findwb]').forEach(b=> b.onclick = ()=> findWorkbook(b.dataset.findwb, b.dataset.name));
  wrap.querySelectorAll('[data-delsource]').forEach(b=> b.onclick = ()=> removeSource(b.dataset.delsource, b.dataset.source));
  wrap.querySelectorAll('[data-addsource]').forEach(b=> b.onclick = ()=> addSource(b.dataset.addsource));
  wrap.querySelectorAll('[data-deploy]').forEach(b=> b.onclick = ()=> deployClient(b.dataset.deploy));
  // picking a tab from the dropdown saves that source mapping immediately
  wrap.querySelectorAll('select.sheettab').forEach(sel=> sel.onchange = ()=> saveSheetSource(sel.dataset.pid, sel.dataset.source));
  // access-state select saves immediately too (requested → granted → connected)
  wrap.querySelectorAll('select.accesssel').forEach(sel=> sel.onchange = ()=> saveAccessStatus(sel.dataset.pid, sel.dataset.source, sel.value));
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
  const btn = document.querySelector(`[data-deploy="${pid}"]`);
  if(btn) btn.disabled = true;
  setDeployMsg(pid, 'Deploying — running sync…', 'pending');
  try{
    const r = await invokeSyncFn({ action:'sync', trigger:'manual' });
    await loadSheetSources();
    const months = r.months_seen && r.months_seen.length ? ` · ${r.months_seen.join(', ')}` : '';
    setDeployMsg(pid, `✓ Sync successful · ${r.upserted ?? 0} row(s)${months}`, 'ok');
    refreshOnboardChecklist(pid);
    if(practiceId===pid) loadAll();
  }catch(e){
    setDeployMsg(pid, 'Sync failed: '+(e.message||String(e)), 'err');
  }finally{
    if(btn) btn.disabled = false;
  }
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

// Team Controls sub-tab switcher: Clients / Access & Invites / Reporting & KPI / System.
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
  if(!folder){ out.innerHTML = '<div class="note">Set the global <b>Master Reporting Drive Folder</b> under <b>Team Controls → System</b> first.</div>'; return; }
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
// Save a source's access state (requested → granted → connected). Selecting
// 'requested' stamps today as the request date so the portal can age the chase.
// (A source that is actually syncing is snapped back to 'connected' by the DB
// trigger — you can't un-connect data that is flowing.)
async function saveAccessStatus(pid, source, status){
  if(!isTeamView()) return;
  const patch = { access_status: status };
  if(status==='requested') patch.access_requested_at = new Date().toISOString().slice(0,10);
  const { error } = await sb.from('sheet_sources').update(patch)
    .eq('practice_id', pid).eq('source', source);
  if(error){
    adminDelFlash(/access_status/.test(error.message)
      ? 'Access states need the marketing-connections migration (migrations/2026-07-08_marketing_connections.sql).'
      : 'Save failed: '+error.message);
    return;
  }
  const k = ssKey(pid, source);
  if(sheetSources[k]) Object.assign(sheetSources[k], patch);
  adminDelFlash(`${channelLabel(source)} access: ${accessLabel(status)}.`);
  refreshClientSources(pid);
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
async function deletePractice(id, name, opts={}){
  if(!isTeamView()) return;
  const flash = opts.flash || adminDelFlash;
  const ok = await uiConfirm(`Delete “${name}”?`,
    `This permanently removes the practice and <b>all</b> of its data — KPIs, deliverables, roadmap, video pipeline, history, updates and its client logins. This cannot be undone.`,
    { danger:true, confirmLabel:'Delete practice', requireText:name });
  if(!ok) return;
  flash('Deleting…');
  try{
    // Route through the edge function so the clients' auth.users rows (and their
    // Composio connections) are actually removed — an RPC can't delete auth
    // users, which is what made "deleted" clients reappear as pending accounts.
    const { data: res, error } = await sb.functions.invoke('delete-account', { body: { practice_id: id } });
    if(error) throw new Error(await fnErrorMessage(error, 'delete failed'));
    if(res && res.ok === false) throw new Error(res.error || 'delete failed');
    delete selByPractice[id];
    delete chanByPractice[id];
    if(practiceId===id){ practiceId = null; }
    await loadTeamPractices();
    renderAdminClients();
    flash(`"${name}" was deleted.`);
    const ap = $('accessPractice');
    if(ap?.value) loadAccessRoster(ap.value);
    else if($('accessRoster')) $('accessRoster').innerHTML = '<div class="note">Select a client above to view and manage access.</div>';
    if(practiceId) loadAll();
  }catch(e){ flash('Delete failed: '+(e.message||e)); }
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
      <li><span class="chip promised">planned</span> Committed and scheduled — not started yet.</li>
      <li><span class="chip in_progress">in progress</span> Actively being worked on right now.</li>
      <li><span class="chip delivered">delivered</span> Completed and handed off.</li>
    </ul>
    <p>Where you see an <b>ⓘ</b> next to a deliverable, click it for a plain-English explanation of what that item is and why it matters.</p>`;
  btn.onclick = ()=> guide.classList.toggle('hidden');
})();

/* ---------------- command palette (team, ⌘K / Ctrl+K) ----------------
   One keystroke to anywhere: jump to a client, jump to a view, or run the
   reporting sync — without hunting through menus. Team-only (clients have a
   single practice and five tabs; a palette would be noise for them). */
(function(){
  let el = null, input = null, list = null, activeIdx = 0, open = false;
  function buildDom(){
    el = document.createElement('div');
    el.id = 'cmdk';
    el.className = 'cmdk hidden';
    el.innerHTML = `<div class="cmdk-box" role="dialog" aria-label="Command palette">
      <input class="cmdk-input" type="text" placeholder="Jump to a client, view, or action…" autocomplete="off" spellcheck="false">
      <div class="cmdk-list" role="listbox"></div>
      <div class="cmdk-hint">↑↓ navigate · Enter run · Esc close</div>
    </div>`;
    document.body.appendChild(el);
    input = el.querySelector('.cmdk-input');
    list = el.querySelector('.cmdk-list');
    el.addEventListener('click', e=>{ if(e.target===el) close(); });
    input.addEventListener('input', ()=> draw(input.value));
    input.addEventListener('keydown', e=>{
      const items = [...list.querySelectorAll('.cmdk-item')];
      if(e.key==='Escape'){ close(); }
      else if(e.key==='ArrowDown'){ activeIdx = Math.min(items.length-1, activeIdx+1); paint(items); e.preventDefault(); }
      else if(e.key==='ArrowUp'){ activeIdx = Math.max(0, activeIdx-1); paint(items); e.preventDefault(); }
      else if(e.key==='Enter'){ items[activeIdx]?.click(); e.preventDefault(); }
    });
  }
  function paint(items){
    items.forEach((b,i)=> b.classList.toggle('active', i===activeIdx));
    items[activeIdx]?.scrollIntoView({ block:'nearest' });
  }
  function commands(){
    const cmds = [];
    const team = me && me.role === 'team';
    // client portal views (available to everyone)
    [['overview','Overview'],['roadmap','Roadmap'],['deliverables','Progress / deliverables'],['video','Video pipeline'],['metrics','Metrics'],['updates','Timeline / updates']]
      .forEach(([v,l])=> cmds.push({ k:'view', label:l, run:()=>{ location.hash='#'+v; } }));
    if(canSeeConnectionsTab()) cmds.push({ k:'view', label:'Connections', run:()=>{ location.hash='#connections'; } });
    if(canSeeAccessTab()) cmds.push({ k:'view', label:'Invite team', run:()=>{ location.hash='#access'; } });
    if(team){
      // global team surfaces + actions + client switcher
      cmds.push({ k:'view', label:'Operations Dashboard', run:()=>{ location.hash='#operations'; } });
      cmds.push({ k:'view', label:'Team Controls', run:()=>{ location.hash='#controls'; } });
      cmds.push({ k:'view', label:'Client Controls', run:()=>{ location.hash='#team'; } });
      cmds.push({ k:'action', label:'Sync now — pull all reporting sources', run:async ()=>{
        try{ await invokeSyncFn({ action:'sync', trigger:'manual' }); await loadSheetSources(); if(currentView()==='operations') loadOperationsData(true); if(practiceId) loadAll(); }
        catch(e){ uiAlert('Sync failed', esc(e?.message||String(e))); }
      }});
      (practicesList||[]).forEach(p=> cmds.push({ k:'client', label:p.name, note: p.id===practiceId? 'current' : 'open client',
        run:()=>{ practiceId = p.id; updateSwitcherLabel(); if(!CLIENT_PORTAL_VIEWS.includes(currentView())) location.hash='#'+CLIENT_HOME; loadAll(); } }));
    }
    return cmds;
  }
  function draw(q){
    const ql = (q||'').trim().toLowerCase();
    const matches = commands().filter(c=> !ql || c.label.toLowerCase().includes(ql)).slice(0, 14);
    activeIdx = 0;
    list.innerHTML = matches.length ? matches.map(c=>
      `<button type="button" class="cmdk-item" role="option">
         <span class="cmdk-k cmdk-k-${c.k}">${c.k}</span>${esc(c.label)}${c.note? `<span class="cmdk-note">${esc(c.note)}</span>`:''}
       </button>`).join('')
      : '<div class="cmdk-empty">No matches</div>';
    const items = [...list.querySelectorAll('.cmdk-item')];
    items.forEach((b,i)=> b.onclick = ()=>{ close(); matches[i].run(); });
    paint(items);
  }
  function openPal(){
    if(!me) return;                 // available to clients + team (role-scoped commands)
    if(!el) buildDom();
    open = true;
    el.classList.remove('hidden');
    input.value = '';
    draw('');
    setTimeout(()=> input.focus(), 0);
  }
  function close(){ if(!el) return; open = false; el.classList.add('hidden'); }
  window.roxOpenPalette = openPal;   // top-bar Search button opens it too
  window.addEventListener('keydown', e=>{
    if((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase()==='k'){
      e.preventDefault();
      open ? close() : openPal();
    }
  });
})();

init();
