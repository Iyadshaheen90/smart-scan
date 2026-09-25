# Smart Scan

Scratcher (California Lottery instant ticket) tracking for Route 66 Liquor. Phone-first web app:
static pages on GitHub Pages, backend in Google Apps Script, data in Google Sheets.

- Live app: https://iyadshaheen90.github.io/smart-scan/src/index.html (Pages serves the repo root, so pages live under `/src/`)
- Backend URL: `SMART_SCAN_API_URL` in `src/config.js` (one Web App deployment, updated in place so the URL never changes)
- Control spreadsheet (script is bound to it): `1vw4smk5W-bxgatatQzb71rE0tbOLe9g0Ed88Nyn1PZA`

## Store layout and ticket facts

- 2 boxes × 24 slots = 48 slots. Each slot has a price tier (`SlotConfig`); seeded from `INITIAL_SLOT_PRICES`.
- Tickets count **down** to 0; a pack whose top ("exposed") ticket is N has N + 1 left.
- Standard pack sizes by price (`STANDARD_PACK_SIZES`, kept in both `Schema.js` and `barcode.js`):
  $40/$30/$20 → 30, $10 → 50, $5 → 80, $3/$2 → 100, $1 → 240.
- Ticket back barcode: 26-digit ITF `GGGG PPPPPPP TTT 000000000 XXX` (game, pack, ticket). Printed
  `GGGG-PPPPPPP-C-TTT`; the check digit C isn't in the barcode. See `src/barcode.js`.

## Business rules

**Roles** (enforced server-side with `owner: true` in `WebApp.js`, and hidden in the UI)
- Employees: Close Day (where they mark packs **Sold out**) and a view-only Slots page. Nothing else — `endPack`
  outside Close Day is owner-only (owner's choice 2026-09-25: one place to mark sold out, fewer mis-taps).
- Owner: activate packs, returns, all undos, slot prices, pack sizes, move/swap, back stock, reopen a close, employees.
- Employees never see dollar totals (`summaryFor` strips them).

**Inventory**
- Back stock = `ReserveInventory` (packs in the back). Live = packs in slots (`SlotState`).
- Activating a pack takes one pack out of back stock (never below 0; `took_from_reserve` records whether it did)
  but it is still inventory. Total inventory value = live remaining × price + back stock tickets × price.
- Empty slot = "out of stock": adds nothing to sales or inventory; back stock untouched.

**Sales**
- Close Day: sold = last top ticket − today's top ticket. A pack activated today counts from its activation ticket.
- Ending a pack logs sales immediately in `DailyCloseLog`: sold out = all remaining; returned = tickets above the
  scanned top ticket (the rest go back). Close type `sold_out` / `returned`; Close Day rows are `close`.
- Day totals (`DailySummary`) = every `DailyCloseLog` row dated that day, so mid-day sold-outs are included.
- A pack ended **after** today's close is logged to the next day (`salesDate()`).
- One close per day (`already_closed`); the owner can reopen it (`reopenClose`).

**Mistake recovery** (the owner tests by making deliberate mistakes — every action needs a way back)
- Wrong-slot activation → `undoActivation` until the slot's first close: slot empties, old slot price comes
  back (`price_before_activation`), pack returns to back stock only if it came from there.
- Pack wrongly marked sold out/returned → `undoEndPack`, while the slot is still empty and that sales day
  isn't closed. If a replacement went in, undo that activation first.
- Swap/move is its own undo (swap the same two slots again).
- Wrong pack size → `setPackSize` (refused if a live pack's top ticket wouldn't fit). Wrong slot price → `setSlotPrice`.
- Wrong close → `reopenClose` restores every top ticket (found by pack, so moves after the close are fine).

**Months** (one spreadsheet per month, like the owner's monthly Excel workbook)
- The owner starts each month on `month.html`, on or after the 1st (never automatic; home shows a reminder from the 1st).
- `startNewMonth` copies the current month's whole spreadsheet, so `CARRIED_FORWARD_TABS` (Users, Sessions, SlotConfig,
  SlotState, ReserveInventory) carry over exactly, then empties the log tabs except rows already dated in the new
  month (`MONTHLY_LOG_DATE_COLUMNS`). Those rows move out of the old spreadsheet, so starting late loses nothing.
- Safe to retry: an unregistered copy left by a failed attempt is trashed; the new month is marked active before the
  old one is archived (`getCurrentMonth` picks the latest active). A second tap is refused (`already_started`).
- `DailyCloseLog.previous_close_date` lets reopen/undo restore a pack's last close even when it was in an earlier month.

**Scanning**
- Press-and-hold is the default everywhere; Auto scan is an opt-in toggle (Close Day remembers it per phone).
- Every scan screen also accepts the typed printed number (`parsePrintedTicket`).

## Code map

Frontend (`src/`, plain HTML + JS, no build):
- `config.js` backend URL · `api.js` `api(action, params)`, session in localStorage, `requireLogin(role)`, `whileBusy`
- `barcode.js` `parseTicketBarcode`, `parsePrintedTicket`, `STANDARD_PACK_SIZES` · `scanner.js` shared camera
  (zxing-wasm, `startScanner({... mode})` → `{ setMode }`) · `style.css` shared styles
- `index.html` home · `login.html` · `setup-owner.html` · `account.html` · `users.html` (owner)
- `slots.html` both boxes · `activate.html?box=&slot=` one slot: end pack, activate, undo, swap, prices, pack size
- `close.html` Close Day: walks live slots box 1 → 2, slot 1 → 24; a scan finds its slot by game+pack;
  Sold out / Skip (no "No sales" button — every live slot must be scanned; unchanged ticket = 0 sold); draft kept in localStorage until one `submitClose` call;
  anyone can **Clear all scans** (wipes this phone's draft only, e.g. after a practice close)
- `month.html` (owner) Months: this month's totals + per-day table, Start New Month, past months' totals
- `manifest.webmanifest`, `icons/`, `sw.js` home-screen app. The service worker is network-first for pages (a deploy
  shows on next load; the saved copy is only for when offline) and caches the pinned zxing CDN files. Registered in `api.js`.
  Bump `CACHE` in `sw.js` when its file list changes. The installed app has its own storage on iOS (sign in again there).
- `backstock.html` (owner) scan one ticket per game + enter packs; Shipment (adds) or Count (sets); remove packs
- `raw-scanner.html`, `backend-test.html` dev/test pages

Backend (`src/apps-script/`, pushed with clasp; all files share one global scope):
- `WebApp.js` `doPost` router: `PUBLIC_ACTIONS`, `SIGNED_IN_ACTIONS` (`owner: true` = owner only); `doGet` health check
- `Schema.js` tabs/headers, `CARRIED_FORWARD_TABS`, `STANDARD_PACK_SIZES`, `INITIAL_SLOT_PRICES`
- `Sheets.js` `readTable`, `appendObject`, `updateRowsWhere`, `deleteRowsWhere`, `ensureHeaders`, `withLock`, `setCell`
- `Months.js` active month lookup (Control → Months tab), `monthStatus`, `startNewMonth`, `listMonths`, `monthSummary` (totals from that month's DailySummary) · `Setup.js` one-time `setup()` (safe to re-run; adds missing columns)
- `Auth.js` / `Users.js` logins, sessions, owner setup code, employee management
- `Slots.js` `listSlots`, `activatePack`, `endPack`/`endPackInSlot`, `undoActivation`, `undoEndPack`,
  `swapSlots`, `setSlotPrice`, `setPackSize`, `addGameToReserve`
- `Close.js` `closeStatus`, `submitClose` (validates everything before writing), `buildSummary`, `reopenClose`, `salesDate`
- `Backstock.js` `listBackStock`, `saveBackStock(mode 'shipment'|'count')`, `removeBackStock`

Conventions: every write runs inside `withLock`; validate the whole request before writing anything;
errors are `ApiError(code, message)` with a message the person at the counter can act on.
New columns go at the **end** of a tab (existing sheets get them via `ensureHeaders`) — `SlotState.remaining_count`
is a formula column that must not move.

## Data (one spreadsheet per month, "Smart Scan — YYYY-MM", same Drive folder as Control)

Users, Sessions, SlotConfig, SlotState, ReserveInventory, Shipments, ReserveAdjustments, DailyCloseLog,
DailySummary, PackHistory. Columns are in `Schema.js`. The owner reads these after each close but should not
hand-edit them.

## Test and deploy

```sh
node --test src/*.test.js                 # barcode parsing
node test/backend-scenarios.js            # backend against a fake spreadsheet (store scenarios)
node test/new-month-scenarios.js          # Start New Month against fake Drive/Sheets (fakes in test/fakes.js)
npx @google/clasp push -f                 # push backend (clasp isn't installed globally; already logged in)
npx @google/clasp update-deployment AKfycbynoVRwuSj_n5VLMy4R3ZtfaPY4PMIzV0yrjCW-UU8hSlpfBmXhKu4Dy-SzcQ9pXtGJ -d "<what changed>"
git push origin main                      # publishes the pages (GitHub Pages, ~1 min)
```
After deploying, `curl -sL "$URL"` should return `{"ok":true,...,"slots":48}`, and an unknown-but-registered action
should answer `unauthorized` (not `unknown_action`).
