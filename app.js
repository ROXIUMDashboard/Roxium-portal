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
const STALE_DAYS = 14; // a card sitting this long in one stage flags red (team only)

let me = null;            // profile row
let practiceId = null;    // active practice
let previewMode = false;  // team viewing the client-side version
let metricsMonth = null;  // null = latest reported month; or a specific month number to view past data
let data = { kpi: [], deliv: [], miles: [], video: [], feed: [], vhist: [], practice: null };

// True only when the real user is team AND not previewing the client view.
function isTeamView(){ return me && me.role === 'team' && !previewMode; }

/* ---------------- auth ---------------- */
const $ = id => document.getElementById(id);

async function init(){
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ $('login').classList.remove('hidden'); return; }
  await afterLogin();
}
sb.auth.onAuthStateChange((_e, session)=>{ if(session && !me) afterLogin(); });

$('btnLogin').onclick = async ()=>{
  const email = $('loginEmail').value.trim();
  if(!email) return;
  const { error } = await sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: location.origin } });
  $('loginMsg').textContent = error ? error.message : 'Check your email for the sign-in link.';
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
    $('teamPanel').classList.remove('hidden');
    $('btnPreview').classList.remove('hidden');
    const { data: prax } = await sb.from('practices').select('*').order('name');
    const pick = $('practicePicker');
    pick.classList.remove('hidden');
    pick.innerHTML = (prax||[]).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    pick.onchange = ()=>{ practiceId = pick.value; loadAll(); };
    practiceId = prax && prax.length ? prax[0].id : null;
    $('btnPreview').onclick = ()=>{
      previewMode = !previewMode;
      $('btnPreview').textContent = previewMode ? 'Exit client preview' : 'Preview as client';
      $('btnPreview').classList.toggle('previewing', previewMode);
      $('whoami').textContent = (me.full_name||'') + ' · ' + (previewMode ? 'client preview' : me.role);
      render();
    };
  } else {
    practiceId = me.practice_id;
  }
  if(practiceId) loadAll();
}

/* ---------------- data ---------------- */
async function loadAll(){
  const [p,k,d,m,v,f,vh] = await Promise.all([
    sb.from('practices').select('*').eq('id', practiceId).single(),
    sb.from('kpi_monthly').select('*').eq('practice_id', practiceId).order('month'),
    sb.from('deliverables').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('milestones').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('video_pipeline').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('activity').select('*').eq('practice_id', practiceId).order('created_at',{ascending:false}).limit(12),
    sb.from('video_history').select('*').eq('practice_id', practiceId).order('moved_at'),
  ]);
  data = { practice:p.data, kpi:k.data||[], deliv:d.data||[], miles:m.data||[], video:v.data||[], feed:f.data||[], vhist:vh.data||[] };
  render();
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
  $('heroTitle').innerHTML = (data.practice? data.practice.name : 'Your practice') + ': where you are, <em>exactly.</em>';
  const reported = [...data.kpi].sort((a,b)=>b.month-a.month);
  const latestMonth = reported.length? reported[0].month : null;
  // metricsMonth null = follow latest; otherwise show the chosen past month
  const viewMonth = (metricsMonth!=null && data.kpi.some(x=>x.month===metricsMonth)) ? metricsMonth : latestMonth;
  const latest = viewMonth!=null ? data.kpi.find(x=>x.month===viewMonth) : null;
  const d = derive(latest);
  $('updated').textContent = latest
    ? `Showing Month ${latest.month}${viewMonth===latestMonth?' (latest)':''} · KPI data live from Supabase`
    : 'KPI data will appear here after the first month is reported.';
  // build the month selector (latest + any reported months)
  buildMetricsPicker(reported, viewMonth, latestMonth);
  $('kpiSub').textContent = latest? `Month ${latest.month} against target.` : 'Latest month against target.';

  // hero stats
  const delivered = data.deliv.filter(x=>x.status==='delivered').length;
  const heroes = [
    {v: d? fmt$(d.cpl):'—', l:'Cost per lead', cls: statusCPL(d? d.cpl:0), note: latest? 'this month':'awaiting data'},
    {v: latest? (+latest.cons||0).toLocaleString():'—', l:'Consults this month', cls: latest?'g':'i', note: d? fmt$(d.rev)+' est. revenue':'awaiting data'},
    {v: data.deliv.length? `${delivered}/${data.deliv.length}`:'—', l:'Deliverables shipped', cls: delivered? 'g':'i', note:'promised vs delivered'},
    {v: latest&&latest.price? (+latest.price).toFixed(2)+'×':'—', l:'Pricing index', cls: latest&&+latest.price>=1.5?'g':'i', note: latest? 'vs. starting baseline':'awaiting data'},
  ];
  $('heroStats').innerHTML = heroes.map(h=>
    `<div class="stat"><div class="v">${h.v}</div><div class="l">${h.l}</div><div class="d ${({g:'good',a:'warn',r:'bad',i:'idle'})[h.cls]}">${h.note}</div></div>`).join('');

  // timeline
  const isTeam = isTeamView();
  renderTimeline(isTeam);

  // deliverables
  const pct = data.deliv.length? Math.round(100*delivered/data.deliv.length):0;
  $('delivSub').textContent = data.deliv.length? `${delivered} of ${data.deliv.length} deliverables shipped (${pct}%).` : 'Deliverables will be loaded at kickoff.';
  $('delivBar').style.width = pct+'%';
  renderDeliverables(isTeam);

  // video pipeline
  renderPipeline(isTeam);

  // KPI cards + status board
  const cards = [
    {k:'Leads captured', v: latest? (+latest.leads||0).toLocaleString():'—', t:'monthly volume'},
    {k:'LP conversion', v: d? fmtP(d.cvr):'—', t:'leads ÷ page visits'},
    {k:'Cost per consult', v: d? fmt$(d.cpc):'—', t:'spend ÷ consults'},
    {k:'ROAS', v: d&&d.roas? d.roas.toFixed(1)+'×':'—', t:'revenue ÷ spend'},
  ];
  $('kpiCards').innerHTML = cards.map(c=>`<div class="card"><div class="k">${c.k}</div><div class="big">${c.v}</div><div class="tgt">${c.t}</div></div>`).join('');
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

  // feed
  $('feed').innerHTML = data.feed.length? data.feed.map(f=>
    `<div class="fitem">${f.message}<div class="meta">${f.author||'ROXIUM'} · ${new Date(f.created_at).toLocaleDateString()} · ${f.source}</div></div>`).join('')
    : '<p class="note">No updates yet.</p>';

  // team panel + controls only when team AND not previewing as client
  $('teamPanel').classList.toggle('hidden', !isTeamView());
  if(isTeamView()) renderTeam(latest);
}

/* Month selector for performance metrics: 'Latest' + each reported month */
function buildMetricsPicker(reported, viewMonth, latestMonth){
  const sel = $('metricsPicker');
  if(!sel) return;
  if(!reported.length){ sel.style.display='none'; return; }
  sel.style.display='';
  const opts = ['<option value="">Latest month</option>']
    .concat(reported.slice().sort((a,b)=>a.month-b.month).map(r=>
      `<option value="${r.month}">Month ${r.month}${r.month===latestMonth?' (latest)':''}</option>`));
  sel.innerHTML = opts.join('');
  sel.value = (metricsMonth!=null) ? String(metricsMonth) : '';
  sel.onchange = ()=>{ metricsMonth = sel.value===''? null : +sel.value; render(); };
}

/* ---------------- team controls ---------------- */
let entryMonth = 1;  // remembers which month the team is editing, survives re-renders
function renderTeam(){
  const sel = $('inMonth');
  // build options once; preserve the current selection on every later render
  if(sel.options.length !== 12){
    sel.innerHTML = Array.from({length:12},(_,i)=>`<option value="${i+1}">Month ${i+1}</option>`).join('');
    sel.onchange = ()=>{ entryMonth = +sel.value; fillKpiForm(); };
  }
  sel.value = entryMonth;       // restore the month the team was on
  fillKpiForm();
}
function fillKpiForm(){
  const m = data.kpi.find(x=>x.month===entryMonth) || {};
  $('entryFields').innerHTML = FIELDS.map(f=>
    `<div class="f"><label>${f.l}</label><input data-k="${f.k}" type="number" step="any" value="${m[f.k]??''}" placeholder="0"></div>`).join('');
}
const flash = t=>{ $('saveMsg').textContent=t; setTimeout(()=>$('saveMsg').textContent='',3500); };

$('btnSaveKpi').onclick = async ()=>{
  const row = { practice_id: practiceId, month: entryMonth, updated_at: new Date().toISOString() };
  document.querySelectorAll('#entryFields input').forEach(i=>{ row[i.dataset.k] = i.value===''? null : +i.value; });
  const { error } = await sb.from('kpi_monthly').upsert(row, { onConflict:'practice_id,month' });
  flash(error? error.message : 'Saved.'); if(!error) loadAll();
};

$('xlsxFile').onchange = async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  try{
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets['Dashboard']; if(!ws) throw new Error('No "Dashboard" sheet');
    const grid = XLSX.utils.sheet_to_json(ws,{header:1,raw:true});
    const byLabel = {}; grid.forEach(r=>{ if(r&&r[0]) byLabel[String(r[0]).trim()]=r; });
    const rows = [];
    for(let mIdx=0;mIdx<12;mIdx++){
      const row = { practice_id: practiceId, month: mIdx+1 };
      let any=false;
      Object.entries(XL_MAP).forEach(([label,key])=>{
        const r = byLabel[label]; if(!r) return;
        const v = r[4+mIdx];
        if(typeof v==='number' && !isNaN(v)){ row[key]=v; any=true; }
      });
      if(any) rows.push(row);
    }
    if(!rows.length) throw new Error('No monthly values found');
    const { error } = await sb.from('kpi_monthly').upsert(rows, { onConflict:'practice_id,month' });
    flash(error? error.message : `Imported ${rows.length} month(s) from workbook.`);
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

/* ---- DELIVERABLES ---- */
function renderDeliverables(isTeam){
  const t = $('delivTable');
  if(isTeam){
    const head = '<tr><th>Phase</th><th>Deliverable</th><th>Owner</th><th>Status</th><th></th></tr>';
    const rows = data.deliv.map(x=>`<tr data-id="${x.id}">
      <td><input class="cellinput" data-f="phase" value="${esc(x.phase)}"></td>
      <td><input class="cellinput" data-f="name" value="${esc(x.name)}"></td>
      <td><input class="cellinput owner" data-f="owner_seat" value="${esc(x.owner_seat||'')}" placeholder="—"></td>
      <td>${statusSelect('deliv', x.status)}</td>
      <td><button class="rowdel" title="Delete">✕</button></td></tr>`).join('');
    const addRow = `<tr class="addrow"><td><input id="ndPhase" class="cellinput" placeholder="Phase…"></td>
      <td><input id="ndName" class="cellinput" placeholder="New deliverable…"></td>
      <td><input id="ndOwner" class="cellinput owner" placeholder="Owner"></td>
      <td colspan="2"><button class="btn sm" id="ndAdd">+ Add</button></td></tr>`;
    t.innerHTML = head + rows + addRow;
    // wire inline edits
    t.querySelectorAll('tr[data-id]').forEach(tr=>{
      const id = tr.dataset.id;
      tr.querySelectorAll('.cellinput').forEach(inp=>{
        inp.onchange = ()=> updateRow('deliverables', id, { [inp.dataset.f]: inp.value.trim()||null });
      });
      const ssel = tr.querySelector('select');
      ssel.onchange = ()=> updateRow('deliverables', id, { status: ssel.value, delivered_at: ssel.value==='delivered'? new Date().toISOString():null });
      tr.querySelector('.rowdel').onclick = ()=> deleteRow('deliverables', id, 'Delete this deliverable?');
    });
    $('ndAdd').onclick = addDeliverable;
  } else {
    // client: clean, no owner column, no editing
    t.innerHTML = '<tr><th>Phase</th><th>Deliverable</th><th>Status</th></tr>' +
      data.deliv.map(x=>`<tr><td>${esc(x.phase)}</td><td>${esc(x.name)}</td>
        <td><span class="chip ${x.status}">${x.status.replace('_',' ')}</span></td></tr>`).join('');
  }
}
function statusSelect(kind, cur){
  return `<select class="statussel">`+STATUS_OPTS.map(([v,l])=>`<option value="${v}" ${v===cur?'selected':''}>${l}</option>`).join('')+`</select>`;
}
async function addDeliverable(){
  const phase = $('ndPhase').value.trim()||'Custom';
  const name  = $('ndName').value.trim();
  if(!name){ flash('Enter a deliverable name.'); return; }
  const owner = $('ndOwner').value.trim()||null;
  const sort  = (Math.max(0,...data.deliv.map(d=>d.sort||0)))+1;
  const { error } = await sb.from('deliverables').insert({ practice_id:practiceId, phase, name, owner_seat:owner, status:'promised', sort });
  flash(error? error.message : 'Deliverable added.'); if(!error) loadAll();
}

/* ---- VIDEO PIPELINE: column board with dates, drag-drop, stale-red flag, hover detail, double-click panel ---- */
const fmtDate = d => d ? new Date(d+ (String(d).length<=10?'T00:00:00':'')).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
function daysIn(stage_since){ if(!stage_since) return 0; return Math.max(0,Math.floor((Date.now()-new Date(stage_since))/86400000)); }
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
      const stale = isTeam && key!=='posted' && daysIn(v.stage_since) >= STALE_DAYS;
      const enteredStr = v.stage_since ? fmtDate(v.stage_since) : '';
      const days = daysIn(v.stage_since);
      const daysLine = isTeam? `<span class="vdays ${stale?'stale':''}">${days} day${days===1?'':'s'} in this stage</span>` : '';
      const stageDateLine = enteredStr? `<span class="vdate">${stageLabelOf(key)} · ${enteredStr}</span>` : '';
      return `<div class="vitem ${v.blocked?'blocked':''} ${stale?'staleflag':''}" ${isTeam?`draggable="true"`:''} data-vid="${v.id}" title="${esc(videoTooltip(v))}">
        ${isTeam?`<button class="vdel" data-del="${v.id}" title="Delete">✕</button>`:''}
        <span class="vtitle">${esc(v.item)}</span>
        ${v.video_url && key==='posted'?`<a class="vlink" href="${esc(v.video_url)}" target="_blank" rel="noopener">▶ watch</a>`:''}
        ${daysLine}${stageDateLine}
        ${v.blocked?`<span class="why">⚑ ${esc(v.blocked_reason||'Waiting on practice')}</span>`:''}</div>`;
    }).join('');
    const addBtn = isTeam? `<button class="vadd" data-addstage="${key}">+ Add video</button>` : '';
    return `<div class="col ${isTeam?'dropcol':''}" data-stage="${key}"><div class="h">${label} · <span class="cnt">${items.length}</span></div><div class="coldrop">${cards}</div>${addBtn}</div>`;
  }).join('');
  if(isTeam) wirePipeline(wrap);
}

function wirePipeline(wrap){
  wrap.querySelectorAll('.vitem[draggable]').forEach(card=>{
    card.addEventListener('dragstart', e=>{
      e.dataTransfer.setData('text/plain', card.dataset.vid);  // reliable: travels with the drag
      e.dataTransfer.effectAllowed='move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', ()=> card.classList.remove('dragging'));
    card.addEventListener('dblclick', ()=> openVideoDetail(card.dataset.vid));
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
      .insert({ practice_id: practiceId, item: item.trim(), stage })
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
  const histRows = hist.length? hist.map(h=>
    `<div class="histrow"><span class="hstage">${stageLabel(h.stage)}</span><span class="hdate">${new Date(h.moved_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span></div>`).join('')
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
      <span id="mMsg" class="note"></span>
    </div></div>`;
  m.classList.add('open');

  $('mClose').onclick = closeModal;
  m.onclick = e=>{ if(e.target===m) closeModal(); };

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
    await loadAll();
    setTimeout(closeModal, 1400);
  };
}
function closeModal(){ const m=$('modal'); m.classList.remove('open'); m.innerHTML=''; }

/* ---- MILESTONES: original display; team can edit only the date (dates auto-seeded per surgeon) ---- */
function renderTimeline(isTeam){
  const wrap = $('timeline');
  if(!data.miles.length){ wrap.innerHTML = '<p class="note">Roadmap milestones will appear here at kickoff.</p>'; return; }
  wrap.innerHTML = data.miles.map(m=>{
    const tagLabel = m.status==='done'?'Complete':m.status==='current'?'You are here':'Up next';
    const dateBit = m.target_date? ' · '+m.target_date : '';
    const dateEl = isTeam
      ? `<div class="tldate"><input type="date" class="dateedit" data-id="${m.id}" value="${m.target_date||''}"></div>`
      : '';
    return `<div class="tl ${m.status}"><div class="dot"></div><div class="n">${esc(m.name)}</div>
       <div class="d">${esc(m.detail||'')}</div>
       <span class="tag">${tagLabel}${isTeam?'':dateBit}</span>${dateEl}</div>`;
  }).join('');
  if(isTeam){
    wrap.querySelectorAll('.dateedit').forEach(inp=>{
      inp.onchange = ()=> updateRow('milestones', inp.dataset.id, { target_date: inp.value||null });
    });
  }
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

$('btnPost').onclick = async ()=>{
  const msg = $('updMsg').value.trim(); if(!msg) return;
  const { error } = await sb.from('activity').insert({ practice_id: practiceId, message: msg, author: me.full_name||'ROXIUM', source:'portal' });
  flash(error? error.message : 'Posted.'); $('updMsg').value=''; if(!error) loadAll();
};

init();
