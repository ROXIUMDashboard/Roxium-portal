#!/usr/bin/env node
/**
 * seed-staging.mjs — deterministic, resettable test data for the STAGING project.
 *
 *   node scripts/seed-staging.mjs --dry-run     # print the plan, touch nothing
 *   node scripts/seed-staging.mjs               # seed (idempotent)
 *   node scripts/seed-staging.mjs --reset       # delete seeded data, then seed
 *
 * Requires STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY.
 *
 * SAFETY
 *   • scripts/lib/staging-guard.mjs runs FIRST and hard-refuses the production
 *     project ref, an unparseable URL, or a missing URL. Deny by default.
 *   • Every row it creates carries a deterministic id derived from SEED_NAMESPACE,
 *     so --reset deletes exactly what it created and nothing else.
 *   • All names/emails are obviously fake and use the reserved .test TLD, which
 *     can never resolve on the public internet.
 *   • No production data is read, copied or referenced. See docs/STAGING_DATA.md.
 *
 * Zero dependencies: talks to PostgREST and the Auth admin API over fetch.
 */
import { createHash, randomUUID } from 'node:crypto';
import { assertStagingTarget } from './lib/staging-guard.mjs';

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has('--dry-run');
const RESET = ARGS.has('--reset');

const URL_ = process.env.STAGING_SUPABASE_URL || '';
const KEY = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';

// Stable v5-style ids: the same fixture name always maps to the same uuid, so
// re-seeding updates rows instead of duplicating them, and --reset is exact.
const SEED_NAMESPACE = 'roxium-staging-fixtures-v1';
const uid = (name) => {
  const h = createHash('sha1').update(`${SEED_NAMESPACE}:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString();
const day = (offset) => iso(Date.now() + offset * DAY).slice(0, 10);
const monthStart = (back) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------- FIXTURES
// Each practice is chosen to cover specific scenarios from docs/STAGING_DATA.md.
// The `covers` list is the contract — keep it accurate when editing fixtures.
const PRACTICES = [
  { key: 'northstar', name: 'Northstar Facial Surgery (TEST)', go_live: day(-240),
    covers: [1, 8, 9, 13, 18, 20, 21] },
  { key: 'brightpath', name: 'Brightpath Aesthetics (TEST)', go_live: day(-9),
    covers: [2, 3, 5, 6, 16] },
  { key: 'cedarridge', name: 'Cedar Ridge Plastic Surgery (TEST)', go_live: day(-210),
    covers: [4, 7, 10, 11, 12, 14, 19] },
  { key: 'harborpoint', name: 'Harbor Point Cosmetic (TEST)', go_live: day(-60),
    covers: [22] },
];

const USERS = [
  { key: 'team',        email: 'team.ops@roxium.test',            name: 'Test Team Operator', role: 'team',   practice: null,          membership: null },
  { key: 'ns_owner',    email: 'owner.northstar@roxium.test',     name: 'Dr Test Northstar',  role: 'client', practice: 'northstar',   membership: 'owner'  },
  { key: 'ns_member',   email: 'staff.northstar@roxium.test',     name: 'Test Practice Manager', role: 'client', practice: 'northstar', membership: 'member' },
  { key: 'bp_owner',    email: 'owner.brightpath@roxium.test',    name: 'Dr Test Brightpath', role: 'client', practice: 'brightpath',  membership: 'owner'  },
  { key: 'cr_owner',    email: 'owner.cedarridge@roxium.test',    name: 'Dr Test Cedar',      role: 'client', practice: 'cedarridge',  membership: 'owner'  },
  { key: 'hp_owner',    email: 'owner.harborpoint@roxium.test',   name: 'Dr Test Harbor',     role: 'client', practice: 'harborpoint', membership: 'owner'  },
  // Scenario 15: signed up, no membership -> pending approval.
  { key: 'pending',     email: 'pending.applicant@roxium.test',   name: 'Test Pending Applicant', role: 'client', practice: null,      membership: null },
  // Scenario 17: had access, revoked -> auth user exists, membership removed.
  { key: 'revoked',     email: 'revoked.former@roxium.test',      name: 'Test Revoked User',  role: 'client', practice: null,          membership: null },
];

const PHASES = [
  'Phase 0 · Intelligence', 'Phase 1 · Brand Foundation', 'Phase 2 · Video & Authority',
  'Phase 3 · Web & Landing Pages', 'Phase 4 · Paid Media', 'Phase 5 · Nurture Engine',
];

function deliverablesFor(p) {
  const out = [];
  const add = (phase, name, status, extra = {}) =>
    out.push({ id: uid(`deliv:${p.key}:${name}`), practice_id: uid(`practice:${p.key}`),
               phase, name, status, sort: out.length + 1, phase_order: PHASES.indexOf(phase), ...extra });

  if (p.key === 'northstar') {                       // healthy, mostly delivered
    PHASES.slice(0, 4).forEach((ph, i) =>
      ['Discovery workshop', 'Asset handover'].forEach((n, j) =>
        add(ph, `${n} ${i}${j}`, 'delivered', { delivered_at: iso(Date.now() - (200 - i * 30) * DAY), due: day(-200 + i * 30) })));
    add(PHASES[4], 'Campaign build', 'in_progress', { due: day(21) });          // 5: in progress
    add(PHASES[4], 'Creative matrix', 'delivered', { delivered_at: iso(Date.now() - 3 * DAY), due: day(-4) }); // 8: completed
  } else if (p.key === 'brightpath') {               // brand new, phase 0 warming up
    add(PHASES[0], 'Intake & credentials collection', 'in_progress', { due: day(3) });   // 6: waiting on ROXIUM
    add(PHASES[0], 'Brand discovery session', 'promised', { due: day(5), owner_seat: 'CLIENT' }); // 7: waiting on client
    add(PHASES[0], 'Competitive landscape audit', 'promised', { due: day(6) });
    add(PHASES[1], 'Style scapes', 'promised', { due: day(24) });
  } else if (p.key === 'cedarridge') {               // in trouble
    PHASES.slice(0, 2).forEach((ph, i) => add(ph, `Foundation item ${i}`, 'delivered',
      { delivered_at: iso(Date.now() - (180 - i * 20) * DAY), due: day(-180 + i * 20) }));
    add(PHASES[2], 'Video scripts', 'in_progress', { due: day(-28) });          // 4 + overdue
    add(PHASES[2], 'On-site shoot', 'promised', { due: day(-12) });
    add(PHASES[2], 'Patient testimonial films', 'promised', { due: day(9) });
  } else {                                           // harborpoint — isolation control
    add(PHASES[0], 'HARBOR POINT PRIVATE ITEM', 'delivered',
        { delivered_at: iso(Date.now() - 20 * DAY), due: day(-22) });
    add(PHASES[1], 'Harbor brand guidelines', 'in_progress', { due: day(14) });
  }
  return out;
}

function videosFor(p) {
  const pid = uid(`practice:${p.key}`);
  const v = (name, stage, extra = {}) => ({ id: uid(`video:${p.key}:${name}`), practice_id: pid, item: name, stage,
                                            stage_since: iso(Date.now() - (extra._age ?? 2) * DAY), ...extra, _age: undefined });
  if (p.key === 'northstar') return [
    v('Recovery masterclass', 'delivered', { _age: 30, video_url: 'https://example.test/video/ns-1' }),
    v('SEO video — facelift', 'editing', { _age: 4, planned_shoot_date: day(18) }),          // 9: in progress
  ];
  if (p.key === 'brightpath') return [v('Welcome film', 'planned', { _age: 5 })];
  if (p.key === 'cedarridge') return [
    v('VSL production', 'scheduled', { _age: 6, planned_shoot_date: day(4) }),               // 10: approaching
    v('Testimonial #1', 'shot', { _age: 21, planned_shoot_date: day(-15) }),                 // 11: overdue
    v('Procedure explainer', 'editing', { _age: 12, blocked: true,
      blocked_reason: 'Waiting on surgeon approval of the edit' }),                          // 12: waiting on client
  ];
  return [v('Harbor welcome film', 'planned', { _age: 8 })];
}

function kpiFor(p) {
  const pid = uid(`practice:${p.key}`);
  const months = p.key === 'northstar' ? 8 : p.key === 'cedarridge' ? 6 : p.key === 'harborpoint' ? 3 : 1;
  const rows = [];
  for (let i = months - 1; i >= 0; i--) {                                                    // 20: KPI history
    const seed = (p.key.charCodeAt(0) + i) % 7;
    const spend = 3200 + seed * 420 + i * 130;
    rows.push({ practice_id: pid, period: monthStart(i), source: 'marketing',
      spend, reach: Math.round(spend * 7.4), impr: Math.round(spend * 15.2),
      clicks: Math.round(spend * 0.38), lpv: Math.round(spend * 0.27),
      page_engagement: Math.round(spend * 0.9), finalized: i > 0 });
  }
  return rows;
}

function connectionsFor(p) {
  const pid = uid(`practice:${p.key}`);
  if (p.key === 'northstar') return [                                                        // 18: healthy
    { practice_id: pid, provider: 'meta', status: 'connected', external_account_name: 'Northstar Ads (TEST)',
      connected_at: iso(Date.now() - 120 * DAY), last_synced_at: iso(Date.now() - 2 * 3600e3), last_error: null },
  ];
  if (p.key === 'cedarridge') return [                                                       // 19: failed
    { practice_id: pid, provider: 'meta', status: 'error', external_account_name: 'Cedar Ridge Ads (TEST)',
      connected_at: iso(Date.now() - 90 * DAY), last_synced_at: iso(Date.now() - 9 * DAY),
      last_error: 'invalid_grant: access token expired — reconnect required' },
  ];
  return [];
}

function activityFor(p) {
  const pid = uid(`practice:${p.key}`);
  if (p.key === 'northstar') return [                                                        // 13: recent updates
    { id: uid(`act:${p.key}:1`), practice_id: pid, message: 'October creative refresh is live across both accounts.', author: 'ROXIUM', source: 'portal', created_at: iso(Date.now() - 1 * DAY) },
    { id: uid(`act:${p.key}:2`), practice_id: pid, message: 'Recovery masterclass published to the channel.', author: 'ROXIUM', source: 'portal', created_at: iso(Date.now() - 4 * DAY) },
  ];
  if (p.key === 'cedarridge') return [                                                       // 14: stale
    { id: uid(`act:${p.key}:1`), practice_id: pid, message: 'Shoot scheduling still pending with the practice.', author: 'ROXIUM', source: 'portal', created_at: iso(Date.now() - 47 * DAY) },
  ];
  return [];
}

// ------------------------------------------------------------------ RUNNER
function plan() {
  const rows = { practices: [], deliverables: [], videos: [], kpi: [], connections: [], activity: [], milestones: [] };
  for (const p of PRACTICES) {
    const pid = uid(`practice:${p.key}`);
    rows.practices.push({ id: pid, name: p.name, go_live: p.go_live });
    rows.deliverables.push(...deliverablesFor(p));
    rows.videos.push(...videosFor(p));
    rows.kpi.push(...kpiFor(p));
    rows.connections.push(...connectionsFor(p));
    rows.activity.push(...activityFor(p));
    rows.milestones.push(
      { id: uid(`ms:${p.key}:1`), practice_id: pid, name: 'Milestone I — Foundation', status: 'done', target_date: day(-60), sort: 1 },
      { id: uid(`ms:${p.key}:2`), practice_id: pid, name: 'Milestone II — Brand Awareness', status: 'current', target_date: day(20), sort: 2 },
      { id: uid(`ms:${p.key}:3`), practice_id: pid, name: 'Milestone III — Full Funnel', status: 'upcoming', target_date: day(75), sort: 3 },
    );
  }
  return rows;
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

async function ensureUser(u) {
  const list = await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  }).then((r) => r.json()).catch(() => ({ users: [] }));
  const found = (list.users || []).find((x) => (x.email || '').toLowerCase() === u.email);
  if (found) return found.id;
  const created = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, email_confirm: true, user_metadata: { full_name: u.name, seeded: true } }),
  }).then((r) => r.json());
  if (!created.id) throw new Error(`could not create ${u.email}: ${JSON.stringify(created).slice(0, 200)}`);
  return created.id;
}

async function main() {
  console.log(`ROXIUM staging seed  (${DRY ? 'DRY RUN' : RESET ? 'RESET + SEED' : 'SEED'})\n`);

  // ---- guard before anything else ----
  if (DRY && !URL_) {
    console.log('No STAGING_SUPABASE_URL set — printing the plan only.\n');
  } else {
    const ref = assertStagingTarget(URL_);
    console.log(`Target project: ${ref}  (verified NOT production)\n`);
    if (!KEY) throw new Error('STAGING_SUPABASE_SERVICE_ROLE_KEY is not set.');
  }

  const rows = plan();
  const counts = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));
  console.log('Fixture plan:');
  for (const p of PRACTICES) console.log(`  practice  ${p.name.padEnd(42)} covers scenarios ${p.covers.join(', ')}`);
  console.log('');
  for (const [k, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`  ${String(USERS.length).padStart(4)}  auth users (all @roxium.test)`);

  if (DRY) { console.log('\nDRY RUN — nothing was written.'); return; }

  const practiceIds = PRACTICES.map((p) => uid(`practice:${p.key}`));
  const inList = `(${practiceIds.join(',')})`;

  if (RESET) {
    console.log('\nResetting seeded rows (scoped to the fixture practice ids only)…');
    for (const t of ['activity', 'notifications', 'video_history', 'video_pipeline', 'deliverables',
                     'milestones', 'kpi_daily', 'kpi_monthly', 'platform_connections', 'sheet_sources',
                     'memberships', 'practice_invites']) {
      await rest(`${t}?practice_id=in.${inList}`, { method: 'DELETE' }).catch((e) => console.log(`  (skip ${t}: ${e.message.slice(0, 80)})`));
    }
    await rest(`practices?id=in.${inList}`, { method: 'DELETE' }).catch((e) => console.log(`  (skip practices: ${e.message.slice(0, 80)})`));
    console.log('  reset complete.');
  }

  console.log('\nSeeding…');
  await rest('practices', { method: 'POST', body: rows.practices, prefer: 'resolution=merge-duplicates' });
  for (const [table, data] of [['deliverables', rows.deliverables], ['milestones', rows.milestones],
                               ['video_pipeline', rows.videos], ['kpi_monthly', rows.kpi],
                               ['platform_connections', rows.connections], ['activity', rows.activity]]) {
    if (!data.length) continue;
    await rest(table, { method: 'POST', body: data, prefer: 'resolution=merge-duplicates' });
    console.log(`  ${String(data.length).padStart(4)}  ${table}`);
  }

  console.log('\nAuth users + access:');
  for (const u of USERS) {
    const id = await ensureUser(u);
    const practice_id = u.practice ? uid(`practice:${u.practice}`) : null;
    await rest('profiles', { method: 'POST', prefer: 'resolution=merge-duplicates',
      body: [{ id, full_name: u.name, role: u.role, practice_id,
               approval_status: u.key === 'pending' ? 'pending' : u.key === 'revoked' ? 'rejected' : 'approved' }] });
    if (u.membership && practice_id) {
      await rest('memberships', { method: 'POST', prefer: 'resolution=merge-duplicates',
        body: [{ user_id: id, practice_id, role: u.membership }] });
    }
    console.log(`  ${u.email.padEnd(38)} ${u.role}${u.membership ? ' / ' + u.membership : ''}${u.key === 'pending' ? '  (pending approval)' : ''}${u.key === 'revoked' ? '  (revoked)' : ''}`);
  }

  // Scenario 16: an invitation that has been sent but not yet accepted.
  await rest('practice_invites', { method: 'POST', prefer: 'resolution=merge-duplicates',
    body: [{ practice_id: uid('practice:brightpath'), email: 'invited.newstaff@roxium.test',
             full_name: 'Test Invited Staff', role: 'member', status: 'sent' }] }).catch(() => {});

  console.log('\nStaging seed complete. All data is synthetic; all emails use the reserved .test TLD.');
}

main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
