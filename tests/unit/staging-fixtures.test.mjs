// The staging fixture set is a contract: docs/STAGING_DATA.md promises 22 named
// scenarios. This test fails if a fixture edit silently drops one.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../scripts/seed-staging.mjs', import.meta.url), 'utf8');

describe('staging fixtures', () => {
  test('all 22 documented scenarios are covered by a practice or a user fixture', () => {
    const fromPractices = [...src.matchAll(/covers:\s*\[([0-9,\s]+)\]/g)]
      .flatMap((m) => m[1].split(',').map((n) => Number(n.trim())).filter(Boolean));
    // 15 (pending approval) and 17 (revoked) are user-level, not practice-level.
    const fromUsers = [];
    if (/approval_status:.*'pending'|key: 'pending'/.test(src)) fromUsers.push(15);
    if (/key: 'revoked'/.test(src)) fromUsers.push(17);
    const covered = new Set([...fromPractices, ...fromUsers]);
    const missing = [];
    for (let i = 1; i <= 22; i++) if (!covered.has(i)) missing.push(i);
    assert.deepEqual(missing, [], `scenarios not covered by any fixture: ${missing.join(', ')}`);
  });

  test('every seeded email uses the reserved .test TLD', () => {
    const emails = [...src.matchAll(/email:\s*'([^']+@[^']+)'/g)].map((m) => m[1]);
    assert.ok(emails.length >= 8, 'expected the user fixtures to be present');
    for (const e of emails) {
      assert.match(e, /@[a-z0-9.-]+\.test$/, `"${e}" is not on the reserved .test TLD`);
    }
  });

  test('no fixture references the production project ref', () => {
    assert.ok(!/nchtmeqsjkpcvtuscxfy/.test(src.replace(/PRODUCTION_PROJECT_REFS[\s\S]{0,200}/, '')),
      'seed fixtures must never mention the production project');
  });

  test('the guard runs before any write inside main()', () => {
    assert.match(src, /import \{ assertStagingTarget \}/);
    // Scope to main()'s body: helper functions are *defined* earlier in the file,
    // so raw file offsets would compare declaration order, not execution order.
    const body = src.slice(src.indexOf('async function main()'));
    const guardAt = body.indexOf('assertStagingTarget(URL_)');
    const writes = ["method: 'POST'", "method: 'DELETE'"]
      .map((m) => body.indexOf(m)).filter((i) => i > 0);
    assert.ok(guardAt > 0, 'guard is never invoked inside main()');
    assert.ok(writes.length > 0, 'expected main() to contain writes');
    assert.ok(guardAt < Math.min(...writes), 'guard must run before the first write in main()');
  });

});
