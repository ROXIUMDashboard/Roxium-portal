/**
 * Classify a staging database from the markers emitted by
 * scripts/staging-state.sql.
 *
 * This lives in one place because two callers must agree exactly:
 * scripts/initialize-staging-db.sh (which decides whether to run DDL) and the
 * tests that prove the decision is right.
 *
 *   NEW          nothing is there            -> run the one-time bootstrap
 *   INITIALIZED  everything is there         -> SKIP the bootstrap
 *   PARTIAL      some of it is there         -> refuse, change nothing
 *
 * The bootstrap is schema.sql plus the whole migration history, and that
 * history is NOT replayable: delete_practice(uuid) changes its return type
 * (void -> jsonb) partway through, so replaying the older definition over the
 * newer one makes Postgres refuse with "cannot change return type of existing
 * function". Hence: bootstrap once, verify thereafter.
 */

export const EXPECTED = {
  coreTables: 10,
  coreFunctions: 8,
  latestMarkers: 5,
  minTotalTables: 20,
};

/** Parse the `key=value` lines staging-state.sql prints. */
export function parseMarkers(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const ratio = (v) => {
  const m = /^(\d+)\/(\d+)$/.exec(String(v || ''));
  return m ? { have: +m[1], want: +m[2] } : null;
};

/**
 * @returns {{state:'NEW'|'INITIALIZED'|'PARTIAL', reasons:string[]}}
 */
export function classify(markers) {
  const m = typeof markers === 'string' ? parseMarkers(markers) : (markers || {});
  const tables = ratio(m.core_tables);
  const funcs = ratio(m.core_functions);
  const latest = ratio(m.latest_markers);
  const total = Number.parseInt(m.total_tables ?? '', 10);
  const rlsOff = Number.parseInt(m.rls_off ?? '', 10);

  // An unreadable marker set is never treated as "fine" — that is the one
  // outcome that could let DDL run against something unexamined.
  if (!tables || !funcs || !latest || !Number.isFinite(total) || !Number.isFinite(rlsOff)) {
    return { state: 'PARTIAL', reasons: ['the database state could not be read completely'] };
  }

  const empty = tables.have === 0 && funcs.have === 0 && latest.have === 0 && total === 0;
  if (empty) return { state: 'NEW', reasons: [] };

  const reasons = [];
  if (tables.have !== tables.want) reasons.push(`core tables ${m.core_tables}`);
  if (funcs.have !== funcs.want) reasons.push(`core functions ${m.core_functions}`);
  if (latest.have !== latest.want) reasons.push(`latest-migration markers ${m.latest_markers}`);
  if (rlsOff !== 0) reasons.push(`${rlsOff} table(s) with RLS disabled`);
  if (total < EXPECTED.minTotalTables) reasons.push(`only ${total} tables (expected at least ${EXPECTED.minTotalTables})`);

  return reasons.length ? { state: 'PARTIAL', reasons } : { state: 'INITIALIZED', reasons: [] };
}
