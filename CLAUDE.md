# Smart Scan

Scratcher (California Lottery instant ticket) tracking for Route 66 Liquor. Phone-first web app:
static pages on GitHub Pages, backend in Google Apps Script, data in Google Sheets (moving to Supabase on Dec 1, 2026).

- Live app: https://iyadshaheen90.github.io/smart-scan/src/index.html (Pages serves the repo root, so pages live under `/src/`)
- Backend URL: `SMART_SCAN_API_URL` in `src/config.js` (one Web App deployment, updated in place so the URL never changes)
- Control spreadsheet (script is bound to it): `1vw4smk5W-bxgatatQzb71rE0tbOLe9g0Ed88Nyn1PZA`
- Progress and what's next: the plan file `~/.claude/plans/smart-scan-plan-sorted-nebula.md`, section
  "▶ PROGRESS — pick up here". Read it first. Older history: `smart-scan-plan-archive.md`; original design and the
  multi-store FUTURE plan: `smart-scan-plan-reference.md` (same folder). Open those only when needed.

## Details live in docs/ (read only the one the task needs)

| File | Read it when |
|---|---|
| `docs/business-rules.md` | changing counting, sales, days, months, roles/permissions, inventory, scanning, or mistake recovery (undo) |
| `docs/code-map.md` | changing a page or backend file: what each one does, UI look, saved answers, Help & FAQ, back pills, conventions |
| `docs/supabase.md` | database, sign-in, emails, the import, or porting a backend action to the database |
| `docs/testing.md` | choosing which tests to run (full list with what each covers) |

**Keep this file small (under ~10 KB).** New details go in the matching docs file, not here. Only a new standing rule
that applies to almost every change belongs below.

## Layout

- `src/` frontend, plain HTML + JS, no build. `api.js` = `api(action, params)` + session; `nav.js` header/tab bar;
  `style.css` shared tokens; `sw.js` cache-first service worker; `faq.js` Help & FAQ text (en/es/ar).
- `src/apps-script/` backend (one global scope, pushed with clasp). `WebApp.js` router (`owner: true` / `allow: [...]`).
- `supabase/` migrations, functions and tests for the database version. `test/` backend scenarios, `test/browser/`
  headless Chrome page tests, `test/parity/` Sheets vs Supabase.
- 2 boxes × 24 slots. Ticket order per slot (descending/ascending): all math goes through `Tickets.js` and api.js's
  copy, never a hard-coded "+ 1".

## Standing rules (owner's)

- **Design:** every UI change like a senior UI designer: clean, clutter free, modern, professional, user friendly.
  Decide hierarchy and grouping first; check a phone-size screenshot. Always dark; tokens in `style.css`.
- **Numbers are never cut off:** `fit` on the box + `fitText`/`fitNumbers` (nav.js); grids use `minmax(0, 1fr)`.
- **Wording:** Title Case for titles, buttons, labels, tabs, chips; sentences stay sentence case.
- **Back pills only through the header** (`data-back` / `data-back-label`); the name pill always stays top right.
- **Third-party tool:** never claim lottery approval; no game names, lottery logos or ticket pictures anywhere; screens
  say "the lottery", never "CA Lottery".
- **Employees never see dollars** (server strips them; pages hide them; also in Help & FAQ).
- **Every action needs a way back** (the owner tests by making mistakes). See "Mistake recovery" in business-rules.
- **Help & FAQ:** when a feature, button name or rule changes, update its answer in `faq.js` in all three languages.
- **Database move:** every new or changed backend action, field, permission or rule is ported to Supabase (with a
  parity test) or added to the migration plan's "Added during the move" list, and the owner is told.
- **The repo is public:** the retailer number, emails, passwords and keys never go in code, tests, git or notes.
- **Live deploys need the owner's OK** for each change.

## Code conventions

Every write runs inside `withLock`; validate the whole request before writing anything; errors are
`ApiError(code, message)` with a message the person at the counter can act on. New sheet columns go at the **end** of
a tab; call `ensureHeaders` before writing one and read them defensively (`dateLabel(undefined)` is "undefined").
`SlotState.remaining_count` is a formula column that must not move.

## Data (one spreadsheet per month, "Smart Scan — YYYY-MM", in Drive folder "Smart Scan Monthly Sheets")

Users, Sessions, SlotConfig, SlotState, ReserveInventory, Shipments, ReserveAdjustments, DailyCloseLog,
DailySummary, PackHistory, ShiftCloses, ShiftCloseLog (the last two from Oct 2026; added on first use before that).
Columns are in `Schema.js`. The owner reads these after each close but should not hand-edit them.

## Test and deploy

Run only the tests that cover the change (list in `docs/testing.md`), plus `node test/sw-version.js` for page changes.

```sh
npx @google/clasp push -f                 # push backend (clasp isn't installed globally; already logged in)
npx @google/clasp update-deployment AKfycbynoVRwuSj_n5VLMy4R3ZtfaPY4PMIzV0yrjCW-UU8hSlpfBmXhKu4Dy-SzcQ9pXtGJ -d "<what changed>"
git push origin main                      # publishes the pages (GitHub Pages, ~1 min)
```
Deploy the backend before the pages when a page needs a new action. Pages: bump `CACHE` in sw.js +
`node test/sw-version.js --update` before every pages push. After deploying, `curl -sL "$URL"` should return
`{"ok":true,...,"slots":48}`, and an unknown-but-registered action should answer `unauthorized` (not `unknown_action`).
