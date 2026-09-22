# 09 · Email & Transactional Comms

There are **two completely separate email systems** in this product, and conflating them
is the root of most of the reported email confusion.

| | System 1 · **Supabase Auth email** | System 2 · **Resend, from Edge Functions** |
|---|---|---|
| Sends | magic-link sign-in, OTP code, (invite type if ever used) | invite, update/deliverable, video-ready, weekly digest, demo request |
| Rendered by | **Supabase**, from dashboard templates | our own inline HTML in TypeScript |
| Sender | whatever Supabase Auth SMTP is set to | `EMAIL_FROM` secret (default `ROXIUM <updates@roxium.com>`) |
| Configurable from this repo | **No** — only the paste-in templates in `docs/email-templates/` | Yes |
| Rate limited | Yes, by Supabase (2–4/hour on the shared sender) | Resend limits |

---

## 1 · Supabase Auth email (the sign-in path)

Triggered by `sb.auth.signInWithOtp({email, options:{emailRedirectTo, shouldCreateUser:false}})`
(`app.js:612`). The email body, subject and sender are entirely Supabase's.

**Nothing in this repository configures it.** `supabase/config.toml` contains a
**commented-out** `[auth.email.smtp]` block (lines ~230-237) — that file is local-CLI
scaffolding and is never applied to the hosted project. So:

> **Whether custom SMTP is enabled is UNVERIFIED and can only be checked in the Supabase
> dashboard (Authentication → Emails → SMTP Settings).**

`docs/email-deliverability.md` is a careful, correct analysis of this and should be
treated as the spec. Its conclusion: auth emails are almost certainly still going through
Supabase's **shared** sender, which means

- SPF/DKIM are aligned to a Supabase domain, not `roxium.com`;
- the body links point at `roxium.com` → **sender/link domain mismatch**;
- there is likely no DMARC record;
- the sender has no reputation.

Microsoft (Outlook / Hotmail / Office 365) silently blocks or junks exactly that
combination while Gmail and Yahoo let it through. **That is the Outlook delay/block, and
it is a DNS + SMTP problem, not a code problem.**

The code already compensates for it in a smart way: because Outlook's link scanner can
*consume* a one-time magic link before the human clicks it, the login card reveals a
typed-code fallback (`#loginCodeRow`, `app.js:617-620`) and `verifyOtp` is tried as both
`type:'email'` and `type:'invite'` (`app.js:635-636`).

### The fix, as already documented
1. Verify `roxium.com` (or better, `mail.roxium.com`) in Resend; add the DKIM/SPF records
   in Cloudflare DNS as **DNS-only (grey cloud)**.
2. Add `_dmarc` TXT: `v=DMARC1; p=none; rua=mailto:…; adkim=s; aspf=s`.
3. Supabase → Authentication → Emails → SMTP Settings → Custom SMTP:
   host `smtp.resend.com`, port 465, user `resend`, pass = the Resend API key,
   sender `no-reply@roxium.com`, sender name `ROXIUM Portal`.
4. Raise the Supabase auth email rate limit.
5. Paste `docs/email-templates/invite.html` and `docs/email-templates/magic-link.html`
   into the Invite / Magic Link templates.

### Auth email templates (`docs/email-templates/`)
Two files, both Outlook-safe: table layout, inline CSS, no web fonts, no background
images, no flexbox. They use a **light** palette (`#F2EDE3` ground, white card) with a
Georgia-serif ROXIUM wordmark and a gold rule — deliberately different from the dark
in-app theme because dark email backgrounds render unpredictably.
Variables: `{{ .ConfirmationURL }}`, `{{ .Data.full_name }}`, `{{ .Data.role_label }}`.
`role_label` is pre-capitalised in `invite-user` because Supabase's Go `text/template`
has no `title` filter.

⚠ **These templates are documentation, not code.** Nothing reads them; if they were never
pasted into the dashboard, the auth emails are Supabase's unbranded defaults.

---

## 2 · Resend, from Edge Functions

All five senders POST directly to `https://api.resend.com/emails` with
`Authorization: Bearer $RESEND_API_KEY` and `from: $EMAIL_FROM`.

| Function | Trigger | Recipients | Subject |
|---|---|---|---|
| `invite-user` | team/owner invites someone | the invitee | `You're invited to your ROXIUM portal` |
| `notify-client` | `notifyClient(kind, msg)` from `app.js` | `practice_member_emails(practice_id)` — every membership + every `role='client'` profile of the practice | per kind: "A deliverable just shipped" / "You've hit a new milestone" / "Your latest performance update is ready" / "A new video is ready to watch" |
| `notify-video-ready` | team posts a finished video URL | same RPC | video ready |
| `weekly-digest` | cron `x-sync-key`, or a team JWT | `DIGEST_TO` if set, else every `role='team'` profile's auth email | internal ops digest |
| `book-demo` | public landing form | `DEMO_NOTIFY_EMAIL` | internal demo request |

**Design principle, consistently applied:** email never blocks the operation.
`invite-user` creates the account first and emails last inside a `try/catch`;
`notifyClient` fires the fetch with `.catch(()=>{})`; missing `RESEND_API_KEY` returns
`{ok:true, emailed:0, note:"…"}` rather than an error. Good for reliability, **bad for
observability** — nothing records a failed send. `notifications.emailed` exists in the
schema and is never written.

### Branded HTML
`invite-user` and `notify-client` share a polished dark template: `#0D0C10` ground,
`#141218` card with a `rgba(201,168,76,.35)` border, Georgia ROXIUM wordmark with the gold
**I**, gold CTA button, table-based and inline-CSS throughout — Outlook-safe.
`notify-video-ready` uses an **older, simpler div-based template** (`div` + flex-free but
not table-based) and is the one visual outlier.

### From address and links
- `EMAIL_FROM` default `ROXIUM <updates@roxium.com>` — **must be a Resend-verified
  sender** or every send 4xx's.
- Every CTA links to `SITE_URL + '/portal/'` (default `https://roxium.com/portal/`),
  which is correct: the site root is the marketing page.
- `weekly-digest` is **off by default** — it returns early unless `DIGEST_ENABLED=true`.

---

## 3 · Why the invite button may not send

In likelihood order, all verified against `supabase/functions/invite-user/index.ts`:

1. **`RESEND_API_KEY` is not set.** The function returns
   `{ok:true, invited:true, emailed:false, email_note:"Account created, but no invite
   email was sent — RESEND_API_KEY isn't configured yet."}`. The invite *succeeds*; only
   the email is skipped. ⚠ The function's own header comment claims Supabase's
   `inviteUserByEmail` is the fallback — **there is no such fallback in the code.**
2. **`EMAIL_FROM` is not verified in Resend** → `resend 4xx: …` in `email_note`.
3. **`SITE_URL` is unset** → `REDIRECT` is `undefined` → `generateLink` falls back to the
   project's Site URL; the link may then point at the wrong origin (the documented cause
   of post-login 404s).
4. **`generateLink` itself fails** (rate limit, unexpected user state) → thrown before
   Resend is called, captured into `email_note`.
5. **The UI does report it — read the flash message.** Both invite surfaces check
   `data.emailed === false` and print the `email_note` verbatim
   (`app.js:5696-5697` and `app.js:5733-5734`, e.g. *"<email> is set up and has access to
   <practice> — but the invite email didn't send (…). Finish email setup to deliver
   sign-in links."*). So the symptom is **not** a silent button: it is a success message
   that says the email did not send. That message contains the exact cause and should be
   the first thing captured when reproducing.
6. **Over 1000 users**: re-inviting an existing user relies on
   `listUsers({perPage:1000})` with no pagination and would fail with
   "Could not create the account".
7. **The function is not deployed.** `deploy-functions.yml` only fires on pushes touching
   `supabase/functions/**`.

## 4 · Why a welcome email may not send

"Welcome email" maps to two different things:
- **On approval**, the Account-Approvals UI checkbox "Send welcome email on approval"
  (`app.js:5531`) routes through `sendPracticeInvite(..., {sendEmail:true})` → the same
  `invite-user` path, so it has **identical** failure modes to §3.
- **There is no separate first-sign-in welcome email** anywhere in the codebase.

## 5 · Domain dependencies

| Dependency | Needed for |
|---|---|
| `roxium.com` verified in Resend (DKIM + SPF/return-path) | every Resend send |
| `_dmarc` TXT on `roxium.com` | Outlook deliverability |
| Supabase Auth custom SMTP → Resend | branded, deliverable **sign-in** emails |
| Supabase Site URL + Redirect URLs matching the served origin | magic links landing on the right host |
| `SITE_URL` secret matching the same origin | every CTA link in every email |
| Cloudflare DNS records added **DNS-only (grey cloud)** | Resend verification |

A domain move (e.g. to `roxiumstudio.com`, per `docs/DOMAIN_ARCHITECTURE.md`) touches
every row of that table plus the Pages custom domain. Nothing in the code hard-codes a
host, so the change is configuration-only.
