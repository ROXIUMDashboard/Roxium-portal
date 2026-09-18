/**
 * Executes the shell that GitHub Actions actually runs, with `psql` stubbed.
 *
 * This exists because `Initialize STAGING` failed on a database that was
 * completely healthy. The check was:
 *
 *     [ "${missing:-x}" = "" ] || { echo "core tables missing: $missing"; exit 1; }
 *
 * `${missing:-x}` yields "x" when `missing` is empty and the list when it is
 * not — neither is ever equal to "". The step could not pass for ANY input, and
 * the failure it printed was `core tables missing:` with an empty list.
 *
 * YAML validation cannot catch that: the file was valid, the shell was valid,
 * and the logic was wrong. So these tests lift the real `run:` body out of the
 * workflow and run it against a fake psql, asserting the outcome for a healthy
 * database and for each thing the step is supposed to catch.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKFLOW = new URL('../../.github/workflows/initialize-staging.yml', import.meta.url);
const PROD_WORKFLOW = new URL('../../.github/workflows/deploy-production.yml', import.meta.url);
const SCRIPT_DIR = new URL('../../scripts/', import.meta.url);
const yaml = readFileSync(WORKFLOW, 'utf8');
const prodYaml = readFileSync(PROD_WORKFLOW, 'utf8');

/** Lift a step's `run:` block out of the workflow, dedented. */
function runBodyOf(stepName, source = yaml) {
  const lines = source.split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  assert.ok(at > -1, `step not found: ${stepName}`);
  const runAt = lines.findIndex((l, i) => i > at && /^\s*run:\s*\|\s*$/.test(l));
  assert.ok(runAt > -1 && runAt < at + 12, `no "run: |" for step: ${stepName}`);
  const indent = lines[runAt].match(/^\s*/)[0].length + 2;
  const out = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { out.push(''); continue; }
    if (l.match(/^\s*/)[0].length < indent) break;
    out.push(l.slice(indent));
  }
  return out.join('\n');
}

const VERIFY = runBodyOf('Verify the resulting schema');

/**
 * Run the step with a fake psql that answers each of its three queries from
 * env vars. GitHub runs steps with `bash -e`, so we do too.
 */
function runVerify({ tables = '22', rlsoff = '0', missing = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'roxium-wf-'));
  const psql = join(dir, 'psql');
  writeFileSync(psql, `#!/usr/bin/env bash
sql="\${@: -1}"
case "$sql" in
  *relrowsecurity*) printf '%s\\n' "$FAKE_RLSOFF" ;;
  *to_regclass*)    printf '%s\\n' "$FAKE_MISSING" ;;
  *table_type*)     printf '%s\\n' "$FAKE_TABLES" ;;
  *)                printf '\\n' ;;
esac
`);
  chmodSync(psql, 0o755);
  const stageFile = join(dir, 'stages');
  writeFileSync(stageFile, '');

  const r = spawnSync('bash', ['-e', '-c', VERIFY], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STAGING_SUPABASE_DB_URL: 'postgresql://stub/stub',
      STAGE_FILE: stageFile,
      FAKE_TABLES: tables, FAKE_RLSOFF: rlsoff, FAKE_MISSING: missing,
    },
  });
  return { ...r, out: `${r.stdout || ''}${r.stderr || ''}`, stages: readFileSync(stageFile, 'utf8') };
}

describe('Initialize STAGING — schema verification', () => {
  test('a healthy database PASSES', () => {
    // The exact shape of the run that failed: 22 tables, RLS on, nothing missing.
    const r = runVerify({ tables: '22', rlsoff: '0', missing: '' });
    assert.equal(r.status, 0, `a healthy database must pass, got exit ${r.status}:\n${r.out}`);
    assert.match(r.out, /every core table present/);
    assert.match(r.stages, /^schema_tables=22$/m, 'the table count must be recorded for the summary');
  });

  test('it never reports tables missing when none are', () => {
    const r = runVerify({ missing: '' });
    assert.ok(!/core tables missing/.test(r.out), `reported a missing-table error with an empty list:\n${r.out}`);
  });

  test('genuinely missing core tables FAIL, and are named', () => {
    const r = runVerify({ missing: 'practices, profiles' });
    assert.equal(r.status, 1);
    assert.match(r.out, /core tables missing: practices, profiles/);
  });

  test('a table with RLS disabled FAILS', () => {
    const r = runVerify({ rlsoff: '3' });
    assert.equal(r.status, 1);
    assert.match(r.out, /3 table\(s\) have RLS disabled/);
  });

  test('an incomplete bootstrap FAILS', () => {
    const r = runVerify({ tables: '5' });
    assert.equal(r.status, 1);
    assert.match(r.out, /only 5 tables/);
  });

  describe('a failed query fails CLOSED, never open', () => {
    // psql returning nothing means the check did not actually run. Each of the
    // three must treat that as a failure rather than as "looks fine".
    test('empty table count', () => {
      const r = runVerify({ tables: '' });
      assert.equal(r.status, 1, 'an unanswered table count must not pass');
      assert.match(r.out, /only 0 tables/, 'and must say so coherently, not emit a bash type error');
      assert.ok(!/integer expression expected/.test(r.out), r.out);
    });
    test('empty RLS count', () => {
      const r = runVerify({ rlsoff: '' });
      assert.equal(r.status, 1, 'an unanswered RLS count must not pass');
    });
  });
});

describe('the broken idiom is not reintroduced', () => {
  // `${var:-sentinel}` is correct when the sentinel differs from the comparison
  // target. Comparing it against "" is always wrong: the fallback exists so an
  // empty value never matches, and here an empty value is the passing case.
  const WF_DIR = new URL('../../.github/workflows/', import.meta.url);

  test('no workflow or script compares a defaulted expansion against the empty string', () => {
    const files = [
      ...readdirSync(WF_DIR).filter((f) => f.endsWith('.yml')).map((f) => [f, readFileSync(new URL(f, WF_DIR), 'utf8')]),
      ...readdirSync(SCRIPT_DIR).filter((f) => f.endsWith('.sh')).map((f) => [f, readFileSync(new URL(f, SCRIPT_DIR), 'utf8')]),
    ];
    assert.ok(files.length >= 7, `expected to scan the workflows and shell scripts, saw ${files.length}`);

    const offenders = [];
    for (const [name, text] of files) {
      text.split('\n').forEach((line, i) => {
        if (/\$\{[A-Za-z_][A-Za-z0-9_]*:-[^}]*\}"?\s*(=|!=)\s*""/.test(line)) {
          offenders.push(`${name}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `a defaulted expansion can never equal "":\n${offenders.join('\n')}`);
  });

  test('the fixed check uses an empty-string test', () => {
    assert.match(VERIFY, /\[\s+-z\s+"\$missing"\s+\]/, 'the missing-table check must use -z');
  });

  test('the sentinel checks that ARE correct are left alone', () => {
    // These compare against "0"/"1", which an empty value never equals — so an
    // unanswered query fails closed. They must keep their defaults.
    assert.match(VERIFY, /\$\{rlsoff:-1\}"\s*=\s*"0"/);
    assert.match(VERIFY, /\$\{tables:-0\}"\s+-ge\s+20/);
  });
});

/**
 * The production release deploys the portal and the Edge Functions together.
 * This step used to warn and `exit 0` when its credentials were absent, so a
 * release could report success having deployed only half of itself — the new
 * sign-in page against the previous invite-user, which emails a magic link
 * saying "no password needed" to a client who lands on a password form.
 */
describe('Release to PRODUCTION: Edge Function deploy', () => {
  const STEP = runBodyOf('Deploy Edge Functions to the PRODUCTION Supabase project', prodYaml);

  function run(env) {
    // A stub on PATH so a successful path does not shell out to the real script.
    const dir = mkdtempSync(join(tmpdir(), 'roxium-fn-'));
    writeFileSync(join(dir, 'deploy-functions.sh'), '#!/usr/bin/env bash\necho DEPLOYED\n');
    chmodSync(join(dir, 'deploy-functions.sh'), 0o755);
    return spawnSync('bash', ['-e', '-c', STEP.replace('bash scripts/deploy-functions.sh', `bash ${dir}/deploy-functions.sh`)], {
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: '', PROJECT_REF: '', ...env },
    });
  }

  test('refuses the release when BOTH credentials are missing', () => {
    const r = run({});
    assert.notEqual(r.status, 0, 'a half-deployed release was allowed');
    assert.match(r.stdout + r.stderr, /::error::Cannot deploy Edge Functions/);
  });

  test('refuses when only the access token is missing, and names it', () => {
    const r = run({ PROJECT_REF: 'abc123' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /SUPABASE_ACCESS_TOKEN/);
    assert.doesNotMatch(r.stdout, /SUPABASE_PROJECT_REF/, 'named a secret that was actually present');
  });

  test('refuses when only the project ref is missing, and names it', () => {
    const r = run({ SUPABASE_ACCESS_TOKEN: 'tok' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /SUPABASE_PROJECT_REF/);
    assert.doesNotMatch(r.stdout, /SUPABASE_ACCESS_TOKEN/, 'named a secret that was actually present');
  });

  test('deploys when both are present', () => {
    const r = run({ SUPABASE_ACCESS_TOKEN: 'tok', PROJECT_REF: 'abc123' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /DEPLOYED/, 'the deploy script was not reached');
  });
});
