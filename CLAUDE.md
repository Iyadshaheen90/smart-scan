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
  Route 66 Liquor sells descending; ascending (0 → last) is a future per-store setting, kept per pack (see the plan's
  FUTURE section).
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
  months, employees, the Settling list.
- Employees never see dollar totals (`summaryFor` strips them).

**Inventory**
- Back stock = `ReserveInventory` (packs in the back). Live = packs in slots (`SlotState`).
- Activating a pack takes one pack out of back stock (never below 0; `took_from_reserve` records whether it did)
  but it is still inventory. Total inventory value = live remaining × price + back stock tickets × price.
- Empty slot = "out of stock": adds nothing to sales or inventory; back stock untouched. It shows the packs in back
  of the game last in it (`SlotState.last_game_number`, set when a pack sells out or is returned; falls back to this
  month's PackHistory) on Slots and the slot page (not in Close Day), unless that game has ended.
- **Days since activation** (owner only, Slots page only; owner's choice 2026-09-27): each live slot shows a yellow
  "Activated today" / "N days" under its green "N left" (`listSlots` → `pack.daysActive`, from
  `SlotState.activation_date` to `todayLabel()`; day 0 = activation day). From day 50 (`OLD_PACK_DAYS`, api.js) a yellow `!`
  badge sits on the slot card's top-left corner (not before the name, so the name isn't indented; owner 2026-09-30): CA Lottery settles (charges the store for) a pack 50–60 days after activation, so old
  slow packs get pushed. It keeps counting until the pack sells out or is returned; a swap/move and a new month keep it.
  The same packs (50+ days) are listed on the owner's **Settling** page, red from day 60 (owner approved 2026-09-29).
- Back stock changes and where they're logged: Shipment received (source "delivery") and **Manage packs** (+) (source
  "add pack", owner approved 2026-09-27) → `Shipments` (both count in the month's "Shipments in"); Count and Manage packs (−)
  → `ReserveAdjustments` (reason count / returned, game expired, damaged, stolen, other; "adjust" only from the API).
- **Full pack sale** (owner only, 2026-09-30): a customer buys a whole sealed pack from the back. The owner scans a ticket of
  it (pack number needed), and `sellFullPack` takes one pack off `ReserveInventory` (refused with 0 in the back, for a pack
  live in a slot, or one already in PackHistory). It logs a `DailyCloseLog` row (`close_type 'full_pack'`, no box/slot,
  whole pack × price, dated `salesDate()`), so it is in that day's totals, plus a PackHistory row (`end_reason
  'full_pack_sale'`) so the pack can't be activated later. Not a ReserveAdjustment (it's a sale). Also shown on its own:
  the owner home's Full pack sales card (this month's count and $) and `full-packs.html`. Each month's list starts empty
  (log rows stay in their month); back stock carries over. Limit, same as activation: a pack sold last month isn't
  checked against this month's sales.
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
- **Shift close** (optional; owner's request 2026-09-30; `Shifts.js`, `close.html?shift=1`): whoever ends a shift scans
  every live slot (same screen as Close Day, titled Close shift). Only that shift's numbers are saved (`ShiftCloses` +
  `ShiftCloseLog`, created on first use in a month sheet without them), for the owner to compare with the register by
  hand; the app judges nothing. It **never** writes SlotState, DailyCloseLog or DailySummary: Close Day still counts the
  whole day from last night's close, and Slots / home $ on display / Settling keep showing last night's top tickets
  (owner's choices). Shift start ticket = the pack's ticket at today's last shift close, else SlotState (last close or
  activation ticket). Sold out at a shift close counts every ticket left that shift but doesn't end the pack; later shift
  closes that day fill it in as "sold out · 0" (no scan); the night Close Day is **not** pre-filled (tap Sold out again,
  owner's choice). Packs ended and full packs sold during a shift count in it (DailyCloseLog rows by the new `logged_at`,
  less what an earlier shift close already counted). Employees: one shift close a day **per username** (`already_closed_shift`;
  each person signs in as themselves, so several employees can each close one the same day) unless the owner deletes it; tickets only, no $. Owner: no limit, sees $. None after the day is closed. No offline queue:
  with no connection it says so and the scans stay in the phone's draft (`smartScanShiftDraft:<user>`, tied to the
  previous shift close). Repeated `shiftId` = the saved shift back. Owner deletes a mistaken one on `shifts.html`.
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
- Shift close made by mistake → Delete on the Shift Closure page (`deleteShiftClose`): later shift closes that day start
  from the one before it, and that employee can close their shift again.
- Full pack sold by mistake → Undo on the Full pack sales page (`undoFullPackSale`), while that sales day isn't closed:
  the pack goes back in the back and the sale is removed.
- Game ended by mistake → Bring back (or it comes back by itself when received).

**Months** (one spreadsheet per month, like the owner's monthly Excel workbook)
- The owner starts each month on or after the 1st (never automatic): the amber **Start <Month> <Year>** button on the owner
  home (between the status card and Close Day, shown from the 1st until started, owner's request 2026-09-29) or on `month.html`.
- `startNewMonth` copies the current month's whole spreadsheet, so `CARRIED_FORWARD_TABS` (Users, Sessions, SlotConfig,
  SlotState, ReserveInventory) carry over exactly, then empties the log tabs except rows already dated in the new
  month (`MONTHLY_LOG_DATE_COLUMNS`). Those rows move out of the old spreadsheet, so starting late loses nothing.
- Safe to retry: an unregistered copy left by a failed attempt is trashed; the new month is marked active before the
  old one is archived (`getCurrentMonth` picks the latest active). A second tap is refused (`already_started`).
- `DailyCloseLog.previous_close_date` lets reopen/undo restore a pack's last close even when it was in an earlier month.

**Scanning**
- Press-and-hold is the default everywhere; Auto scan is an opt-in toggle (Close Day remembers it per phone).
- Every scan screen also accepts the typed printed number (`parsePrintedTicket`).
- The camera restarts itself (`keepCameraRunning` in scanner.js): iOS pauses the video while a confirm pop-up is open
  (e.g. Clear all scans, Sold out) or the app is in the background and never resumes it, which froze the picture (owner's
  bug 2026-09-29). Checked every second and on pause/focus/visibility/press: paused → `play()`, camera shut → reopened.
  It only acts while the video is on screen, so a page that hides it after `stopCamera()` (Close Day once closed) stays off.
- Scan feedback (`haptic()` in scanner.js; owner 2026-09-29): every saved scan buzzes + one short high beep; a scan that
  wasn't saved buzzes (Android: double) + two low beeps. The scanner reports each read as ok and the page may then report
  'error' for it, so reports are merged into one (played on the finger lift while held, else on a 0 ms timer). **iPhone** Safari has no
  `navigator.vibrate` and buzzes only when a *finger* flips an `<input type=checkbox switch>`: the app clicking one does
  nothing (owner's iPhone, iOS 18, tested 2026-09-29 in Safari and the home-screen app). So every Press and hold button is
  `<label class="button hold-button">`; `holdFeedback` → `prepareHoldButton` puts a hidden switch in it (text in a span — never set the
  label's textContent). The finger lifting flips it = the buzz. It must be enabled when the finger goes down: enabling it
  mid-hold, or a click handler on the label, killed the buzz (owner's Scanner test A–G, 2026-09-29). So a release with no
  scan disables it for that one click (re-enabled 100 ms later); no scan, no buzz. The beep's sound setting doesn't
  affect the buzz (tests H–J).
  Pages must not change the screen while Press and hold is down: Close Day redrawing mid-hold stopped the buzz (Back
  stock, which waits, buzzed). So scan results decide saved/refused (`haptic`) at once but draw via `afterLift(holdBtn, fn)`
  (scanner.js), just after the finger lifts (Close Day, slot page; Back stock has its own `whenHandsFree`).
  With no held button (Auto scan, typed number) an iPhone gets the beeps only (Web Audio, unlocked on the first press,
  `audioSession.type = 'playback'` so the silent switch doesn't mute it).
- Close Day's camera and Press and hold button never move between scans, and the progress bar, slot card with Sold out /
  Skip, camera and button all fit on an iPhone screen at once (owner 2026-09-29). So the scan message sits on the camera
  picture above the guide box (`.scan-flash`, text shrinks to fit), the current-slot card lines have fixed heights (the
  "Already done" line is one line, `fitText`), and the card stays ("All slots done") instead of hiding. A fixed-height
  message box *above* the camera was tried first: stable, but it pushed the button off screen (owner didn't want that).

## Code map

Frontend (`src/`, plain HTML + JS, no build):
- `config.js` backend URL · `api.js` `api(action, params)`, session in localStorage, `requireLogin(role)`, `whileBusy`,
  and the unsent close (`getPendingClose`, `savePendingClose`, `sendPendingClose`, `canRetryClose`, `newCloseId`;
  one per phone in `smartScanPendingClose`)
- `barcode.js` `parseTicketBarcode`, `parsePrintedTicket`, `STANDARD_PACK_SIZES` · `scanner.js` shared camera
  (zxing-wasm, `startScanner({... mode})` → `{ setMode }`) · `style.css` shared styles
- **Look (owner's redesign 2026-09-28):** always dark; `style.css` tokens on `:root`; cards, chips, `.tile-card`, `.list-card`.
  `nav.js` fills `<header class="app-header" data-title=…>` (store name or a `data-back` link, title, name pill → More) and
  `<nav class="tabbar" data-active=…>`: owner Home · Scan (Close Day) · Stock · Reports · More; employee Home · Slots · More.
  The slot page (`activate.html`) has a back pill (`.back`: chevron + label, 44px tall, styled like the name pill and on
  one row with it, title underneath; owner 2026-09-30) instead of the tab bar; login/setup have no tab bar. `icons.js` inline
  line icons (`icon(name)`, `data-icon`). Owner's rule: numbers are never cut off — put `fit` on the box and call
  `fitText`/`fitNumbers` (nav.js) after filling it; grids use `minmax(0, 1fr)`. Pages with the tab bar get
  `body.has-tabbar` bottom padding and `scroll-padding-bottom`, so scrolled-to buttons stop above the bar. Dialogs sit above it (z-index).
- **Saved answers** (`loadSaved(name, request, show)` in api.js): Slots, Settling (shares Slots' saved `listSlots`), Back stock
  and Months & totals draw the last answer saved on the phone at once, then the fresh one. While it shows, `body.showing-saved`
  dims `.saved-dim` and makes `.saved-lock` untappable (Back stock's list and ended games, Months' Start and past months), and
  Back stock's scans/search wait for the fresh list. A failed refresh keeps the saved answer (still locked) with the error.
- `index.html` home (also sends an unsent close, with a banner). Owner home = one `ownerHome` request; the last answer is saved
  per login in localStorage and shown at once, dimmed (`.stale`), until the fresh one arrives (a copy from an earlier day shows
  that day's close as the last close; only a fresh answer shows the Start month button). Owner: status card (Not closed / Closed chip, big number = last
  close's $ — today's once closed, else this month's last closed day, else last month's; Tickets sold; Slots active), amber Start <Month>
  button (from the 1st until the month is started; confirm, then `startNewMonth`, then it hides), Close Day button, tiles Slots ($ on display = remaining × price), Back stock & shipments ($ in the back), Months & totals ($ sold this
  month), Settling (packs live 50+ days, amber when any), a full-width Full pack sales card (`.tile-wide`: packs sold this month
  and their $, from `ownerHome.fullPacks`; opens `full-packs.html`), a full-width Shift Closure card (shift closes this month and
  the latest "3:02 PM · today by sara", from `ownerHome.shifts`; opens `shifts.html`), a quieter **Close my shift** button
  (`.action-shift`) under Close Day, Manage employees row (Scanner test is in More only, owner 2026-09-29). Employee: status card (Ready to scan / Day closed + submitted by) and a big
  Scan tickets button → Close Day, and under it Close my shift (hidden once the day is closed; a greyed "Shift closed at
  2:00 PM" once they've closed one today, from `closeStatus.myShiftToday`); no dollars. · `more.html` Manage employees (owner), Scanner test, Change my password, Sign out ·
  `login.html` · `setup-owner.html` · `account.html` · `users.html` (owner)
- `settling.html` (owner, 2026-09-29) live packs at `OLD_PACK_DAYS` (50) or more, longest first (`settlingPacks` in api.js,
  from `listSlots`, so a sold-out/returned pack drops off by itself): Box · Slot, game · pack, days (amber 50–59, red from
  `SETTLED_PACK_DAYS` 60 = most likely settled), ticket price, tickets left and value as of the last close; tap → slot page (`&from=settling`, so its back pill and
  "Back to settling" return to Settling; opened from Slots they return to Slots, owner 2026-09-30).
  Icon `settle` (handshake under a $ coin) in icons.js.
- `full-packs.html` (owner, 2026-09-30) this month's full pack sales (`listFullPackSales`, saved answer first): green
  **Sell a full pack** → `backstock.html?mode=fullpack`, totals (packs, $), one card per sale newest first (day, game ·
  pack, ticket price, pack size, total value) with Undo until that day is closed. Icon `ticket`.
- `shifts.html` (owner, 2026-09-30) Shift Closure: this month's shift closes by day, newest first (`listShiftCloses`, saved
  answer first): who · when, $ chip, from → to, tickets / $ / slots scanned, packs ended or sold whole during it, Slots
  (every slot's start → end ticket) and Delete (confirm). Icon `shift` (two block arrows, from the owner's picture).
- `slots.html` both boxes (owner also sees days since activation and the day-50 mark) · `activate.html?box=&slot=` one slot: end pack, activate, undo; then (owner's order) slot price, pack size, move or swap
- `close.html` Close Day: walks live slots box 1 → 2, slot 1 → 24; a scan finds its slot by game+pack; Sold out /
  Skip (no "No sales" button — every live slot must be scanned; unchanged ticket = 0 sold). Scans are a draft in
  localStorage until submitted; anyone can **Clear all scans** (this phone's draft only, e.g. after a practice
  close). Views: scanning, closed (summary, with "Submitted at 10:52 PM by <username>" from
  `DailySummary.closed_by`/`closed_at`, server time when saved; closes before 2026-09-27 have no line), and pending ("saved, not sent yet": Try sending now / Stop sending).
- `month.html` (owner) Months & totals: this month's totals + per-day table, Start New Month, past months' totals
- `backstock.html` (owner) **Find a game** search at the top (by game number as you type; packs in the back and the
  slots it's on display in, from `listBackStock().liveIn`; its buttons report right under it). **Shipment received**: a scanned/typed game opens a
  pop-up (owner 2026-09-28): "Packs received" − count + starting at 1 (− stops at 0, Save greyed there), a new game also
  asks price + pack size; Save sends `saveBackStock` shipment for that one game at once (source "delivery", no notes).
  A scan opens it only after the finger leaves "Press and hold" (`whenHandsFree`): opened under the finger, iPhones
  swallowed the first tap on +.
  **Count the back** (sets) still uses the list: scan one ticket per game, enter packs, Save count; one **Manage packs** dialog on every game (owner
  2026-09-27: replaced Add pack + Remove packs): − count + with red Cancel / green Save. Save with more packs sends
  them as a shipment; with fewer it shows "Remove N packs (a → b). Why?" with reason buttons (returned, game expired,
  damaged, stolen, other), red Cancel and Back, and nothing changes until a reason is tapped; Game ended / Ended games list.
  **Full pack sale** (3rd mode; `?mode=fullpack` opens it): a scanned/typed *full* ticket number (a bare game number is
  refused) opens "Sell full pack" (game · pack, value, "$20 × 30 tickets", "Back: 2 → 1", red Cancel / green Sell) after
  the finger lifts; a game with none in the back is refused before the pop-up. Switching to it never changes the saved
  shipment/count draft, and it hides that list.
- `manifest.webmanifest`, `icons/`, `sw.js` home-screen app. The service worker is network-first for pages (a deploy
  shows on next load; the saved copy is only for when offline) and caches the pinned zxing CDN files. Registered in `api.js`.
  Bump `CACHE` in `sw.js` when its file list changes. The installed app has its own storage on iOS (sign in again there).
- `raw-scanner.html` Scanner test (dev) plus the iPhone vibration/sound test buttons 5–8 and A–K (K = the real
  `holdFeedback` code); owner wants them kept for now · `backend-test.html` dev page

Backend (`src/apps-script/`, pushed with clasp; all files share one global scope):
- `WebApp.js` `doPost` router: `PUBLIC_ACTIONS`, `SIGNED_IN_ACTIONS` (`owner: true` = owner only); `doGet` health check
- `Schema.js` tabs/headers, `CARRIED_FORWARD_TABS`, `STANDARD_PACK_SIZES`, `INITIAL_SLOT_PRICES`
- `Sheets.js` `readTable`, `appendObject`, `updateRowsWhere`, `deleteRowsWhere`, `ensureHeaders`, `withLock`, `setCell`
- `Months.js` active month lookup (Control → Months tab), `monthStatus`, `startNewMonth`, `listMonths`, `monthSummary`,
  `monthsPage` (Months & totals in one request: status + this month's summary + every month)
  (totals from that month's DailySummary) · `Setup.js` one-time `setup()` (safe to re-run; adds missing columns).
  `getCurrentMonth`/`openCurrentMonth` keep the month and its opened spreadsheet for the rest of a request (reset in `doPost`).
- `Home.js` `ownerHome`: everything on the owner's home in one request (closeStatus + monthStatus + this month's $ + last
  close + back stock $ + this month's full packs).
- `Shifts.js` `shiftStatus`, `submitShiftClose(user, entries, shiftId, date)`, `listShiftCloses`, `deleteShiftClose`,
  `shiftHomeSummary` (for `ownerHome.shifts`), `shiftStarts`, `endedInShift`, `nowStamp` (also used for `logged_at`).
  `closeStatus` also returns `myShiftToday` (an employee's own shift close today).
- `FullPacks.js` `sellFullPack`, `undoFullPackSale`, `listFullPackSales`, `fullPackTotals` (also used by `monthSummary`). Each Web App request costs ~2 s however small, so a page should ask once, not once per number.
- `Auth.js` / `Users.js` logins, sessions, owner setup code, employee management
- `Slots.js` `listSlots`, `activatePack`, `endPack`/`endPackInSlot`, `undoActivation`, `undoEndPack`,
  `swapSlots`, `setSlotPrice`, `setPackSize`, `addGameToReserve`, `dateLabel`
- `Close.js` `closeStatus`, `submitClose(user, entries, closeId, date)` (validates everything before writing),
  `buildSummary`, `reopenClose`, `salesDate`
- `Backstock.js` `listBackStock` (every game, ended ones flagged `endedDate`), `saveBackStock(mode 'shipment'|'count')`,
  `adjustBackStock` (Add pack: `change` packs; more → Shipments row, source "add pack"; fewer → ReserveAdjustments, reason
  "adjust"), `removeBackStock`, `endGame`, `bringBackGame`

Conventions: every write runs inside `withLock`; validate the whole request before writing anything;
errors are `ApiError(code, message)` with a message the person at the counter can act on.
New columns go at the **end** of a tab. Existing month sheets don't have them yet: call `ensureHeaders` before
writing one, and read them defensively (a missing column reads as `undefined`, and `dateLabel(undefined)` is the
string "undefined", so check the value first). `SlotState.remaining_count` is a formula column that must not move.
Recent columns: `DailyCloseLog.logged_at`, `DailySummary.close_id`, `DailySummary.closed_by`/`closed_at`, `ReserveInventory.ended_date`, `DailyCloseLog.previous_close_date`,
`SlotState.last_game_number`.

## Data (one spreadsheet per month, "Smart Scan — YYYY-MM", same Drive folder as Control)

Users, Sessions, SlotConfig, SlotState, ReserveInventory, Shipments, ReserveAdjustments, DailyCloseLog,
DailySummary, PackHistory, ShiftCloses, ShiftCloseLog (the last two from Oct 2026; added on first use before that). Columns are in `Schema.js`. The owner reads these after each close but should not
hand-edit them.

## Test and deploy

```sh
node --test src/*.test.js                 # barcode parsing
node test/backend-scenarios.js            # backend against a fake spreadsheet (store scenarios)
node test/new-month-scenarios.js          # Start New Month against fake Drive/Sheets (fakes in test/fakes.js)

npm install                               # once: puppeteer-core, only for the browser tests (needs Google Chrome)
node test/browser/offline-close.js        # Close Day with no connection, lost answer, home resend, refusal
node test/browser/backstock-search.js     # Find a game
node test/browser/backstock-remove.js     # Manage packs, removing: why step, Back, Cancel, reasons, refusal (real backend code, fake sheet)
node test/browser/backstock-add-pack.js   # Manage packs, adding: + / −, Cancel, Save as shipment (real backend code, fake sheet)
node test/browser/backstock-shipment.js   # Shipment received pop-up: starts at 1, 0 greys Save, new game, ended game, waits for scan release
node test/browser/backstock-game-ended.js # Game ended / Bring back (real backend code, fake sheet)
node test/browser/slots-days.js           # Slots: days since activation + day-50 mark (owner), none for employees
node test/browser/home.js                 # home for both roles: one request, saved numbers first, tiles, chips, Start month, huge numbers fit
node test/browser/saved-pages.js          # Slots, Settling, Back stock, Months: saved answer first (dimmed, locked), then fresh
node test/browser/close-layout.js         # Close Day: button stays put and progress→button fit on screen through every kind of scan; buzzes
node test/browser/camera-revive.js        # camera un-freezes after Clear all / a pause / being shut off; stays off once closed
node test/browser/backstock-fullpack.js # Full pack sale mode: ?mode=fullpack, pop-up, Sell/Cancel, refusals, draft kept (real backend code)
node test/browser/full-packs.js          # Full pack sales page: totals, cards, Undo, none after close, empty month (real backend code)
node test/browser/settling.js             # Settling: 50+ day packs, order, colors, totals, drop off when ended, owner only
node test/browser/shift-close.js          # Close shift: start tickets, earlier sold out, once a day for employees, no $, Close Day untouched (real backend code)
node test/browser/shifts.js               # Shift Closure report: by day, details, ended packs, Delete (real backend code)

npx @google/clasp push -f                 # push backend (clasp isn't installed globally; already logged in)
npx @google/clasp update-deployment AKfycbynoVRwuSj_n5VLMy4R3ZtfaPY4PMIzV0yrjCW-UU8hSlpfBmXhKu4Dy-SzcQ9pXtGJ -d "<what changed>"
git push origin main                      # publishes the pages (GitHub Pages, ~1 min)
```
Browser tests (`test/browser/harness.js`) serve `src/` locally, open pages in headless Chrome at phone size, sign in,
and answer backend calls with a fake (`openApp({ role, handle })`) or with the real `src/apps-script` code on an
in-memory spreadsheet (`backendInVm`). They never touch the live backend. Deploy the backend before the pages when a
page needs a new action. After deploying, `curl -sL "$URL"` should return `{"ok":true,...,"slots":48}`, and an
unknown-but-registered action should answer `unauthorized` (not `unknown_action`).
