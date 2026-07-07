# Auth email — branding + Outlook deliverability

Two independent things, kept separate on purpose:

| Layer | What it controls | Where it lives |
|-------|------------------|----------------|
| **Branding / copy** | How the invite & sign-in emails look and read | Supabase dashboard templates + `docs/email-templates/*.html` |
| **Deliverability / infra** | Whether the email actually lands (esp. Outlook) | SMTP provider + DNS (SPF/DKIM/DMARC) |

Cosmetic template changes do **not** fix Outlook. Deliverability is a DNS/SMTP problem. Do both.

---

## Part 1 — Branding (template + copy)

The auth emails are rendered by **Supabase**, not the app, so the HTML lives in the dashboard. Paste the repo templates in:

**Supabase → Authentication → Emails → Templates**

| Template | Subject to set | Paste file |
|----------|----------------|-----------|
| **Invite user** | `Your ROXIUM portal invitation` | `docs/email-templates/invite.html` |
| **Magic Link** | `Your ROXIUM sign-in link` | `docs/email-templates/magic-link.html` |

Also set **From name** = `ROXIUM Portal` and **From email** = `no-reply@roxium.com` (Part 2).

### Role capitalization
- **In-app** (roster/access lists): fixed in `app.js` via `roleLabel()` — shows **Owner**/**Member**, not `owner`.
- **In the invite email**: the `invite-user` Edge Function now passes `role_label` ("Owner"/"Member") in user metadata, so the template shows it via `{{ .Data.role_label }}`. Redeploy the function after merge: `supabase functions deploy invite-user`.

### Supabase template limitations (so expectations are set)
- **Go `text/template`**, not full templating — no `title`/`upper` filters, hence pre-capitalizing `role_label` in the function.
- **No web fonts** in email — the templates use a Georgia serif wordmark as the ROXIUM stand-in (custom fonts won't load in Outlook/Gmail).
- **Inline CSS + tables only** — `<style>` blocks and flexbox are stripped/ignored by Outlook's Word engine; the templates are table-based and Outlook-safe.
- **Variables available**: `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .SiteURL }}`, `{{ .Token }}`, `{{ .Data.* }}` (invite metadata). `{{ .Data.role_label }}` is only present on the **Invite** email (Magic Link has no role).

---

## Part 2 — Outlook deliverability

### Why Outlook fails while Gmail/Yahoo don't
Gmail and Yahoo are relatively lenient with a new/shared sender. **Microsoft (Outlook / Hotmail / Office 365) is the strictest** major provider and will **silently block or junk** mail that:
- comes from a **shared sender** with no reputation, and/or
- has **no domain authentication aligned to the From domain** (SPF + DKIM), and/or
- has **no DMARC record**, and/or
- has a **sender domain that doesn't match the link domain** in the body.

### Most likely root cause here
Auth emails are almost certainly still going through **Supabase's built-in email service** (custom SMTP not enabled). That service:
- sends from a **shared Supabase domain**, not `roxium.com`,
- so SPF/DKIM are **not aligned to roxium.com**,
- the body links point to **roxium.com** → **sender/link domain mismatch**,
- and it's **rate-limited (~2–4/hour)** and test-only.

That combination is exactly what Microsoft blocks. Gmail/Yahoo let it through; Outlook doesn't. **This is not "Outlook is strict" hand-waving — it's missing domain auth + a shared sender.**

### The fix (simplest production-ready path): Resend custom SMTP + domain auth
You already have a `RESEND_API_KEY`. DNS is on Cloudflare, so this is quick.

**1. Verify `roxium.com` in Resend**
- Resend → **Domains → Add Domain** → `roxium.com` (or a subdomain like `mail.roxium.com` to isolate sending reputation — recommended).
- Resend shows records: a **DKIM** `TXT` (or CNAMEs), an **SPF**/return-path (`MX` + `TXT`).
- Cloudflare → **DNS → Records** → add each **exactly**, **DNS-only (grey cloud)**.
- Verify in Resend → wait for green.

**2. Add DMARC** (Microsoft strongly favors it — this is the single biggest Outlook lever)
- Cloudflare → DNS → add `TXT`:
  - **Name:** `_dmarc`
  - **Value:** `v=DMARC1; p=none; rua=mailto:dmarc@roxium.com; adkim=s; aspf=s`
- `p=none` monitors without affecting delivery; you can tighten to `quarantine` later.

**3. Point Supabase Auth at Resend SMTP**
- Supabase → **Authentication → Emails → SMTP Settings** → enable **Custom SMTP**:
  - Host `smtp.resend.com` · Port `465` · User `resend` · Pass = `RESEND_API_KEY`
  - **Sender email** `no-reply@roxium.com` (must be on the verified domain — this makes sender domain == link domain, killing the mismatch)
  - **Sender name** `ROXIUM Portal`
- Supabase → **Authentication → Rate Limits** → raise **emails/hour** for real onboarding volume.

**4. Keep subjects/from clean** (already handled by the templates): no ALL-CAPS, no "FREE", a real reply-able-looking domain.

### Why this specifically fixes Outlook
- SPF + DKIM **aligned to roxium.com** → passes Microsoft authentication.
- **DMARC present** → Microsoft trusts the domain far more.
- **From = `@roxium.com` = link domain** → no mismatch flag.
- **Dedicated sender** (Resend) with real reputation instead of a shared test sender.

### Do we need Resend/custom SMTP? — Yes.
There is **no reliable Outlook fix without custom SMTP + domain auth.** Staying on built-in Supabase email means no aligned SPF/DKIM for roxium.com, which Outlook rejects. (Any SMTP provider works — SendGrid/Postmark/SES — but Resend is already wired.)

### SQL changes? — No.
Nothing in this whole pass needs a migration. Branding = templates + one Edge Function metadata field; deliverability = DNS + SMTP settings.

---

## How to test Outlook after the fix
1. Create a **real outlook.com / hotmail.com** test address (and ideally an Office 365 one).
2. From Access & Invites, send it an invite (or request a magic link at roxium.com).
3. Check **Inbox and Junk**. Landing in Junk (not blocked) = auth is working, reputation is warming.
4. Send yourself one to Gmail and open **Show original** → confirm **SPF: PASS, DKIM: PASS, DMARC: PASS**, and that `From` is `@roxium.com`.
5. Use **[mail-tester.com](https://www.mail-tester.com)**: send an invite to the address it gives you → aim for **9–10/10**; it flags any missing SPF/DKIM/DMARC.
6. Optional (ongoing): enroll the domain in **Microsoft SNDS + JMRP** (postmaster.live.com) for Outlook reputation visibility and complaint feedback.
7. If Outlook still blocks after 24–48h with all three PASS, submit the domain via the **Microsoft Sender Support / mitigation** form — but with aligned SPF/DKIM/DMARC that's rarely needed.
