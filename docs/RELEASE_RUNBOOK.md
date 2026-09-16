# Release Runbook

**The normal release, start to finish. Seven steps, no command line, no setup.**

---

## THE NORMAL RELEASE

| | Step | You do |
|---|---|---|
| **1** | Claude finishes the work and opens a pull request | nothing |
| **2** | GitHub runs the tests automatically | nothing — wait for the green tick |
| **3** | You merge the pull request | click **Merge** |
| **4** | Staging updates itself a few minutes later | nothing |
| **5** | You test it | open **https://staging.roxium.com/portal/** and work through `docs/ACCEPTANCE_CHECKLIST.md` (~10 min) |
| **6** | You approve the production release | **Actions ▸ Release to PRODUCTION ▸ Run workflow**, type `RELEASE`, then **Approve and deploy** |
| **7** | Production verifies itself | nothing — the run smoke-tests the live site and fails if anything is wrong |

**Merging to `main` does NOT reach customers.** It only updates staging. Nothing
reaches customers until you click **Approve** in step 6.

**If anything is red, stop and tell Claude.** You do not need to diagnose it.

---
---

# Advanced

Nothing below is needed for a normal release.

## 1 · Claude finished a feature. What happens?

Claude pushes a branch and opens a pull request. GitHub immediately runs
**Verify**: JavaScript syntax, unit tests, browser tests, and a check that the
live database still matches what the code expects.

You'll see a green tick or a red cross on the pull request. **A red cross means
do not merge** — ask Claude to fix it.

## 2 · Where do I see staging?

**https://staging.roxium.com/portal/**

It updates automatically a few minutes after a pull request is merged to `main`.
You'll know it's staging: there's a gold **STAGING** badge in the bottom-left
corner, and the data is all obviously fake ("Northstar Facial Surgery (TEST)").

To check it deployed: **GitHub ▸ Actions ▸ Deploy to STAGING** — the newest run
should be green.

## 3 · How do I know the automated tests passed?

**GitHub ▸ Actions.** Green tick = passed, red cross = failed.

The staging deploy will not run if the tests fail, and the production release
will not run if the tests fail. You do not have to police this.

## 4 · What do I manually check?

Open staging and work through **`docs/ACCEPTANCE_CHECKLIST.md`**. It takes about
ten minutes and covers the client portal, the team dashboard, and two security
checks. Anything that looks wrong: stop, and tell Claude before releasing.

## 5 · How do I approve production?

1. **GitHub ▸ Actions ▸ Release to PRODUCTION**
2. **Run workflow** (right-hand side). Leave the branch as `main`.
3. In the **confirm** box type: `RELEASE`
4. Press the green **Run workflow** button.
5. The run pauses at **Review deployments**. Click it, then **Approve and deploy**.

Before it will even ask for approval, it checks that the tests pass and that
staging is healthy **and running the exact commit you're releasing**. If staging
is behind, it stops and tells you.

## 6 · How do I know production succeeded?

The run turns green and the summary shows the commit and URL.

The last step is an automatic smoke test of the real site: the pages load, the
assets load, the legal pages still work, and the database is reachable and still
refusing anonymous access. **If that fails, the release is marked failed.**

To confirm by eye: open **https://roxiumstudio.com/portal/**. The footer shows
`build <sha>` — it should match the commit you released. There should be **no**
STAGING badge.

## 7 · What do I do if production looks wrong?

**Roll the frontend back first, diagnose second.** See `docs/ROLLBACK.md` — it is
a three-click operation in the Cloudflare dashboard and takes under a minute.

Then tell Claude what you saw. Do not try to fix production by hand.

## 8 · How do I roll back the frontend?

1. **Cloudflare ▸ Workers & Pages ▸ roxium-portal ▸ Deployments**
2. Find the last known-good **Production** deployment.
3. **⋯ ▸ Rollback** ▸ confirm.

Live in seconds. Full detail, and what to do about the database, in
`docs/ROLLBACK.md`.

---

## Versioning

Releases are tagged `vMAJOR.MINOR.PATCH` — see `docs/RELEASE_RUNBOOK.md#versioning`
below and GitHub ▸ Releases.

- **MAJOR** — a change customers must be told about
- **MINOR** — a new capability (`v1.4.0`)
- **PATCH** — a bug fix (`v1.4.1`)

**To cut a release:** GitHub ▸ Releases ▸ *Draft a new release* ▸ *Choose a tag*
▸ type the new version ▸ *Generate release notes* (GitHub writes them from the
merged pull requests) ▸ **Publish**.

**What is production running?** `https://roxiumstudio.com/version.json` gives the exact
commit, build time and environment. The portal footer shows the same short SHA.

**What changed since the last release?** GitHub ▸ Releases shows the generated
notes, or compare tags: `github.com/ROXIUMDashboard/Roxium-portal/compare/v1.3.0...v1.4.0`.

You never edit a version number in a file — nothing in the codebase stores one.

---

## If something is misconfigured


Every workflow **fails closed with a clear message** rather than guessing. If a
deploy stops with *"Staging is not configured yet"* or *"missing
CLOUDFLARE_API_TOKEN"*, the fix is in `docs/EXTERNAL_SETUP.md`.

## Setting staging up in the first place

`docs/EXTERNAL_SETUP.md` — **STAGING FIRST-TIME SETUP FOR MAX**. Six actions,
done once. It is not part of a release.

## Resetting staging test data

**Actions ▸ Reset STAGING Data ▸ Run workflow**, type `RESET STAGING DATA`.
Useful before testing a new version, so every test starts from the same
fixtures. Data only — it never changes the schema, and it cannot target
production.
