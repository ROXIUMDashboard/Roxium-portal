# Staging-only end-to-end tests

These run against a **real, seeded staging environment** and are skipped automatically
until one exists. They are the tests that cannot be faked offline: real auth, real RLS,
real tenant isolation.

Enable by setting, in the GitHub `staging` environment (or locally):

| Variable | Example |
|---|---|
| `STAGING_BASE_URL` | `https://staging.roxium.com` |
| `STAGING_CLIENT_A_EMAIL` | `owner.northstar@staging.roxium.test` |
| `STAGING_CLIENT_B_EMAIL` | `owner.brightpath@staging.roxium.test` |
| `STAGING_TEAM_EMAIL` | `team.ops@staging.roxium.test` |
| `STAGING_OTP_SECRET` | the shared test-OTP value configured on the staging Supabase project |

Run: `STAGING_BASE_URL=... npx playwright test tests/e2e/staging`
