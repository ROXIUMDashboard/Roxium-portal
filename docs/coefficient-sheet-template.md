# Coefficient → `kpi_monthly` sheet template

This is the canonical layout for the Google Sheet that Coefficient (or any
marketing-data export) fills, and that a sync upserts into `kpi_monthly`.
It matches the Phase B schema exactly: every row is **one practice · one month ·
one source**, keyed by `(practice_id, period, source)` — so re-syncing a later
month can never overwrite an earlier one.

---

## Layout: ONE flat "tidy" sheet, one row per practice-month

> Do **not** use the wide 12-month-columns layout of the `.xlsx` workbook for the
> sync. That format is for the manual *Import KPI workbook* button. For an automated
> Coefficient feed, a tidy one-row-per-month sheet maps straight to a DB upsert.

### Key columns (identify the row)

| Column | Required | Format / example | Notes |
|---|---|---|---|
| `practice_id` | **yes** | `8f3c…` (UUID) | The robust key. Copy it from Supabase → `practices.id`. |
| `practice_name` | no | `Balikian Facial Plastics` | Human-readable only — **ignored by the sync**. Keep it so the sheet is readable. |
| `period` | **yes** | `2026-03` (or `2026-03-01`) | The reporting month. Stored as first-of-month `2026-03-01`. |
| `source` | no | `coefficient` | Defaults to `marketing` if blank. Lets marketing / coefficient / asana data coexist for the same month. |

**Why `practice_id` and not "one sheet per practice":** a single sheet with a
`practice_id` column is unambiguous, scales to any number of practices, and maps to
one upsert. One-sheet-per-practice means N tabs to maintain and a fragile
name→id lookup. Use the `practice_id` column. (Keep `practice_name` beside it just
so a human reading the sheet knows which practice each row is.)

### Metric columns (header = the exact DB key)

Use these **exact headers** so the sync is a direct column→column upsert. Leave a
cell blank if you don't have that metric for the month (blank = NULL, not zero).

| Header | Meaning | Unit |
|---|---|---|
| `spend` | Ad spend (all channels) | dollars |
| `impr` | Impressions & reach | count |
| `clicks` | Clicks | count |
| `lpv` | Landing page visits | count |
| `leads` | Leads captured (form + email) | count |
| `cons` | Booked consultations | count |
| `proc` | Procedures booked | count |
| `apv` | Average procedure value | dollars |
| `price` | Surgery pricing index (baseline 1.0×) | ratio |
| `sent` | Emails sent | count |
| `opens` | Emails opened | count |
| `eclk` | Email clicks | count |
| `sms` | SMS reply rate | fraction 0–1 (e.g. `0.18`) |
| `vid` | Video view rate | fraction 0–1 (e.g. `0.42`) |
| `foll` | Qualified followers added | count |
| `rank` | Social rankings index (baseline 1.0×) | ratio |
| `posts` | Cadence posts published | count |

> `sms` and `vid` are **fractions, not percentages** — enter `0.18`, not `18`.
> The portal renders them as %. (The `.xlsx` importer expects them as % and divides;
> the Coefficient sheet does not — store the raw 0–1 fraction.)

---

## Example rows

```
practice_id                           practice_name              period    source       spend   impr    clicks  lpv    leads  cons  proc  apv     price  sent   opens  eclk  sms   vid   foll  rank  posts
8f3c0b2a-...                           Balikian Facial Plastics   2026-01   coefficient  9800    412000  6100    3400   210    44    12    14500   1.05   8200   3100   540   0.16  0.39  320   1.4   18
8f3c0b2a-...                           Balikian Facial Plastics   2026-02   coefficient  10250   438000  6480    3610   228    51    15    14800   1.06   8600   3320   590   0.17  0.41  351   1.5   20
2a91d7e4-...                           Demo Practice              2026-02   coefficient  4200    180000  2600    1500   96     19    6     12000   1.00   3500   1180   210   0.12  0.33  140   1.1   12
```

A ready-to-paste header row is in **`coefficient-template.csv`** (same folder) —
import it into a new Google Sheet to start.

---

## How the sync should upsert (for whoever builds the Coefficient connector / Edge Function)

For each sheet row:

```sql
insert into kpi_monthly (practice_id, period, source, spend, impr, clicks, lpv,
  leads, cons, proc, apv, price, sent, opens, eclk, sms, vid, foll, rank, posts)
values ($1, ($2 || '-01')::date, coalesce(nullif($3,''),'marketing'),
        $4, $5, …)
on conflict (practice_id, period, source) do update
  set spend = excluded.spend, impr = excluded.impr, …;  -- all metric columns
```

- `period` from the sheet (`YYYY-MM`) becomes `YYYY-MM-01`.
- `month` is auto-derived by the `sync_kpi_month()` trigger — **do not** send it.
- The `on conflict (practice_id, period, source)` clause is what makes a re-sync
  update *that one month's* snapshot only, leaving every other month untouched.
- Blank cells → send `NULL` (not `0`), so "no data" stays distinct from "zero".

### Two integration options
1. **Manual-light (now):** Coefficient fills this sheet → export as `.csv` →
   a small script / Edge Function reads it and runs the upsert above.
2. **Automated (later):** a scheduled Supabase Edge Function (or Make/Zapier)
   reads the sheet via the Google Sheets API on a cron and upserts. Same SQL.

Either way the **sheet shape above is the contract** — keep the headers exact and
the sync stays trivial.
