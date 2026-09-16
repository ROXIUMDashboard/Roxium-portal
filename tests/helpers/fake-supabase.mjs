/**
 * fake-supabase.mjs — a PostgREST + Auth-admin front end over a REAL Postgres.
 *
 * The staging seeder talks HTTP, so testing it against a bare database would
 * test something other than what runs. This serves the exact endpoint subset
 * scripts/seed-staging.mjs uses and reproduces the behaviours that actually
 * broke it:
 *
 *   • PGRST102 — a bulk insert whose objects do not all carry the same key set
 *     is rejected before it reaches SQL, with PostgREST's own error body. This
 *     is the failure that stopped Initialize STAGING #3.
 *   • PGRST204 — a payload key that is not a column of the table.
 *   • on_conflict is passed through to ON CONFLICT (…) verbatim, so a target
 *     that does not match a real index fails with Postgres' own 42P10, exactly
 *     as it would against Supabase. An expression index is not a valid target.
 *   • Only the columns present in the payload are written; every other column
 *     takes its database default. Filling absent columns with NULL would hide
 *     precisely the class of bug this suite exists to catch.
 *   • The Auth admin API enforces email uniqueness and pages its listing.
 *
 * It is NOT a Supabase replica. It has no RLS, no JWT verification and no
 * rate limiting; it is a transport-faithful stand-in for the write paths the
 * seeder exercises. Queries run through psql, so the SQL, the types, the
 * constraints and the errors are genuinely Postgres'.
 */
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const TMP = mkdtempSync(join(tmpdir(), 'roxium-fake-supabase-'));
let seq = 0;

const IDENT = /^[a-z_][a-z0-9_]*$/;
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const ident = (s) => { if (!IDENT.test(s)) throw new Error(`unsafe identifier: ${s}`); return s; };

/** Run SQL through psql, surfacing the SQLSTATE so callers can map it as PostgREST does. */
function run(dbUrl, sql) {
  const f = join(TMP, `q${seq++}.sql`);
  writeFileSync(f, `\\set VERBOSITY verbose\n${sql}\n`);
  const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-f', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    const m = (r.stderr || '').match(/ERROR:\s+([0-9A-Za-z]{5}):\s*([^\n]*)/);
    return { ok: false, sqlstate: m ? m[1] : '', message: m ? m[2].trim() : (r.stderr || '').trim() };
  }
  return { ok: true, out: (r.stdout || '').trim() };
}

function rows(dbUrl, selectSql) {
  const r = run(dbUrl, `select coalesce(json_agg(t), '[]'::json)::text from (${selectSql}) t;`);
  return r.ok ? { ok: true, rows: JSON.parse(r.out || '[]') } : r;
}

const columnsOf = (dbUrl, table) =>
  (rows(dbUrl, `select column_name from information_schema.columns
                where table_schema='public' and table_name=${lit(table)}`).rows || []).map((c) => c.column_name);

const primaryKeyOf = (dbUrl, table) =>
  (rows(dbUrl, `select a.attname from pg_index i
                join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                where i.indrelid = ${lit(`public.${table}`)}::regclass and i.indisprimary
                order by array_position(i.indkey, a.attnum)`).rows || []).map((c) => c.attname);

/** PostgREST filters: col=in.(a,b) and col=eq.v — the two the seeder uses. */
function whereFrom(params) {
  const clauses = [];
  for (const [key, raw] of params) {
    if (key === 'select' || key === 'on_conflict' || key === 'order' || key === 'limit') continue;
    const col = ident(key);
    if (raw.startsWith('in.(')) {
      const vals = raw.slice(4, -1).split(',').map((v) => v.trim().replace(/^"|"$/g, '')).filter(Boolean);
      clauses.push(vals.length ? `${col} in (${vals.map(lit).join(',')})` : 'false');
    } else if (raw.startsWith('eq.')) {
      clauses.push(`${col} = ${lit(raw.slice(3))}`);
    } else {
      throw new Error(`fake-supabase does not implement the filter "${key}=${raw}"`);
    }
  }
  return clauses.length ? `where ${clauses.join(' and ')}` : '';
}

const send = (res, code, body) => {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
};

/** Map a Postgres SQLSTATE onto the status PostgREST would return. */
const statusFor = (sqlstate) => ({ '23505': 409, '23503': 409, '23502': 400, '42P10': 400, '42703': 400 }[sqlstate] || 400);

function handleRest(dbUrl, req, res, url, body) {
  const table = ident(url.pathname.replace(/^\/rest\/v1\//, ''));
  const params = [...url.searchParams.entries()];

  if (req.method === 'GET') {
    const select = (url.searchParams.get('select') || '*').split(',').map((s) => (s === '*' ? '*' : ident(s.trim()))).join(',');
    const r = rows(dbUrl, `select ${select} from ${table} ${whereFrom(params)}`);
    return r.ok ? send(res, 200, r.rows) : send(res, statusFor(r.sqlstate), { code: r.sqlstate, message: r.message });
  }

  if (req.method === 'DELETE') {
    const r = run(dbUrl, `delete from ${table} ${whereFrom(params)};`);
    return r.ok ? send(res, 204) : send(res, statusFor(r.sqlstate), { code: r.sqlstate, message: r.message });
  }

  if (req.method !== 'POST') return send(res, 405, { message: 'not implemented' });

  const payload = Array.isArray(body) ? body : [body];
  if (!payload.length) return send(res, 201);

  // PGRST102 — the failure that stopped Initialize STAGING #3. PostgREST checks
  // this itself, before any SQL is generated.
  const shapes = new Set(payload.map((o) => Object.keys(o).sort().join(',')));
  if (shapes.size > 1) {
    return send(res, 400, { code: 'PGRST102', message: 'All object keys must match', details: null, hint: null });
  }

  const cols = Object.keys(payload[0]);
  const real = new Set(columnsOf(dbUrl, table));
  const unknown = cols.filter((c) => !real.has(c));
  if (unknown.length) {
    return send(res, 400, { code: 'PGRST204', message: `Column '${unknown[0]}' of relation '${table}' does not exist` });
  }

  const merge = /resolution=merge-duplicates/.test(req.headers.prefer || '');
  // on_conflict goes through verbatim: an invalid target must fail with 42P10
  // here exactly as it does against Supabase.
  const target = url.searchParams.get('on_conflict')
    ? url.searchParams.get('on_conflict').split(',').map((c) => ident(c.trim()))
    : primaryKeyOf(dbUrl, table);

  const list = cols.map(ident).join(', ');
  const tag = `$roxium_${randomUUID().replace(/-/g, '')}$`;
  // Only the payload's columns are inserted, so every other column takes its
  // database DEFAULT — the behaviour PostgREST has and a naive
  // json_populate_recordset(null::t, …) would silently destroy.
  let sql = `insert into ${table} (${list})\n  select ${list} from json_populate_recordset(null::${table}, ${tag}${JSON.stringify(payload)}${tag}::json)`;
  if (merge && target.length) {
    const updates = cols.filter((c) => !target.includes(c));
    sql += `\n  on conflict (${target.join(', ')}) do ` +
      (updates.length ? `update set ${updates.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}` : 'nothing');
  }
  const r = run(dbUrl, `${sql};`);
  return r.ok ? send(res, 201) : send(res, statusFor(r.sqlstate), { code: r.sqlstate, message: r.message });
}

function handleAuth(dbUrl, req, res, url, body) {
  const m = url.pathname.match(/^\/auth\/v1\/admin\/users(?:\/([0-9a-f-]+))?$/i);
  if (!m) return send(res, 404, { message: 'not found' });
  const id = m[1];

  if (req.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const per = Math.max(1, Math.min(1000, Number(url.searchParams.get('per_page') || 50)));
    const r = rows(dbUrl, `select id, email, raw_user_meta_data as user_metadata from auth.users
                           order by created_at, id limit ${per} offset ${(page - 1) * per}`);
    return r.ok ? send(res, 200, { users: r.rows, aud: 'authenticated' })
                : send(res, 500, { message: r.message });
  }

  if (req.method === 'POST') {
    const email = String(body?.email || '').trim();
    if (!email) return send(res, 422, { code: 422, msg: 'Unable to validate email address' });
    const r = run(dbUrl, `insert into auth.users (email, raw_user_meta_data, encrypted_password, email_confirmed_at)
      values (${lit(email)}, ${lit(JSON.stringify(body.user_metadata || {}))}::jsonb,
              ${body.password ? lit(`fake-bcrypt:${body.password}`) : 'null'},
              ${body.email_confirm ? 'now()' : 'null'}) returning id;`);
    if (!r.ok) {
      // Real Supabase Auth answers a duplicate address with 422, not a raw 23505.
      if (r.sqlstate === '23505') {
        return send(res, 422, { code: 422, msg: 'A user with this email address has already been registered' });
      }
      return send(res, 500, { message: r.message });
    }
    return send(res, 200, { id: r.out, email });
  }

  if (req.method === 'PUT' && id) {
    const sets = [`raw_user_meta_data = ${lit(JSON.stringify(body.user_metadata || {}))}::jsonb`];
    if (body.password) sets.push(`encrypted_password = ${lit(`fake-bcrypt:${body.password}`)}`);
    if (body.email_confirm) sets.push('email_confirmed_at = coalesce(email_confirmed_at, now())');
    const r = run(dbUrl, `update auth.users set ${sets.join(', ')} where id = ${lit(id)};`);
    return r.ok ? send(res, 200, { id }) : send(res, 500, { message: r.message });
  }
  return send(res, 405, { message: 'not implemented' });
}

/**
 * @param {string} dbUrl  a psql connection string for a DISPOSABLE database
 * @returns {Promise<{origin:string, close:()=>Promise<void>, requests:string[]}>}
 */
export function startFakeSupabase(dbUrl) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push(`${req.method} ${req.url}`);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      if (chunks.length) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return send(res, 400, { message: 'invalid json' }); }
      }
      try {
        if (url.pathname.startsWith('/rest/v1/')) return handleRest(dbUrl, req, res, url, body);
        if (url.pathname.startsWith('/auth/v1/')) return handleAuth(dbUrl, req, res, url, body);
        return send(res, 404, { message: 'not found' });
      } catch (e) {
        return send(res, 500, { message: e.message });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      origin: `http://127.0.0.1:${server.address().port}`,
      requests,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}
