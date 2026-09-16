# Testing

Before this pass the portal had **zero** automated tests. It now has a foundation
that runs on every push with **no secrets and no network dependencies**.

```bash
npm run test:unit     # Node's built-in runner — 36 assertions, ~0.2s
npm run test:e2e      # Playwright — builds, serves and drives the real app
npm test              # both
npm run verify:schema # read-only production drift check
```

CI runs all of it in **`.github/workflows/verify.yml`** on every branch and pull
request, and both deploy workflows call it as a gate.

---

## What exists

### Unit tests — `tests/unit/` (36 assertions)

| File | Covers |
|---|---|
| `env-resolution.test.mjs` | Every branch of the environment resolver: production still resolves; unknown hosts, host/build mismatches, unknown stamps and unconfigured environments all **fail closed**; no host is claimed by two environments; the production apex is not caught by the preview-suffix rule. |
| `staging-guard.test.mjs` | The guard between the seed tooling and production: the production ref is refused in every casing and form, junk targets are refused, deny-by-default holds, and a legitimate staging target passes. |
| `staging-fixtures.test.mjs` | All 22 documented scenarios are covered by a fixture; every seeded email is on `.test`; no fixture mentions the production project; the guard runs before the first write in `main()`. |

These are deliberately written as **safety properties** ("must NOT resolve to
production"), not mechanics, so they keep their meaning as the code changes.

### Browser tests — `tests/e2e/` (16 passing, 7 skipped)

The suite builds a real bundle with `scripts/prepare-pages.sh` and serves it
through `scripts/serve-local.mjs`, which reproduces the Cloudflare `_redirects`
contract — so routing is exercised the way production actually routes.

`tests/e2e/support/offline.js` stubs the CDN libraries (`supabase-js`,
`chart.js`), `config.js` and the backend, so the **real `app.js` boots** with no
network and no credentials.

| File | Covers |
|---|---|
| `public-pages.spec.js` | Landing page loads with no fatal JS errors; no unsubstituted `BUILD_SHA`; `/privacy` and `/terms` serve themselves rather than being swallowed by the SPA fallback; `/portal` redirects to `/portal/` without looping; `app.js`/`styles.css`/`config.js` all return 200; `version.json` reports the built environment. |
| `auth-gate.spec.js` | A visitor with no session sees the login card; the authenticated shell stays hidden; deep-linking to `#operations` reveals no operations dashboard; the portal is `noindex`. |
| `env-safety.spec.js` | An unconfigured environment opens **no** Supabase connection at all (asserted by intercepting every request to `*.supabase.co` and finding none), `CONFIG` is null, and the failure is explained on screen rather than being a blank page. |
| `responsive.spec.js` | No horizontal overflow at phone width; the login card fits the viewport. Runs at both desktop and Pixel 7 sizes. |

### Staging-only tests — `tests/e2e/staging/`

These need a real seeded staging environment and **skip themselves** until
`STAGING_BASE_URL` is set, so CI stays green before staging exists. Two are
written and will pass as soon as staging is up:

- the staging deployment is unmistakably staging (badge + `version.json`)
- **staging is not pointing at the production database** — asserted directly
  against `CONFIG.SUPABASE_URL`

The remaining journeys are declared as `test.fixme` — they are the acceptance
target for the staging bring-up, not silent gaps:
client A sees only practice A · client A cannot reach practice B by URL · the
team fixture can open the Operations dashboard · Needs Attention renders the
seeded risk scenarios · sign-out returns to the login card.

---

## What remains intentionally manual

- **Visual design.** No screenshot-diff suite. The design language is the
  judgement call in `handoff/07_FRONTEND_DESIGN_SYSTEM.md`, and a pixel-diff
  suite would mostly generate noise. Covered by the acceptance checklist.
- **Email delivery.** Whether an invite actually lands in an Outlook inbox is a
  DNS and reputation question, not something CI can assert.
- **Real OAuth journeys.** Connecting a real Meta or Google account needs a human
  and a real consent screen.
- **The full acceptance pass.** `docs/ACCEPTANCE_CHECKLIST.md`, ~10 minutes
  before each release.

## Known expected failures — *not* to be "fixed" by changing the product

Per the brief: where current behaviour is intentionally wrong and scheduled for
Product Pass 1, it is **documented, not silently corrected**.

| Behaviour | Why it is not tested as correct | Scheduled |
|---|---|---|
| Reach reads `0` instead of "no data" in aggregates | The bug is real (`handoff/10_…` R-01/R-02). A test asserting `0` would cement it. | Product Pass 2 |
| "Due today" is labelled "due tomorrow" | R-08. Asserting today's strings would lock in the off-by-one. | Product Pass 2 |
| Account Approvals queue is unreachable | R-03: `shouldCreateUser:false` contradicts the approvals design. Staging fixture 15 seeds a pending account so the *screen* can be reviewed. | Product Pass 1 |
| Removed users can still authenticate | R-05. Fixture 17 seeds a revoked user so current behaviour is visible on staging. | Product Pass 1 |

## Adding a test

Unit tests go in `tests/unit/*.test.mjs` using `node:test` — no dependencies.
Browser tests go in `tests/e2e/*.spec.js`; call `stubPortal(page)` from
`support/offline.js` if the test needs the app to boot. Anything requiring a real
backend belongs in `tests/e2e/staging/` and must skip cleanly when
`STAGING_BASE_URL` is unset.
