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
const STAGES = [['scheduled','Scheduled'],['pre_production','Pre-production'],['shot','Shot'],['editing','Editing'],['delivered','Delivered'],['posted','Posted']];

let me = null;            // profile row
let practiceId = null;    // active practice
let data = { kpi: [], deliv: [], miles: [], video: [], feed: [], practice: null };

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
    const { data: prax } = await sb.from('practices').select('*').order('name');
    const pick = $('practicePicker');
    pick.classList.remove('hidden');
    pick.innerHTML = (prax||[]).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    pick.onchange = ()=>{ practiceId = pick.value; loadAll(); };
    practiceId = prax && prax.length ? prax[0].id : null;
  } else {
    practiceId = me.practice_id;
  }
  if(practiceId) loadAll();
}

/* ---------------- data ---------------- */
async function loadAll(){
  const [p,k,d,m,v,f] = await Promise.all([
    sb.from('practices').select('*').eq('id', practiceId).single(),
    sb.from('kpi_monthly').select('*').eq('practice_id', practiceId).order('month'),
    sb.from('deliverables').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('milestones').select('*').eq('practice_id', practiceId).order('sort'),
    sb.from('video_pipeline').select('*').eq('practice_id', practiceId),
    sb.from('activity').select('*').eq('practice_id', practiceId).order('created_at',{ascending:false}).limit(12),
  ]);
  data = { practice:p.data, kpi:k.data||[], deliv:d.data||[], miles:m.data||[], video:v.data||[], feed:f.data||[] };
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
  const latest = [...data.kpi].sort((a,b)=>b.month-a.month)[0] || null;
  const d = derive(latest);
  $('updated').textContent = latest
    ? `Reporting through Month ${latest.month} · KPI data live from Supabase`
    : 'KPI data will appear here after the first month is reported.';
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
  $('timeline').innerHTML = data.miles.length? data.miles.map(m=>
    `<div class="tl ${m.status}"><div class="dot"></div><div class="n">${m.name}</div>
     <div class="d">${m.detail||''}</div>
     <span class="tag">${m.status==='done'?'Complete':m.status==='current'?'You are here':'Up next'}${m.target_date? ' · '+m.target_date:''}</span></div>`).join('')
    : '<p class="note">Roadmap milestones will appear here at kickoff.</p>';

  // deliverables
  const pct = data.deliv.length? Math.round(100*delivered/data.deliv.length):0;
  $('delivSub').textContent = data.deliv.length? `${delivered} of ${data.deliv.length} deliverables shipped (${pct}%).` : 'Deliverables will be loaded at kickoff.';
  $('delivBar').style.width = pct+'%';
  $('delivTable').innerHTML = '<tr><th>Phase</th><th>Deliverable</th><th>Owner</th><th>Status</th></tr>' +
    data.deliv.map(x=>`<tr><td>${x.phase}</td><td>${x.name}</td><td>${x.owner_seat||'—'}</td>
      <td><span class="chip ${x.status}">${x.status.replace('_',' ')}</span></td></tr>`).join('');

  // video pipeline
  $('pipeline').innerHTML = STAGES.map(([key,label])=>{
    const items = data.video.filter(v=>v.stage===key);
    return `<div class="col"><div class="h">${label} · ${items.length}</div>` +
      items.map(v=>`<div class="vitem ${v.blocked?'blocked':''}">${v.item}${v.blocked? `<span class="why">⚑ ${v.blocked_reason||'Waiting on practice'}</span>`:''}</div>`).join('') + '</div>';
  }).join('');

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

  if(me.role==='team') renderTeam(latest);
}

/* ---------------- team controls ---------------- */
function renderTeam(){
  const sel = $('inMonth');
  sel.innerHTML = Array.from({length:12},(_,i)=>`<option value="${i+1}">Month ${i+1}</option>`).join('');
  sel.onchange = fillKpiForm;
  fillKpiForm();
  $('delivPick').innerHTML = data.deliv.map(x=>`<option value="${x.id}">${x.phase} — ${x.name}</option>`).join('');
  $('vidPick').innerHTML = data.video.map(v=>`<option value="${v.id}">${v.item}</option>`).join('');
}
function fillKpiForm(){
  const m = data.kpi.find(x=>x.month===+$('inMonth').value) || {};
  $('entryFields').innerHTML = FIELDS.map(f=>
    `<div class="f"><label>${f.l}</label><input data-k="${f.k}" type="number" step="any" value="${m[f.k]??''}" placeholder="0"></div>`).join('');
}
const flash = t=>{ $('saveMsg').textContent=t; setTimeout(()=>$('saveMsg').textContent='',3500); };

$('btnSaveKpi').onclick = async ()=>{
  const row = { practice_id: practiceId, month: +$('inMonth').value, updated_at: new Date().toISOString() };
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

$('btnDeliv').onclick = async ()=>{
  const id = $('delivPick').value, status = $('delivStatus').value;
  const patch = { status, delivered_at: status==='delivered'? new Date().toISOString() : null };
  const { error } = await sb.from('deliverables').update(patch).eq('id', id);
  flash(error? error.message : 'Deliverable updated.'); if(!error) loadAll();
};

$('btnVid').onclick = async ()=>{
  const reason = $('vidBlocked').value.trim();
  const { error } = await sb.from('video_pipeline').update({
    stage: $('vidStage').value, blocked: !!reason, blocked_reason: reason||null, updated_at: new Date().toISOString()
  }).eq('id', $('vidPick').value);
  flash(error? error.message : 'Pipeline updated.'); if(!error) loadAll();
};

$('btnPost').onclick = async ()=>{
  const msg = $('updMsg').value.trim(); if(!msg) return;
  const { error } = await sb.from('activity').insert({ practice_id: practiceId, message: msg, author: me.full_name||'ROXIUM', source:'portal' });
  flash(error? error.message : 'Posted.'); $('updMsg').value=''; if(!error) loadAll();
};

init();
