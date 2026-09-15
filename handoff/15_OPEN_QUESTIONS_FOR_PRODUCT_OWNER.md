# 15 · Open Questions for the Product Owner

Only questions that **cannot be answered by reading the code**. Each has a real product,
business or security trade-off, names what is blocked by it, and states my recommendation
so a one-line answer is enough.

---

## Q1 · Should a stranger be able to create an account and request access? — **blocks Pass 1**

The code and the design disagree. `app.js` passes `shouldCreateUser: false`, so no account
is ever created from the login page; the whole Account-Approvals queue is therefore
unreachable. The migrations, the waiting-room UI and the Team Controls panel were all
built for the opposite behaviour.

- **(a) Invite-only.** Nobody gets an account unless ROXIUM creates it. Highest security,
  zero inbound friction to manage — and the Account-Approvals feature gets deleted.
- **(b) Self-service request + manual approval.** Anyone can sign up and lands in a
  waiting room with no data access. Matches "invite-first with manual approval fallback",
  but it means any address on the internet can create an auth user and receive a
  Supabase email, so it needs rate limiting and probably a captcha.

**Recommendation: (a) for now**, because it is what the code already does and what the
current client base needs; revisit when self-service onboarding is actually a goal.
**Related and urgent either way:** confirm the Supabase dashboard "Allow new users to
sign up" setting matches the answer. Right now the code says closed and the project
setting is unknown — with a public anon key, that ambiguity is itself the risk.

## Q2 · Keep, restrict, or remove join links and domain auto-join? — **blocks Pass 1**

Two side doors bypass invite-only entirely: a permanent 8-character `?join=CODE` link that
grants practice membership to anyone who has it, and domain auto-join that admits
**everyone** at a registered domain automatically and forever.

- **(a) Remove both.** Simplest and safest; invites become the only path.
- **(b) Keep join links, hardened** — expiry, max uses, visible in Team Controls, and
  `join_code_practice` revoked from `anon`.
- **(c) Keep both.** Genuinely convenient for a large practice onboarding ten staff at
  once, at the cost of a standing grant nobody reviews.

**Recommendation: (b).** A one-time, expiring practice link is a real onboarding
convenience; a permanent domain grant is a liability that nobody will remember to revoke.

## Q3 · What should Reach show for a Google-Ads-only client? — **blocks Pass 5**

Reach exists for Meta and is structurally unavailable from the Google Ads report the
pipeline uses. Today aggregates print a confident `0`.

- **(a) Show "—" / "Not available for Google Ads"** and label reach as a Meta metric.
- **(b) Remove Reach from any dashboard where no reach-bearing source is connected.**
- **(c) Invest in a Google reach-capable report** so the number exists for both.

**Recommendation: (a)**, with (b) for the default card set. Showing a client a zero for a
metric that was never measured is worse than showing nothing. (c) is a real project and
should not gate the honesty fix.

## Q4 · Composio, or ROXIUM's own Google/Meta apps? — **blocks Pass 5, shapes long-term cost**

Today Composio holds every practice's token; ROXIUM registers no developer app and stores
no token. That removed a whole class of refresh bugs. It also means ROXIUM's own
already-approved Google Ads Basic Access is **not being used**, and marketing data depends
on a third party's shared quotas.

- **(a) Stay fully on Composio.** Least engineering, ongoing per-connection cost, shared
  developer-token quota, a vendor in the middle of client data.
- **(b) First-party OAuth for Google (and later Meta).** Uses the approval you already
  have, removes the quota ceiling and the vendor — but ROXIUM becomes responsible for
  storing and refreshing client tokens (the dead `platform_tokens` table and
  `providerConfig()` would come back to life), and for Meta app review.
- **(c) Hybrid** — first-party where approval already exists, Composio for the long tail.

**Recommendation: (c)**, but only after Passes 0-4. This is the single largest
architectural decision on the table and it is not urgent; the current pipeline works.

## Q5 · Is the Coefficient / Google Sheets pipeline being retired? — **blocks Pass 4**

Two complete ingestion systems are live, each with its own config table, its own status
model and its own alerts, and a practice can raise contradictory alerts from both.

- **(a) Retire sheets.** Migrate everyone to Composio connections and delete
  `sheet_sources`, `sync-coefficient` and the whole Team-Controls reporting-admin surface.
  A large simplification.
- **(b) Keep both indefinitely** as the manual fallback for platforms with no connector.
- **(c) Keep the sheets path for internal/manual channels only**, and make Composio the
  only client-facing one.

**Recommendation: (c)**, with a written deprecation date. Carrying two full pipelines is
the largest source of duplicated logic in the product.

## Q6 · Which events email the client, and which stay internal?

Deliverable completions currently create an in-app notification but deliberately do **not**
email; a whole-phase completion does email. Overdue items, sync failures and connection
errors notify nobody at all.

Needed: a one-page policy of *event → client email / client in-app / team-only*. The
obvious tension is that "we're late" and "your data stopped flowing" are exactly the
things the portal is supposed to catch **before** the client notices — which argues for
telling the team loudly and the client selectively.

**Recommendation:** client emails for deliveries, milestones and monthly stats only;
everything operational (overdue, sync failure, connection error, approval pending) is
team-only and lands in Needs Attention. Waiting-on-client items are the one exception —
those should reach the client.

## Q7 · Should clients enter business metrics (revenue, consults, procedures, customers)?

The `kpi_monthly` table has legacy `cons`, `proc`, `apv`, `price` columns with **no
writer and no UI**, and no revenue or conversions concept at all. The stated goal is a
manual entry/calculator fallback — but the last product decision recorded in the code was
to drop business metrics from the default dashboard entirely.

- **(a) Team-entered only.** ROXIUM enters them monthly; no client work.
- **(b) Client self-entry.** Better data, but it breaks the "no data the client must give
  us" principle stated in `ARCHITECTURE.md` §3.
- **(c) Skip until a CRM integration provides them.**

**Recommendation: (a)** — it restores ROI reporting without asking the surgeon for
anything, and it is a small form plus the columns that already exist.

## Q8 · Should clients see deliverable due dates and overdue state?

Today they see status only (Delivered / In progress / Planned). Due dates, overdue flags
and phase health are deliberately internal.

Showing them is more transparent and is what "know what's next" implies; it also means
every missed internal date becomes a visible broken promise. This is a positioning
decision, not a technical one.

**Recommendation: show the *promised window* (e.g. "expected this month"), not the exact
internal due date, and never show an overdue flag to the client.** It keeps the
transparency benefit without converting internal slippage into a client-facing failure.

## Q9 · Should there be a read-only or practice-scoped team role?

Any `profiles.role='team'` user can read, edit and delete **every** practice, with no
audit log. That is fine for a small founding team and stops being fine the moment a
contractor, an account manager or a VA needs access.

**Recommendation:** not yet, but decide the trigger — e.g. "before the first non-founder
gets team access". Retrofitting scoping into ~40 `is_team()` policies later is
significantly more work than adding it once.

## Q10 · Is the software moving to its own domain?

`docs/DOMAIN_ARCHITECTURE.md` recommends `roxiumstudio.com` with the portal at
`app.roxiumstudio.com`, marketing staying on `roxium.com`. Nothing is implemented and
nothing in the code hard-codes a host.

It matters **now** because the email-deliverability work (Resend domain verification,
DKIM/SPF/DMARC, Supabase SMTP) is domain-specific. Doing it twice is wasted effort.

**Recommendation: decide before the email work in Pass 1**, not after. If the move is
likely, verify a sending subdomain that will survive it.

## Q11 · What is the target client scale over the next 12 months?

Several design choices are correct for ~10 practices and wrong for ~100: serial
per-practice sync (~20 Composio calls each in one invocation), full-table ops queries with
no pagination, `render()` rebuilding every view, and the unpaginated `listUsers` cap.

A number here decides whether Pass 4's concurrency work is urgent or premature.
**Recommendation:** if the answer is under ~25, Pass 4 item 3 can wait; over that, it
should move earlier.
