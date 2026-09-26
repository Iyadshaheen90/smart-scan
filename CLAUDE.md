# Smart Scan

Scratcher (California Lottery instant ticket) tracking for Route 66 Liquor. Phone-first web app:
static pages on GitHub Pages, backend in Google Apps Script, data in Google Sheets.

- Live app: https://iyadshaheen90.github.io/smart-scan/src/index.html (Pages serves the repo root, so pages live under `/src/`)
- Backend URL: `SMART_SCAN_API_URL` in `src/config.js` (one Web App deployment, updated in place so the URL never changes)
- Control spreadsheet (script is bound to it): `1vw4smk5W-bxgatatQzb71rE0tbOLe9g0Ed88Nyn1PZA`
- Progress, decisions and what's next: the plan file `~/.claude/plans/smart-scan-plan-sorted-nebula.md`,
  section "▶ PROGRESS — pick up here". Read it first.

## Store layout and ticket facts

- 2 boxes × 24 slots = 48 slots. Each slot has a price tier (`SlotConfig`); seeded from `INITIAL_SLOT_PRICES`.
- Tickets count **down** to 0; a pack whose top ("exposed") ticket is N has N + 1 left.
- Standard pack sizes by price (`STANDARD_PACK_SIZES`, kept in both `Schema.js` and `barcode.js`):
  $40/$30/$20 → 30, $10 → 50, $5 → 80, $3/$2 → 100, $1 → 240.
- Ticket back barcode: 26-digit ITF `GGGG PPPPPPP TTT 000000000 XXX` (game, pack, ticket). Printed
  `GGGG-PPPPPPP-C-TTT`; the check digit C isn't in the barcode. See `src/barcode.js`.
- The store closes at **11 pm** (owner, 2026-09-26), so every close is before midnight. See "Days" below.

## Business rules

**Roles** (enforced server-side with `owner: true` in `WebApp.js`, and hidden in the UI)
- Employees: Close Day (where they mark packs **Sold out**) and a view-only Slots page. Nothing else — `endPack`
  outside Close Day is owner-only (owner's choice 2026-09-25: one place to mark sold out, fewer mis-taps).
- Owner: activate packs, returns, all undos, slot prices, pack sizes, move/swap, back stock (including its
  **Find a game** search and **Game ended**; owner's choice 2026-09-26: no employee version), reopen a close,
  months, employees.
- Employees never see dollar totals (`summaryFor` strips them).

**Inventory**
- Back stock = `ReserveInventory` (packs in the back). Live = packs in slots (`SlotState`).
- Activating a pack takes one pack out of back stock (never below 0; `took_from_reserve` records whether it did)
  but it is still inventory. Total inventory value = live remaining × price + back stock tickets × price.
- Empty slot = "out of stock": adds nothing to sales or inventory; back stock untouched. It shows the packs in back
  of the game last in it (`SlotState.last_game_number`, set when a pack sells out or is returned; falls back to this
  month's PackHistory) on Slots and the slot page (not in Close Day), unless that game has ended.
- A game's `ReserveInventory` row is also where its price and pack size are remembered, so rows are never deleted.
- **Game ended** (CA Lottery stopped the game): the owner hides it with `endGame`, allowed only with 0 packs in the
  back and none in a slot. It sets `ReserveInventory.ended_date`; the row stays, carries into each new month, and
  is listed under "Ended games" (Bring back = `bringBackGame`). Receiving or counting it, or activating a pack of
  it, clears `ended_date` by itself. Never automatic: only the owner decides a game has ended.

**Sales**
- Close Day: sold = last top ticket − today's top ticket. A pack activated today counts from its activation ticket.
- Ending a pack logs sales immediately in `DailyCloseLog`: sold out = all remaining; returned = tickets above the
  scanned top ticket (the rest go back). Close type `sold_out` / `returned`; Close Day rows are `close`.
- Day totals (`DailySummary`) = every `DailyCloseLog` row dated that day, so mid-day sold-outs are included.
- A pack ended **after** today's close is logged to the next day (`salesDate()`).
- One close per day (`already_closed`); the owner can reopen it (`reopenClose`).
- **Sending a close** (offline queue): Submit saves the close on the phone with a `closeId`, then sends it. With no
  connection it waits as "saved, not sent yet" and is resent (every 30s, when back online, when the app comes back
  to the front, and from the home page). The server answers a repeated `closeId` with the close it already saved
  (`DailySummary.close_id`), so a lost answer never saves it twice. A close dated before today is refused
  (`wrong_day`) rather than saved as the next day, which would block that night's close; its sales count in the
  next close. Any refusal drops the saved close and returns to the scans (the draft is kept).

**Days**
- A "day" is the calendar date in the script time zone (`todayLabel()`). Right while the store closes at 11 pm.
- It may close as late as 2 am in future years. Before then, a day must end after closing time (e.g. 4 am) in
  `todayLabel()`, `salesDate()`, the phone's draft and `wrong_day` date, and Start New Month, or a 1 am close lands
  on the wrong day (and a Sep 30 close at 1 am would count in October). Future stores may each close at a
  different hour, so this becomes a per-store setting then.

**Mistake recovery** (the owner tests by making deliberate mistakes — every action needs a way back)
- Wrong-slot activation → `undoActivation` until the slot's first close: slot empties, old slot price comes
  back (`price_before_activation`), pack returns to back stock only if it came from there.
- Pack wrongly marked sold out/returned → `undoEndPack`, while the slot is still empty and that sales day
  isn't closed. If a replacement went in, undo that activation first.
- Swap/move is its own undo (swap the same two slots again).
- Wrong pack size → `setPackSize` (refused if a live pack's top ticket wouldn't fit). Wrong slot price → `setSlotPrice`.
- Wrong close → `reopenClose` restores every top ticket (found by pack, so moves after the close are fine).
- Close submitted by mistake while still unsent → "Stop sending and change scans" on Close Day.
- Game ended by mistake → Bring back (or it comes back by itself when received).

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
- `config.js` backend URL · `api.js` `api(action, params)`, session in localStorage, `requireLogin(role)`, `whileBusy`,
  and the unsent close (`getPendingClose`, `savePendingClose`, `sendPendingClose`, `canRetryClose`, `newCloseId`;
  one per phone in `smartScanPendingClose`)
- `barcode.js` `parseTicketBarcode`, `parsePrintedTicket`, `STANDARD_PACK_SIZES` · `scanner.js` shared camera
  (zxing-wasm, `startScanner({... mode})` → `{ setMode }`) · `style.css` shared styles
- `index.html` home (also sends an unsent close, with a banner) · `login.html` · `setup-owner.html` · `account.html` ·
  `users.html` (owner)
- `slots.html` both boxes · `activate.html?box=&slot=` one slot: end pack, activate, undo, swap, prices, pack size
- `close.html` Close Day: walks live slots box 1 → 2, slot 1 → 24; a scan finds its slot by game+pack; Sold out /
  Skip (no "No sales" button — every live slot must be scanned; unchanged ticket = 0 sold). Scans are a draft in
  localStorage until submitted; anyone can **Clear all scans** (this phone's draft only, e.g. after a practice
  close). Views: scanning, closed (summary), and pending ("saved, not sent yet": Try sending now / Stop sending).
- `month.html` (owner) Months & totals: this month's totals + per-day table, Start New Month, past months' totals
- `backstock.html` (owner) **Find a game** search at the top (by game number as you type; packs in the back and the
  slots it's on display in, from `listBackStock().liveIn`; its buttons report right under it); Shipment (adds) or
  Count (sets) by scanning one ticket per game and entering packs; Remove packs; Game ended / Ended games list
- `manifest.webmanifest`, `icons/`, `sw.js` home-screen app. The service worker is network-first for pages (a deploy
  shows on next load; the saved copy is only for when offline) and caches the pinned zxing CDN files. Registered in `api.js`.
  Bump `CACHE` in `sw.js` when its file list changes. The installed app has its own storage on iOS (sign in again there).
- `raw-scanner.html`, `backend-test.html` dev/test pages

Backend (`src/apps-script/`, pushed with clasp; all files share one global scope):
- `WebApp.js` `doPost` router: `PUBLIC_ACTIONS`, `SIGNED_IN_ACTIONS` (`owner: true` = owner only); `doGet` health check
- `Schema.js` tabs/headers, `CARRIED_FORWARD_TABS`, `STANDARD_PACK_SIZES`, `INITIAL_SLOT_PRICES`
- `Sheets.js` `readTable`, `appendObject`, `updateRowsWhere`, `deleteRowsWhere`, `ensureHeaders`, `withLock`, `setCell`
- `Months.js` active month lookup (Control → Months tab), `monthStatus`, `startNewMonth`, `listMonths`, `monthSummary`
  (totals from that month's DailySummary) · `Setup.js` one-time `setup()` (safe to re-run; adds missing columns)
- `Auth.js` / `Users.js` logins, sessions, owner setup code, employee management
- `Slots.js` `listSlots`, `activatePack`, `endPack`/`endPackInSlot`, `undoActivation`, `undoEndPack`,
  `swapSlots`, `setSlotPrice`, `setPackSize`, `addGameToReserve`, `dateLabel`
- `Close.js` `closeStatus`, `submitClose(user, entries, closeId, date)` (validates everything before writing),
  `buildSummary`, `reopenClose`, `salesDate`
- `Backstock.js` `listBackStock` (every game, ended ones flagged `endedDate`), `saveBackStock(mode 'shipment'|'count')`,
  `removeBackStock`, `endGame`, `bringBackGame`

Conventions: every write runs inside `withLock`; validate the whole request before writing anything;
errors are `ApiError(code, message)` with a message the person at the counter can act on.
New columns go at the **end** of a tab. Existing month sheets don't have them yet: call `ensureHeaders` before
writing one, and read them defensively (a missing column reads as `undefined`, and `dateLabel(undefined)` is the
string "undefined", so check the value first). `SlotState.remaining_count` is a formula column that must not move.
Recent columns: `DailySummary.close_id`, `ReserveInventory.ended_date`, `DailyCloseLog.previous_close_date`,
`SlotState.last_game_number`.

## Data (one spreadsheet per month, "Smart Scan — YYYY-MM", same Drive folder as Control)

Users, Sessions, SlotConfig, SlotState, ReserveInventory, Shipments, ReserveAdjustments, DailyCloseLog,
DailySummary, PackHistory. Columns are in `Schema.js`. The owner reads these after each close but should not
hand-edit them.

## Test and deploy

```sh
node --test src/*.test.js                 # barcode parsing
node test/backend-scenarios.js            # backend against a fake spreadsheet (store scenarios)
node test/new-month-scenarios.js          # Start New Month against fake Drive/Sheets (fakes in test/fakes.js)

npm install                               # once: puppeteer-core, only for the browser tests (needs Google Chrome)
node test/browser/offline-close.js        # Close Day with no connection, lost answer, home resend, refusal
node test/browser/backstock-search.js     # Find a game
node test/browser/backstock-remove.js     # remove packs from a search result (real backend code, fake sheet)
node test/browser/backstock-game-ended.js # Game ended / Bring back (real backend code, fake sheet)

npx @google/clasp push -f                 # push backend (clasp isn't installed globally; already logged in)
npx @google/clasp update-deployment AKfycbynoVRwuSj_n5VLMy4R3ZtfaPY4PMIzV0yrjCW-UU8hSlpfBmXhKu4Dy-SzcQ9pXtGJ -d "<what changed>"
git push origin main                      # publishes the pages (GitHub Pages, ~1 min)
```
Browser tests (`test/browser/harness.js`) serve `src/` locally, open pages in headless Chrome at phone size, sign in,
and answer backend calls with a fake (`openApp({ role, handle })`) or with the real `src/apps-script` code on an
in-memory spreadsheet (`backendInVm`). They never touch the live backend. Deploy the backend before the pages when a
page needs a new action. After deploying, `curl -sL "$URL"` should return `{"ok":true,...,"slots":48}`, and an
unknown-but-registered action should answer `unauthorized` (not `unknown_action`).
